import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { visibleItemWhere } from "@/lib/blocking"
import { ok, unauthenticated, notFound } from "@/lib/v1/envelope"
import { parseQuery } from "@/lib/v1/query"
import { enforceRateLimit } from "@/lib/rate-limit-config"
import { v1ItemStatsSelect, v1Stats } from "@/lib/v1/item"

export const dynamic = "force-dynamic"

/**
 * POST   /api/v1/items/[id]/like — like this listing.
 * DELETE /api/v1/items/[id]/like — unlike it.
 *
 * TWO METHODS, NOT ONE TOGGLE. /api/posts/[id]/like is a toggle, and a toggle
 * is the wrong shape for a control that fires from a tap on a moving list:
 * the client cannot tell a lost response from a second like, so a retry after a
 * timeout UNLIKES. Both of these are idempotent — POST twice is one like,
 * DELETE twice is no like — so the client may retry either one freely, which is
 * what makes the optimistic heart in the feed safe.
 *
 * WHY THIS ROUTE EXISTS AT ALL, given /api/posts/[id]/like already works: that
 * route answers `{ liked, count }`, a bare body outside the envelope, and it
 * does not check `visibleItemWhere`, so a listing you cannot see is still a
 * listing you can like. Both are fixed here rather than there — the legacy
 * route is the web's and is left alone.
 *
 * BOTH ANSWER WITH THE WHOLE `stats` BLOCK, in the same shape the feed sent it
 * (v1Stats, the same function v1Item uses). The client applies its optimistic
 * change, and on the response replaces its guess with the truth — including the
 * comment count, which it did not ask about but which may well have moved since
 * the page was fetched. A response of `{ liked: true }` would leave the count
 * to be inferred, and inference is how two clients end up disagreeing about a
 * number they both received.
 *
 * `postId` is the column name; the row is an Item. See the PostLike model —
 * "post" is what listings were called before they were listings.
 */

/** No query parameters. Anything sent is a client mistake worth surfacing. */
const querySchema = z.strictObject({})

/**
 * The listing, if this viewer may see it at all.
 *
 * visibleItemWhere() rather than a bare id lookup: liking is a write against
 * someone else's row, and a blocked user must not be able to raise the like
 * count on a listing that is invisible to them in every other surface. REMOVED
 * is refused too — a delisted item is not a thing to interact with.
 */
async function visibleItemId(id: string, viewerId: string): Promise<string | null> {
  const item = await prisma.item.findFirst({
    where: { id, status: { not: "REMOVED" }, ...visibleItemWhere(viewerId) },
    select: { id: true },
  })
  return item?.id ?? null
}

/** The post-write truth, read once, shaped by the same function the feed uses. */
async function currentStats(itemId: string, viewerId: string) {
  const row = await prisma.item.findUnique({
    where: { id: itemId },
    select: v1ItemStatsSelect(viewerId),
  })
  return v1Stats(row ?? {})
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const viewerId = session.user.id
  const { id } = await params

  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response

  const limited = enforceRateLimit("like", viewerId)
  if (limited) return limited

  const itemId = await visibleItemId(id, viewerId)
  if (!itemId) return notFound("That listing is no longer available")

  // upsert, not create. A double tap, a retry after a timeout and a second
  // device all arrive as the same statement, and the unique index on
  // (postId, userId) is what makes them one row.
  //
  // A concurrent pair can still lose the upsert's read-then-write race and
  // surface as P2002. That is the index doing its job on the row this request
  // wanted to exist, so it is a success, not an error: swallowing it here is
  // the same call the reports route makes on the same constraint, in the
  // opposite direction (there a duplicate is a 409 because the SECOND report
  // is a different act; a second like is not).
  try {
    await prisma.postLike.upsert({
      where: { postId_userId: { postId: itemId, userId: viewerId } },
      create: { postId: itemId, userId: viewerId },
      update: {},
      select: { id: true },
    })
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
  }

  return ok({ stats: await currentStats(itemId, viewerId) })
}

/**
 * Unlike. 200 even when there was no like to remove.
 *
 * DELIBERATELY UNLIKE /api/v1/blocks/[id], which 404s on the same shape of
 * request, and the difference is what the absence means to each client. There,
 * "you were never blocking them" is news: the settings list the user tapped is
 * stale and wants refreshing. Here it is the ordinary outcome of a fast double
 * tap on a heart, and answering 404 would paint an error over a UI that is
 * already showing exactly the state the request asked for.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const viewerId = session.user.id
  const { id } = await params

  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response

  const limited = enforceRateLimit("like", viewerId)
  if (limited) return limited

  const itemId = await visibleItemId(id, viewerId)
  if (!itemId) return notFound("That listing is no longer available")

  // deleteMany, not delete: `delete` throws P2025 when the row is absent, which
  // would make the ordinary double tap a 500.
  await prisma.postLike.deleteMany({ where: { postId: itemId, userId: viewerId } })

  return ok({ stats: await currentStats(itemId, viewerId) })
}

/** P2002 — the unique constraint. Narrowed without importing the error class. */
function isUniqueViolation(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  )
}
