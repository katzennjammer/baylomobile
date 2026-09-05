import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { visibleItemWhere, userNotBlocked } from "@/lib/blocking"
import { notSuspendedWhere } from "@/lib/moderation"
import { ok, unauthenticated, notFound, invalid } from "@/lib/v1/envelope"
import { parseQuery, paginationShape } from "@/lib/v1/query"
import { parseJsonBody } from "@/lib/v1/body"
import { decodeCursor, encodeCursor, olderThan, paginate } from "@/lib/v1/cursor"
import { enforceRateLimit } from "@/lib/rate-limit-config"
import { v1ItemStatsSelect, v1Stats } from "@/lib/v1/item"

export const dynamic = "force-dynamic"

/**
 * GET  /api/v1/items/[id]/comments — the listing's comments, newest first.
 * POST /api/v1/items/[id]/comments — add one.
 *
 * ── NEWEST FIRST, and it is a choice ────────────────────────────────────────
 *
 * /api/posts/[id]/comments sorts ASCENDING and pages with a Prisma `cursor` +
 * `skip: 1`, which is offset pagination wearing a keyset's clothes: it re-reads
 * the boundary row on every page and drifts the moment a comment is added or
 * deleted mid-scroll. This sorts descending on (createdAt, id) and pages with
 * the shared keyset helpers, like every other v1 list.
 *
 * Descending is also the right answer for what this list IS. A listing's
 * comments are mostly questions — is this still available, will you take X —
 * and the useful one is the last one, not the first. A chat transcript reads
 * oldest-first; a queue of questions does not.
 *
 * ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
 *
 * REPLIES ARE COUNTED, NOT RETURNED. `replyCount` rides on each row so a thread
 * view has its number the day it exists; the replies themselves are a nested
 * unbounded read on every page and there is no screen for them. POST accepts a
 * `parentId`, so writing a reply is possible before reading one is — that
 * asymmetry is deliberate, and it is the cheap half.
 *
 * COMMENT LIKES ARE ABSENT ENTIRELY. CommentLike exists and the legacy route
 * returns `likeCount`/`liked` for every comment and every reply. There is no v1
 * endpoint to act on them, and shipping a count with no way to change it is the
 * dead affordance this whole task exists to remove. When the endpoint lands the
 * fields land with it.
 *
 * ── BLOCKING ────────────────────────────────────────────────────────────────
 *
 * Filtered on the AUTHOR as well as on the listing. A listing you can see may
 * still carry comments from someone you have blocked, and the query layer is
 * where that has to be handled — see @/lib/blocking for why never fetching them
 * is different from fetching and hiding them. The count in `stats.comments`,
 * which comes off the item's `_count`, is NOT filtered this way and will read
 * high for a viewer with blocks. That is a known and accepted divergence: the
 * alternative is a per-viewer counting query on every feed card.
 */

const listSchema = z.strictObject({ ...paginationShape })

const MAX_COMMENT = 2000

const createSchema = z.strictObject({
  content: z
    .string()
    .trim()
    .min(1, "Say something")
    .max(MAX_COMMENT, `A comment cannot exceed ${MAX_COMMENT} characters`),
  /**
   * The comment being replied to. Validated against THIS listing below — an
   * unchecked parentId would let a reply be filed under a comment on somebody
   * else's item, where it would render as theirs.
   */
  parentId: z.string().min(1).max(64).optional(),
})

/** Exactly the author fields a comment row renders. */
const COMMENT_AUTHOR_SELECT = { id: true, name: true, avatar: true } as const

interface CommentRow {
  id: string
  content: string
  createdAt: Date
  user: { id: string; name: string; avatar: string | null }
  _count?: { replies: number }
}

function wireComment(row: CommentRow) {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.createdAt,
    user: row.user,
    replyCount: row._count?.replies ?? 0,
  }
}

/**
 * The listing, if this viewer may see it.
 *
 * Same rule as the like route: a listing hidden by a block, a suspension or a
 * takedown is not one to read or write comments on, and the answer is 404 for
 * all of them rather than a 403 that would confirm the row exists.
 */
async function visibleItemId(id: string, viewerId: string): Promise<string | null> {
  const item = await prisma.item.findFirst({
    where: { id, status: { not: "REMOVED" }, ...visibleItemWhere(viewerId) },
    select: { id: true },
  })
  return item?.id ?? null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const viewerId = session.user.id
  const { id } = await params

  const parsed = parseQuery(req, listSchema)
  if (!parsed.ok) return parsed.response
  const { limit } = parsed.data
  const cursor = decodeCursor(parsed.data.cursor)
  // A malformed cursor is a 400, never a silent restart from page one.
  if (parsed.data.cursor && !cursor) return invalid("Malformed cursor")

  const itemId = await visibleItemId(id, viewerId)
  if (!itemId) return notFound("That listing is no longer available")

  const rows = await prisma.postComment.findMany({
    where: {
      postId: itemId,
      // Top level only. Replies hang off their parent and would otherwise
      // appear in this list as though they were addressed to the listing.
      parentId: null,
      user: { is: { ...userNotBlocked(viewerId), ...notSuspendedWhere() } },
      ...(olderThan(cursor) ?? {}),
    },
    select: {
      id: true,
      content: true,
      createdAt: true,
      user: { select: COMMENT_AUTHOR_SELECT },
      _count: { select: { replies: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  })

  const { page, nextCursor } = paginate(rows, limit, (r) =>
    encodeCursor(r.createdAt, r.id),
  )

  return ok({ comments: page.map(wireComment) }, { nextCursor })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const viewerId = session.user.id
  const { id } = await params

  const limited = enforceRateLimit("comment", viewerId)
  if (limited) return limited

  const parsed = await parseJsonBody(req, createSchema)
  if (!parsed.ok) return parsed.response
  const { content, parentId } = parsed.data

  const itemId = await visibleItemId(id, viewerId)
  if (!itemId) return notFound("That listing is no longer available")

  if (parentId) {
    // On THIS listing, and itself top level. Both halves matter: the first
    // stops a reply being filed under a stranger's comment, the second stops an
    // arbitrarily deep chain forming under a list that only renders one level.
    const parent = await prisma.postComment.findFirst({
      where: { id: parentId, postId: itemId, parentId: null },
      select: { id: true },
    })
    if (!parent) return notFound("That comment is no longer there")
  }

  const created = await prisma.postComment.create({
    data: { postId: itemId, userId: viewerId, content, parentId: parentId ?? null },
    select: {
      id: true,
      content: true,
      createdAt: true,
      user: { select: COMMENT_AUTHOR_SELECT },
      _count: { select: { replies: true } },
    },
  })

  // The card's whole stats block, for the same reason the like route sends it:
  // the client has a comment count on screen and this is the number that
  // replaces it, rather than a +1 it has to compute and hope about.
  const statsRow = await prisma.item.findUnique({
    where: { id: itemId },
    select: v1ItemStatsSelect(viewerId),
  })

  return ok({
    comment: wireComment(created),
    stats: v1Stats(statsRow ?? {}),
  })
}
