import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { preciseAccessItemIds } from "@/lib/item-visibility"
import { getLeafRank } from "@/lib/task-constants"
import { ok, unauthenticated, invalid, notFound } from "@/lib/v1/envelope"
import { parseQuery, paginationShape } from "@/lib/v1/query"
import { decodeCursor, encodeCursor, olderThan, paginate } from "@/lib/v1/cursor"
import { V1_ITEM_SELECT, V1_ITEM_OWNER_SELECT, v1ItemStatsSelect, v1Item, type V1ItemRow } from "@/lib/v1/item"

export const dynamic = "force-dynamic"

/**
 * GET /api/v1/profile/[id] — somebody else's profile.
 *
 * FIVE queries, not the four the shapes proposed. The proposal claimed pickup
 * access "comes free here". It does not: these items belong to someone else,
 * and the viewer may be an ACCEPTED counterparty on one of them, which is
 * exactly the case that earns precise coordinates. Dropping the lookup would
 * under-share rather than over-share — safe, but wrong for the one person
 * entitled to the address.
 *
 *   1  user row with nested counts
 *   2  follow edge, both directions
 *   3  items page
 *   4  pickup access for that page
 *   5  reviews received
 *
 * The shape is deliberately NOT /profile/me minus a few fields. The omissions
 * are the point and they are enumerated below: no email, no spendable `leaves`,
 * no tasks, no impact. `lifetimeLeaves` IS public — it is what the rank badge
 * is built from.
 */

const querySchema = z.strictObject({ ...paginationShape })

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const viewerId = session.user.id
  const { id } = await params

  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response
  const { limit } = parsed.data
  const cursor = decodeCursor(parsed.data.cursor)
  if (parsed.data.cursor && !cursor) return invalid("Malformed cursor")

  // ── 1 ──
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, name: true, avatar: true, bio: true, location: true,
      rating: true, totalTrades: true, lifetimeLeaves: true,
      isVerified: true, createdAt: true, deletedAt: true,
      _count: {
        select: {
          items: { where: { status: "AVAILABLE" } },
          reviewsReceived: true,
          followers: { where: { status: "ACCEPTED" } },
          following: { where: { status: "ACCEPTED" } },
        },
      },
    },
  })

  // A deleted account is anonymised, not removed. It must not be browsable —
  // 404 here matches resolveSession(), which refuses to authenticate one.
  if (!user || user.deletedAt) return notFound("Profile not found")

  // ── 2 ── the follow edge in both directions, in one query.
  const edges = await prisma.follow.findMany({
    where: {
      OR: [
        { followerId: viewerId, followeeId: id },
        { followerId: id, followeeId: viewerId },
      ],
    },
    select: { followerId: true, followeeId: true, status: true },
  })
  const mine = edges.find((e) => e.followerId === viewerId)
  const theirs = edges.find((e) => e.followerId === id)

  // ── 3 ── their inventory. AVAILABLE only: what they own is not public.
  const itemRows = await prisma.item.findMany({
    where: { userId: id, status: "AVAILABLE", ...(olderThan(cursor) ?? {}) },
    select: {
      ...V1_ITEM_SELECT,
      user: { select: V1_ITEM_OWNER_SELECT },
      ...v1ItemStatsSelect(viewerId),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  })
  const { page, nextCursor } = paginate(itemRows, limit, (r) => encodeCursor(r.createdAt, r.id))

  // ── 4 ──
  const access = await preciseAccessItemIds(viewerId, page.map((r) => r.id))

  // ── 5 ──
  const reviews = await prisma.review.findMany({
    where: { revieweeId: id },
    select: {
      id: true, rating: true, comment: true, createdAt: true, tradeId: true,
      reviewer: { select: { id: true, name: true, avatar: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  })

  return ok(
    {
      user: {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        bio: user.bio,
        location: user.location,
        rating: user.rating,
        totalTrades: user.totalTrades,
        lifetimeLeaves: user.lifetimeLeaves,
        rank: { label: getLeafRank(user.lifetimeLeaves).label },
        isVerified: user.isVerified,
        createdAt: user.createdAt,
        // NOT returned, and deliberately: email, leaves, tasks, impact.
      },
      counts: {
        listed: user._count.items,
        // The maintained column, incremented by settlement. Counting COMPLETED
        // trades here would be a sixth query for a number already stored.
        completedTrades: user.totalTrades,
        reviews: user._count.reviewsReceived,
        followers: user._count.followers,
        following: user._count.following,
      },
      follow: {
        status: mine?.status ?? "NONE",
        followsYou: theirs?.status === "ACCEPTED",
      },
      items: page.map((r) => v1Item(r as unknown as V1ItemRow, viewerId, access)),
      reviews,
    },
    { nextCursor },
  )
}
