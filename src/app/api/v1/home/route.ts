import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { preciseAccessItemIds } from "@/lib/item-visibility"
import { visibleItemWhere, userNotBlocked } from "@/lib/blocking"
import { notSuspendedWhere } from "@/lib/moderation"
import { getLeafRank } from "@/lib/task-constants"
import { loadEffectiveTiers } from "@/lib/contracts"
import { ok, unauthenticated, invalid } from "@/lib/v1/envelope"
import { parseQuery, paginationShape } from "@/lib/v1/query"
import { decodeCursor, encodeCursor, olderThan, paginate } from "@/lib/v1/cursor"
import { V1_ITEM_SELECT, V1_ITEM_OWNER_SELECT, v1ItemStatsSelect, v1Item, type V1ItemRow } from "@/lib/v1/item"
import { categoryLabel, categoryHashtag, type Category } from "@/lib/v1/taxonomy"

export const dynamic = "force-dynamic"

/**
 * GET /api/v1/home — the whole home tab in one request.
 *
 * NINE calls, plain Prisma, no raw SQL. The six-query variant folded the
 * three unread counts into one raw statement with scalar subqueries; that was
 * traded away deliberately. Two saved round trips is not worth a hand-written
 * SQL string in the middle of the hottest screen in the app.
 *
 * The nine:
 *   1  viewer row, with their own AVAILABLE item categories nested
 *   2  feed page
 *   3  pickup access for that page
 *   4  trust tiers for that page's owners (three aggregates, run in parallel)
 *   5  trending categories (7-day groupBy)
 *   6  match candidates
 *   7  unread messages
 *   8  unread notifications
 *   9  pending follow requests
 *
 * Queries 3 and 4 are the ones that stop this being an N+1: pickup
 * authorisation and every owner's tier are each resolved for the entire page in
 * one lookup, not per item.
 *
 * Deliberately NOT here: impact, tasks, stories, category counts, weekly trades.
 * Those belong to /profile/me and /browse. Pulling them in is what makes the web
 * dashboard seventeen queries.
 */

const querySchema = z.strictObject({ ...paginationShape })

