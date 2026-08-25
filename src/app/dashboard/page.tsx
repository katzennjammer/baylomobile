import { auth } from "@/../auth"
import { redirect } from "next/navigation"
import prisma from "@/lib/prisma"
import { preciseAccessItemIds, resolvePickup } from "@/lib/item-visibility"
import BayloDashboard from "./baylo-dashboard"
import {
  computeGreenScore,
  computeTier,
  computeImpactData,
  KG_CO2_PER_TREE,
  type ImpactData,
} from "@/lib/impact-constants"
import { isLeavesOnlyTrade } from "@/lib/trade-format"
import { buildTasksStatus } from "@/lib/tasks"

export const dynamic = "force-dynamic"
export const revalidate = 0

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

const NOTIF_ICON: Record<string, string> = {
  TRADE_REQUEST: "swap",
  TRADE_ACCEPTED: "check",
  TRADE_REJECTED: "bolt",
  TRADE_COMPLETED: "star",
  NEW_MESSAGE: "chat",
  NEW_REVIEW: "star",
}

const CATEGORY_LABEL: Record<string, string> = {
  ELECTRONICS: "Electronics",
  CLOTHING: "Fashion",
  FURNITURE: "Home & Garden",
  BOOKS: "Books & Media",
  SPORTS: "Sports",
  TOYS: "Kids & Toys",
  TOOLS: "Tools & DIY",
  FOOD: "Food",
  SERVICES: "Services",
  OTHER: "Other",
}

const CATEGORY_HASHTAG: Record<string, string> = {
  ELECTRONICS: "#Electronics",
  CLOTHING:    "#Fashion",
  FURNITURE:   "#HomeGarden",
  BOOKS:       "#BooksMedia",
  SPORTS:      "#Sports",
  TOYS:        "#KidsToys",
  TOOLS:       "#ToolsDIY",
  FOOD:        "#Food",
  SERVICES:    "#Services",
  OTHER:       "#Miscellaneous",
}

function formatCondition(c: string): string {
  return c.replace(/_/g, " ").toLowerCase().replace(/^\w/, (ch) => ch.toUpperCase())
}

