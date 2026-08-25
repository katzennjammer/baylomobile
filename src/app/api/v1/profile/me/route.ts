import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { getLeafRank, TASK_ORDER, TASK_REWARDS } from "@/lib/task-constants"
import {
  computeImpactData, computeGreenScore, computeTier, KG_CO2_PER_TREE,
} from "@/lib/impact-constants"
import { ok, unauthenticated, invalid } from "@/lib/v1/envelope"
import { parseQuery, paginationShape } from "@/lib/v1/query"
import { decodeCursor, encodeCursor, olderThan, paginate } from "@/lib/v1/cursor"
import { V1_ITEM_SELECT, V1_ITEM_OWNER_SELECT, v1ItemStatsSelect, v1Item, type V1ItemRow } from "@/lib/v1/item"
import { taskLabel } from "@/lib/v1/taxonomy"
import { loadStanding, publicStanding } from "@/lib/reputation-gate"

export const dynamic = "force-dynamic"

/**
 * GET /api/v1/profile/me — the shelf and profile screens, folded into one.
 *
 * SIX queries, not the five the shapes proposed. The proposal folded every
 * count onto the user row, and one of them will not fold: `listed` and `owned`
 * are two different filters over the SAME `items` relation, and a Prisma
 * `_count` select takes one filter per relation. A status groupBy answers both
 * in one query; the alternative was two filtered counts, which is worse.
 *
 *   1  user row, with the single-filter counts nested
 *   2  item status groupBy (listed / owned)
 *   3  items page
 *   4  completed trades with categories, for impact
 *   5  reviews received
 *   6  task completions
 *
 * NOTE the absence of a pickup-access query. These are the viewer's OWN items,
 * and resolvePickup() grants the owner precise access without consulting
 * anything — so the lookup every other item route needs is genuinely free here,
 * not merely skipped.
 *
 * Tasks are READ here, never awarded. Awarding is event-driven; GET /api/tasks
 * remains the reconcile path and is not duplicated.
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
  if (parsed.data.cursor && !cursor) return invalid("Malformed cursor")

  // ── 1 ──
  const user = await prisma.user.findUnique({
    where: { id: viewerId },
    select: {
      id: true, name: true, avatar: true, bio: true, location: true, email: true,
      rating: true, totalTrades: true, leaves: true, lifetimeLeaves: true,
      isVerified: true, createdAt: true,
      _count: {
        select: {
          reviewsReceived: true,
          followers: { where: { status: "ACCEPTED" } },
          following: { where: { status: "ACCEPTED" } },
        },
      },
    },
  })
  if (!user) return unauthenticated()

  // ── 2 ── both shelf tabs in one pass.
  const statusCounts = await prisma.item.groupBy({
    by: ["status"],
    where: { userId: viewerId, status: { in: ["AVAILABLE", "OWNED"] } },
    _count: { id: true },
  })
  const countFor = (s: string) => statusCounts.find((r) => r.status === s)?._count.id ?? 0

  // ── 3 ── the shelf itself: both tabs' worth, newest first.
  const itemRows = await prisma.item.findMany({
    where: { userId: viewerId, status: { in: ["AVAILABLE", "OWNED"] }, ...(olderThan(cursor) ?? {}) },
    select: {
      ...V1_ITEM_SELECT,
      user: { select: V1_ITEM_OWNER_SELECT },
      ...v1ItemStatsSelect(viewerId),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  })
  const { page, nextCursor } = paginate(itemRows, limit, (r) => encodeCursor(r.createdAt, r.id))

  // ── 4 ── completed trades, for the impact figures.
  const trades = await prisma.tradeRequest.findMany({
    where: {
      status: "COMPLETED",
      OR: [{ senderId: viewerId }, { receiverId: viewerId }],
    },
    select: {
      senderId: true,
      updatedAt: true,
      offeredItem: { select: { category: true } },
      requestedItem: { select: { category: true } },
    },
  })

  // ── 5 ──
  const reviews = await prisma.review.findMany({
    where: { revieweeId: viewerId },
    select: {
      id: true, rating: true, comment: true, createdAt: true, tradeId: true,
      reviewer: { select: { id: true, name: true, avatar: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
  })

  // ── 6 ──
  const completions = await prisma.taskCompletion.findMany({
    where: { userId: viewerId },
    select: { task: true, leaves: true },
  })

  // ── 7 ── the viewer's trust tier and what it permits.
  //
  // Served so the client can grey out what is locked AND SAY WHY, rather than
  // guessing at the thresholds or discovering them from a 403 after the user
  // has filled in a form. Everything here is advisory: the same numbers are
  // re-derived server-side on every attempt by @/lib/reputation-gate, and
  // nothing a client sends about its own tier is ever read back.
  //
  // Costs four more queries (loadStanding runs the lazy default sweep, then
  // reads the rating, the trade count and two contract sets). Counted honestly
  // rather than folded into the six above: the header comment on this route
  // says SIX queries, and it is now SIX PLUS FOUR.
  const standing = await loadStanding(viewerId)

  // Impact. computeImpactData() returns everything except the two derived
  // figures, which are computed here from the same trade set — no extra query.
  const base = computeImpactData(viewerId, trades)
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const weekly = computeImpactData(
    viewerId,
    trades.filter((t) => t.updatedAt.getTime() >= weekAgo),
  )
  const greenScore = computeGreenScore(
    base.co2Avoided, base.waterSaved, base.itemsRehomed, base.wasteDiverted,
  )

  const byTask = new Map<string, { count: number; leavesEarned: number }>()
  for (const c of completions) {
    const cur = byTask.get(c.task) ?? { count: 0, leavesEarned: 0 }
    cur.count += 1
    cur.leavesEarned += c.leaves
    byTask.set(c.task, cur)
  }

  return ok(
    {
      user: {
        id: user.id,
        name: user.name,
        avatar: user.avatar,
        bio: user.bio,
        location: user.location,
        email: user.email,
        rating: user.rating,
        totalTrades: user.totalTrades,
        leaves: user.leaves,
        lifetimeLeaves: user.lifetimeLeaves,
        rank: getLeafRank(user.lifetimeLeaves),
        isVerified: user.isVerified,
        createdAt: user.createdAt,
      },
      counts: {
        listed: countFor("AVAILABLE"),
        owned: countFor("OWNED"),
        completedTrades: trades.length,
        reviews: user._count.reviewsReceived,
        followers: user._count.followers,
        following: user._count.following,
      },
      items: page.map((r) => v1Item(r as unknown as V1ItemRow, viewerId)),
      reviews,
      tasks: {
        leaves: user.leaves,
        lifetimeLeaves: user.lifetimeLeaves,
        verified: user.isVerified,
        items: TASK_ORDER.map((task) => {
          const agg = byTask.get(task)
          return {
            task,
            label: taskLabel(task),
            done: (agg?.count ?? 0) > 0,
            count: agg?.count ?? 0,
            reward: TASK_REWARDS[task],
            leavesEarned: agg?.leavesEarned ?? 0,
          }
        }),
      },
      // The tier, its limits, and the DPA state the limits govern.
      reputation: publicStanding(standing),
      impact: {
        co2Avoided: Math.round(base.co2Avoided * 10) / 10,
        waterSaved: Math.round(base.waterSaved),
        itemsRehomed: base.itemsRehomed,
        wasteDiverted: Math.round(base.wasteDiverted * 10) / 10,
        treesEquiv: Math.round(base.co2Avoided / KG_CO2_PER_TREE),
        weeklyCO2: Math.round(weekly.co2Avoided * 10) / 10,
        greenScore,
        tier: computeTier(greenScore),
      },
    },
    { nextCursor },
  )
}