export async function GET(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const viewerId = session.user.id

  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response
  const { limit } = parsed.data
  const cursor = decodeCursor(parsed.data.cursor)
  // A malformed cursor is a 400, never a silent restart from page one — that
  // would look to a client like a list that never advances.
  if (parsed.data.cursor && !cursor) return invalid("Malformed cursor")

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const keyset = olderThan(cursor)

  // ── 1 ── viewer, with their own available categories riding along.
  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    select: {
      id: true, name: true, avatar: true, location: true,
      leaves: true, lifetimeLeaves: true, rating: true,
      totalTrades: true, isVerified: true,
      items: { where: { status: "AVAILABLE" }, select: { category: true } },
    },
  })
  if (!viewer) return unauthenticated()

  // ── 2 ── the feed: everything available, newest first, keyset paginated.
  //
  // visibleItemWhere() adds its constraints to the SQL, not to the result set:
  // the owner is not blocked in either direction, the owner is not currently
  // suspended, and no moderator has taken the listing down. All three are
  // NOT EXISTS subqueries / IS NULL tests inside this same statement, so a
  // blocked user's listing is never fetched, never
  // counted against `take`, and never on the wire. Filtering after the fetch
  // would silently shorten every page — 20 requested, 17 shown — and break the
  // keyset cursor's contract that a full page means there is more.
  const feedRows = await prisma.item.findMany({
    where: { status: "AVAILABLE", ...visibleItemWhere(viewerId), ...(keyset ?? {}) },
    select: {
      ...V1_ITEM_SELECT,
      user: { select: V1_ITEM_OWNER_SELECT },
      ...v1ItemStatsSelect(viewerId),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  })
  const { page, nextCursor } = paginate(feedRows, limit, (r) =>
    encodeCursor(r.createdAt, r.id),
  )

  // ── 3 ── pickup access for exactly this page. One query, not one per item.
  const access = await preciseAccessItemIds(viewerId, page.map((r) => r.id))

  // ── 4 ── trust tiers for this page's owners.
  //
  // The badge on every card reads from this and NOT from `owner.totalTrades`,
  // which is a denormalised counter that has drifted above the real completed
  // count. Deriving it here also charges DPA defaults against the tier, which
  // is the difference between a badge that describes someone and a badge that
  // contradicts the gate they are about to hit: without it a defaulter reads
  // "Top Trader" right up until the server refuses to let them initiate a
  // trade. See loadEffectiveTiers() for why it is three aggregates and not
  // three queries per owner.
  //
  // Deduplicated by that function, so a page where one person posted eight of
  // the twenty listings costs exactly what a page of twenty strangers does.
  const tiers = await loadEffectiveTiers(
    prisma,
    page.map((r) => ({ id: r.user.id, rating: r.user.rating })),
  )

  // ── 5 ── trending: the 7-day category groupBy that four web pages inline.
  // Blocked owners and moderator-hidden listings are excluded here too. A
  // trending chip is a count of things you can then go and look at; counting
  // listings the next screen refuses to show you makes the chip a lie and,
  // worse, leaks the existence of a blocked user's activity as a number.
  const trendingRows = await prisma.item.groupBy({
    by: ["category"],
    where: {
      createdAt: { gte: weekAgo },
      status: { not: "REMOVED" },
      ...visibleItemWhere(viewerId),
    },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 5,
  })

  // ── 6 ── match candidates.
  // Suggesting someone you blocked, or who blocked you, as a trading partner is
  // the single most conspicuous way a half-enforced block announces itself.
  const candidates = await prisma.user.findMany({
    where: {
      id: { not: viewerId },
      deletedAt: null,
      items: { some: { status: "AVAILABLE", moderationHiddenAt: null } },
      ...userNotBlocked(viewerId),
      ...notSuspendedWhere(),
    },
    select: {
      id: true, name: true, avatar: true, totalTrades: true,
      items: {
        where: { status: "AVAILABLE", moderationHiddenAt: null },
        select: { category: true },
        take: 5,
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 5,
  })

  // ── 7, 8, 9 ── the unread counts, one call each.
  const unreadMessages = await prisma.message.count({
    where: { receiverId: viewerId, read: false },
  })
  const unreadNotifications = await prisma.notification.count({
    where: { userId: viewerId, read: false },
  })
  const followRequests = await prisma.follow.count({
    where: { followeeId: viewerId, status: "PENDING" },
  })

  const myCategories = new Set(viewer.items.map((i) => i.category))
  const matches = candidates.map((u) => {
    const cats = [...new Set(u.items.map((i) => i.category))]
    const shared = cats.filter((c) => myCategories.has(c))
    const top = cats[0]
    return {
      userId: u.id,
      name: u.name,
      avatar: u.avatar,
      totalTrades: u.totalTrades,
      sharedCategories: shared,
      reason: shared.length
        ? `Both trading ${categoryLabel(shared[0])}`
        : top
          ? `Has ${categoryLabel(top)} you might like`
          : "New to Baylo",
    }
  })

  return ok(
    {
      viewer: {
        id: viewer.id,
        name: viewer.name,
        avatar: viewer.avatar,
        location: viewer.location,
        leaves: viewer.leaves,
        lifetimeLeaves: viewer.lifetimeLeaves,
        rank: getLeafRank(viewer.lifetimeLeaves),
        rating: viewer.rating,
        totalTrades: viewer.totalTrades,
        isVerified: viewer.isVerified,
      },
      unread: {
        messages: unreadMessages,
        notifications: unreadNotifications,
        followRequests,
      },
      feed: page.map((r) => v1Item(r as unknown as V1ItemRow, viewerId, access, tiers)),
      trending: trendingRows.map((r) => ({
        category: r.category,
        label: categoryLabel(r.category),
        hashtag: categoryHashtag(r.category as Category),
        count: r._count.id,
      })),
      matches,
    },
    { nextCursor },
  )
}
