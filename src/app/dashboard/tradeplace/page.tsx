import { auth } from "@/../auth"
import { redirect } from "next/navigation"
import prisma from "@/lib/prisma"
import TradeplaceClient from "./TradeplaceClient"
import type { SerializedItem } from "./TradeplaceClient"
import { preciseAccessItemIds, resolvePickup } from "@/lib/item-visibility"

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

const CAT_LABELS: Record<string, string> = {
  ELECTRONICS: "Electronics", CLOTHING: "Fashion", FURNITURE: "Home & Garden",
  BOOKS: "Books & Media", SPORTS: "Sports", TOYS: "Kids & Toys",
  TOOLS: "Tools & DIY", FOOD: "Food", SERVICES: "Services", OTHER: "Other",
}

function topUserFromPairs(pairs: Array<{ senderId: string; receiverId: string }>) {
  if (pairs.length === 0) return null
  const counts = new Map<string, number>()
  for (const { senderId, receiverId } of pairs) {
    counts.set(senderId, (counts.get(senderId) ?? 0) + 1)
    counts.set(receiverId, (counts.get(receiverId) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null
}

export default async function TradeplacePage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string; edit?: string }>;
}) {
  const { open: initialOpen, edit: initialEdit } = await searchParams;
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/login")

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [rawItems, me, recentMsgs, notifs, followReqCount, weeklyTrades,
         recentTradePairs, trendingCatRaw, tickerTradesRaw] = await Promise.all([
    prisma.item.findMany({
      where: { status: "AVAILABLE" },
      include: { user: { select: { id: true, name: true, avatar: true, rating: true, totalTrades: true, lifetimeLeaves: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, avatar: true, leaves: true },
    }),
    prisma.message.findMany({
      where: { receiverId: session.user.id },
      include: { sender: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.notification.findMany({
      where: { userId: session.user.id },
      include: { actor: { select: { name: true, avatar: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.follow.count({
      where: { followeeId: session.user.id, status: "PENDING" },
    }),
    prisma.tradeRequest.count({
      where: {
        OR: [{ senderId: session.user.id }, { receiverId: session.user.id }],
        status: "COMPLETED",
        updatedAt: { gte: weekAgo },
      },
    }),
    // Trader of the week: completed trade pairs in last 7 days
    prisma.tradeRequest.findMany({
      where: { status: "COMPLETED", updatedAt: { gte: weekAgo } },
      select: { senderId: true, receiverId: true },
    }),
    // Trending category: most AVAILABLE listings posted in last 7 days
    prisma.item.groupBy({
      by: ["category"],
      where: { status: "AVAILABLE", createdAt: { gte: weekAgo } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 1,
    }),
    // Ticker: most recent completed trades with item titles
    prisma.tradeRequest.findMany({
      where: { status: "COMPLETED" },
      include: {
        sender: { select: { name: true } },
        offeredItem: { select: { title: true } },
        requestedItem: { select: { title: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
  ])

  if (!me) redirect("/auth/login")

  const itemIds = rawItems.map((i) => i.id)
  const completedTradeItems = itemIds.length > 0
    ? await prisma.tradeRequest.findMany({
        where: {
          status: "COMPLETED",
          OR: [{ offeredItemId: { in: itemIds } }, { requestedItemId: { in: itemIds } }],
        },
        select: { offeredItemId: true, requestedItemId: true },
      })
    : []

  const tradeCountMap = new Map<string, number>()
  for (const t of completedTradeItems) {
    tradeCountMap.set(t.offeredItemId,   (tradeCountMap.get(t.offeredItemId)   ?? 0) + 1)
    tradeCountMap.set(t.requestedItemId, (tradeCountMap.get(t.requestedItemId) ?? 0) + 1)
  }

  // Same pickup rule the API uses. A server component that hands coordinates to
  // a client component has published them just as surely as a JSON route would.
  const pickupAccess = await preciseAccessItemIds(session.user.id, itemIds)

  const items: SerializedItem[] = rawItems.filter((item) => item.user != null).map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    images: item.images,
    category: item.category as string,
    condition: item.condition as string,
    valueLeaves: item.valueLeaves,
    wanted: item.wantedItems,
    pickup: resolvePickup(item, session.user!.id, pickupAccess),
    imageHash: item.imageHash,
    userId: item.userId,
    tradeCount: tradeCountMap.get(item.id) ?? 0,
    user: {
      id:          item.user.id,
      name:        item.user.name,
      avatar:      item.user.avatar,
      rating:      item.user.rating,
      totalTrades: item.user.totalTrades,
    },
  }))

  const seen = new Set<string>()
  const messages = recentMsgs
    .filter((m) => { if (seen.has(m.senderId)) return false; seen.add(m.senderId); return true })
    .slice(0, 5)
    .map((m) => ({
      name: m.sender.name,
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
      unread: !m.read,
      partnerId: m.senderId,
    }))

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

  // ── Trader of the week (7-day primary, all-time fallback) ─────────────────
  let traderOfWeek: { name: string; avatar: string | null; rating: number; tradeCount: number } | null = null
  {
    let topEntry = topUserFromPairs(recentTradePairs)
    if (!topEntry) {
      const allTimePairs = await prisma.tradeRequest.findMany({
        where: { status: "COMPLETED" },
        select: { senderId: true, receiverId: true },
      })
      topEntry = topUserFromPairs(allTimePairs)
    }
    if (topEntry) {
      const [topId, topCount] = topEntry
      const topUser = await prisma.user.findUnique({
        where: { id: topId },
        select: { name: true, avatar: true, rating: true },
      })
      if (topUser) traderOfWeek = { ...topUser, tradeCount: topCount }
    }
  }

  // ── Trending category (7-day primary, all-time fallback) ─────────────────
  let trendingCategory: { value: string; label: string; count: number } | null = null
  if (trendingCatRaw.length > 0) {
    const c = trendingCatRaw[0]
    trendingCategory = { value: c.category, label: CAT_LABELS[c.category] ?? c.category, count: c._count.id }
  } else {
    const allCat = await prisma.item.groupBy({
      by: ["category"],
      where: { status: "AVAILABLE" },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 1,
    })
    if (allCat.length > 0) {
      const c = allCat[0]
      trendingCategory = { value: c.category, label: CAT_LABELS[c.category] ?? c.category, count: c._count.id }
    }
  }

  // ── Recent trades for ticker ──────────────────────────────────────────────
  const recentTrades = tickerTradesRaw.map((t) => ({
    who: t.sender.name,
    gave: t.offeredItem.title,
    got: t.requestedItem.title,
    t: timeAgo(t.updatedAt),
  }))

  return (
    <TradeplaceClient
      items={items}
      me={me}
      followReqCount={followReqCount}
      notifs={notifications}
      messages={messages}
      weeklyTrades={weeklyTrades}
      initialOpen={initialOpen ?? null}
      initialEdit={initialEdit ?? null}
      traderOfWeek={traderOfWeek}
      trendingCategory={trendingCategory}
      recentTrades={recentTrades}
    />
  )
}