// `wantedItems` is free text again — the pickup envelope it used to carry has
// moved to its own columns, and reaches the client only through resolvePickup().
function wantedDisplay(raw: string | null): string {
  return raw?.trim() ? raw : "Open to offers";
}

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/login")

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user) redirect("/auth/login")

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [
    sentTrades, receivedTrades, recentMsgs, notifs, items,
    storyUsers, catGroupRaw, weeklyCount, followRequestCount, myFollows,
    completedTradesRaw, weeklyTradesRaw, trendingRaw,
    myItemCatsRaw, matchCandidatesRaw, tasksRaw,
  ] = await Promise.all([
    prisma.tradeRequest.findMany({
      where: { senderId: user.id, status: { in: ["PENDING", "ACCEPTED", "CONFIRMING"] } },
      select: {
        id: true, status: true,
        offeredItemId: true, requestedItemId: true,
        receiver:      { select: { id: true, name: true } },
        offeredItem:   { select: { title: true } },
        requestedItem: { select: { title: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 3,
    }),
    prisma.tradeRequest.findMany({
      where: { receiverId: user.id, status: { in: ["PENDING", "ACCEPTED", "CONFIRMING"] } },
      select: {
        id: true, status: true,
        offeredItemId: true, requestedItemId: true,
        sender:        { select: { id: true, name: true } },
        offeredItem:   { select: { title: true } },
        requestedItem: { select: { title: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 3,
    }),
    prisma.message.findMany({
      where: { OR: [{ senderId: user.id }, { receiverId: user.id }] },
      include: {
        sender: { select: { name: true } },
        receiver: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.notification.findMany({
      where: { userId: user.id },
      include: { actor: { select: { name: true, avatar: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    // Feed: latest available items from all users (public — no friends filter)
    prisma.item.findMany({
      where: { status: "AVAILABLE" },
      include: {
        user: { select: { id: true, name: true, location: true } },
        likes: { select: { userId: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    // Stories: other users who have available items, ordered by recency
    prisma.user.findMany({
      where: {
        id: { not: user.id },
        items: { some: { status: "AVAILABLE" } },
      },
      select: {
        id: true,
        name: true,
        items: {
          where: { status: "AVAILABLE" },
          orderBy: { updatedAt: "desc" },
          select: { category: true },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    // Category counts for real item stats
    prisma.item.groupBy({
      by: ["category"],
      where: { status: "AVAILABLE" },
      _count: { id: true },
    }),
    // Weekly completed trades count for the weekly goal widget
    prisma.tradeRequest.count({
      where: {
        OR: [{ senderId: user.id }, { receiverId: user.id }],
        status: "COMPLETED",
        updatedAt: { gte: weekAgo },
      },
    }),
    // Pending incoming follow requests count
    prisma.follow.count({
      where: { followeeId: user.id, status: "PENDING" },
    }),
    // Users the current user already follows (any status) — to derive button state
    prisma.follow.findMany({
      where: { followerId: user.id },
      select: { followeeId: true, status: true },
    }),
    // All completed trades with categories — for real eco impact calculation
    prisma.tradeRequest.findMany({
      where: {
        OR: [{ senderId: user.id }, { receiverId: user.id }],
        status: "COMPLETED",
      },
      select: {
        senderId: true,
        offeredItem:   { select: { category: true } },
        requestedItem: { select: { category: true } },
      },
    }),
    // Completed trades THIS WEEK with categories — for weekly CO₂
    prisma.tradeRequest.findMany({
      where: {
        OR: [{ senderId: user.id }, { receiverId: user.id }],
        status: "COMPLETED",
        updatedAt: { gte: weekAgo },
      },
      select: {
        senderId: true,
        offeredItem:   { select: { category: true } },
        requestedItem: { select: { category: true } },
      },
    }),
    // Trending: most-used categories in the last 7 days
    prisma.item.groupBy({
      by: ["category"],
      where: {
        createdAt: { gte: weekAgo },
        status: { not: "REMOVED" },
      },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }),
    // Current user's available item categories — used for match scoring
    prisma.item.findMany({
      where: { userId: user.id, status: "AVAILABLE" },
      select: { category: true },
    }),
    // Match candidates: other users with available items
    prisma.user.findMany({
      where: {
        id: { not: user.id },
        items: { some: { status: "AVAILABLE" } },
      },
      select: {
        name: true,
        totalTrades: true,
        items: {
          where: { status: "AVAILABLE" },
          select: { category: true },
          take: 5,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    // Read-only. Awards are event-driven now (settlement, POST /api/items,
    // PATCH /api/user); the dashboard no longer awards anything, so the
    // mobile client losing this page costs nothing. GET /api/tasks backfills.
    buildTasksStatus(user.id),
  ])

  const tasks = tasksRaw ?? { lifetimeLeaves: 0, leaves: 0, googleVerified: false, tasks: [] }

  // ── Impact data ───────────────────────────────────────────────────────────
  const impactBase = computeImpactData(user.id, completedTradesRaw)
  const weeklyBase = computeImpactData(user.id, weeklyTradesRaw)

  const impactData: ImpactData = {
    ...impactBase,
    treesEquiv: Math.floor(impactBase.co2Avoided / KG_CO2_PER_TREE),
    weeklyCO2:  weeklyBase.co2Avoided,
  }

  // ── Green score (one source of truth via impact-constants) ────────────────
  const greenScore = computeGreenScore(
    impactData.co2Avoided,
    impactData.waterSaved,
    impactData.itemsRehomed,
    impactData.wasteDiverted,
  )
  const tier = computeTier(greenScore)

  // ── Trending tags ─────────────────────────────────────────────────────────
  const trendingTags = trendingRaw.map((r) => CATEGORY_HASHTAG[r.category] ?? `#${r.category}`)

  // ── Suggested matches ─────────────────────────────────────────────────────
  const myCategories = new Set(myItemCatsRaw.map((i) => i.category))
  const matches = matchCandidatesRaw.map((u) => {
    const cats = [...new Set(u.items.map((i) => i.category))]
    const overlapCat = cats.find((c) => myCategories.has(c))
    const topCat = cats[0] ? (CATEGORY_LABEL[cats[0]] ?? cats[0]) : "items"
    const green = Math.min(100, Math.round(20 + u.totalTrades * 8))
    return {
      name: u.name,
      reason: overlapCat
        ? `Both trading ${CATEGORY_LABEL[overlapCat] ?? overlapCat}`
        : `Has ${topCat} you might like`,
      mutual: overlapCat ? "Mutual category match" : `Active in ${topCat}`,
      green,
    }
  })

  // ── Leaves-only: look up offeredLeaves for active trades ─────────────────
  const activeOfferedLeavesMap = new Map<string, number>()
  const offerLookups = [
    ...sentTrades
      .filter((t) => isLeavesOnlyTrade(t.offeredItemId, t.requestedItemId))
      .map((t) => ({ tradeId: t.id, senderId: user.id,     postId: t.requestedItemId })),
    ...receivedTrades
      .filter((t) => isLeavesOnlyTrade(t.offeredItemId, t.requestedItemId))
      .map((t) => ({ tradeId: t.id, senderId: t.sender.id, postId: t.requestedItemId })),
  ]

  if (offerLookups.length > 0) {
    const offerRecs = await prisma.offer.findMany({
      where: {
        OR: offerLookups.map(({ senderId, postId }) => ({ senderId, postId, status: "ACCEPTED" })),
        offeredLeaves: { gt: 0 },
      },
      select: { senderId: true, postId: true, offeredLeaves: true },
    })
    const offerMap = new Map(offerRecs.map((o) => [`${o.senderId}:${o.postId}`, o.offeredLeaves ?? 0]))
    for (const { tradeId, senderId, postId } of offerLookups) {
      const lv = offerMap.get(`${senderId}:${postId}`)
      if (lv) activeOfferedLeavesMap.set(tradeId, lv)
    }
  }

  // ── Active trades ─────────────────────────────────────────────────────────
  const activeTrades = [
    ...sentTrades.map((t) => {
      const lv = activeOfferedLeavesMap.get(t.id) ?? null
      const leavesOnly = isLeavesOnlyTrade(t.offeredItemId, t.requestedItemId)
      return {
        id: t.id,
        with: t.receiver.name,
        item: leavesOnly && lv ? `${lv.toLocaleString()} Leaves` : t.offeredItem.title,
        status: t.status === "PENDING" ? "Awaiting reply" : "Accepted · arrange pickup",
        tone: (t.status === "PENDING" ? "wait" : "go") as "wait" | "go" | "ship",
        rawStatus: t.status,
        offeredItemTitle:   leavesOnly && lv ? `${lv.toLocaleString()} Leaves` : t.offeredItem.title,
        requestedItemTitle: t.requestedItem.title,
        offeredLeaves: lv,
        sender:   { id: user.id,       name: user.name       },
        receiver: { id: t.receiver.id, name: t.receiver.name },
      }
    }),
    ...receivedTrades.map((t) => {
      const lv = activeOfferedLeavesMap.get(t.id) ?? null
      const leavesOnly = isLeavesOnlyTrade(t.offeredItemId, t.requestedItemId)
      return {
        id: t.id,
        with: t.sender.name,
        item: t.requestedItem.title,
        status: "Needs your review",
        tone: "go" as "wait" | "go" | "ship",
        rawStatus: t.status,
        offeredItemTitle:   leavesOnly && lv ? `${lv.toLocaleString()} Leaves` : t.offeredItem.title,
        requestedItemTitle: t.requestedItem.title,
        offeredLeaves: lv,
        sender:   { id: t.sender.id, name: t.sender.name },
        receiver: { id: user.id,     name: user.name     },
      }
    }),
  ].slice(0, 5)

  const seen = new Set<string>()
  const messages = recentMsgs
    .filter((m) => {
      const partnerId = m.senderId === user.id ? m.receiverId : m.senderId
      if (seen.has(partnerId)) return false
      seen.add(partnerId)
      return true
    })
    .slice(0, 5)
    .map((m) => {
      const isMine = m.senderId === user.id
      return {
        name: isMine ? m.receiver.name : m.sender.name,
        preview: (() => {
          try {
            const p = JSON.parse(m.content)
            if (p.type === "offer") return "Sent a trade offer"
            if (p.type === "offer_update") return `Offer ${String(p.status ?? "updated").toLowerCase()}`
            if (p.type === "shared_post") return `Shared: ${p.postItem}`
            if (p.type === "image") return "Sent an image"
            if (p.type === "voice") return "Sent a voice message"
          } catch { /* plain text */ }
          return m.content.length > 60 ? m.content.slice(0, 60) + "…" : m.content
        })(),
        time: timeAgo(m.createdAt),
        unread: !m.read && !isMine,
        partnerId: isMine ? m.receiverId : m.senderId,
      }
    })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notifications = notifs.map((n) => ({
    id: n.id,
    who: n.actor?.name ?? "Baylo",
    avatar: n.actor?.avatar ?? null,
    icon: (NOTIF_ICON[n.type] ?? "bell") as any,
    text: n.message,
    link: n.link ?? null,
    time: timeAgo(n.createdAt),
    unread: !n.read,
    actorId: n.actorId ?? null,
  }))

  // Same rule as the API: exact pickup only for the owner or an accepted
  // counterparty, coarse coordinates and no address for everyone else.
  const feedPickupAccess = await preciseAccessItemIds(user.id, items.map((i) => i.id))

  const feedPosts = items.map((item) => {
    let imageUrl: string | undefined
    try {
      const imgs = JSON.parse(item.images)
      if (Array.isArray(imgs) && imgs[0]) imageUrl = imgs[0]
    } catch { /* malformed JSON — use gradient placeholder */ }
    const wantsDisplay = wantedDisplay(item.wantedItems)
    const pickup = resolvePickup(item, user.id, feedPickupAccess)
    const tags = [CATEGORY_LABEL[item.category] ?? item.category]
    if (pickup) tags.push("Local pickup")
    return {
      id: item.id,
      userId: item.user.id,
      user: item.user.name,
      handle: item.user.name.toLowerCase().replace(/\s+/g, "").slice(0, 20),
      time: timeAgo(item.createdAt),
      city: item.user.location ?? "—",
      type: "offer" as const,
      text: item.description,
      item: item.title,
      wants: wantsDisplay,
      seed: item.id,
      tags,
      likes: item.likes.length,
      liked: item.likes.some((l) => l.userId === user.id),
      comments: item._count.comments,
      condition: formatCondition(item.condition),
      imageUrl,
      pickupLocation: pickup,
    }
  })

  const stories = storyUsers.map((u) => ({
    id: u.id,
    name: u.name,
    note: u.items[0] ? (CATEGORY_LABEL[u.items[0].category] ?? u.items[0].category) : "Trading",
  }))

  const categoryCounts = Object.fromEntries(
    catGroupRaw.map((r) => [r.category, r._count.id])
  )

  const city = user.location ?? "—"
  const handle = user.name.toLowerCase().replace(/\s+/g, "").slice(0, 20)

  const followingMap: Record<string, "PENDING" | "ACCEPTED"> = {}
  for (const f of myFollows) followingMap[f.followeeId] = f.status as "PENDING" | "ACCEPTED"

  return (
    <BayloDashboard
      user={{
        id: user.id,
        name: user.name,
        handle,
        avatar: user.avatar ?? null,
        city,
        rating: user.rating,
        trades: user.totalTrades,
        streak: 0,
        greenScore,
        tier,
        leaves: user.leaves,
      }}
      impactData={impactData}
      tasks={tasks}
      trendingTags={trendingTags}
      activeTrades={activeTrades}
      messages={messages}
      notifications={notifications}
      feedPosts={feedPosts}
      stories={stories}
      categoryCounts={categoryCounts}
      weeklyTrades={weeklyCount}
      followRequestCount={followRequestCount}
      followingMap={followingMap}
      matches={matches}
    />
  )
}
