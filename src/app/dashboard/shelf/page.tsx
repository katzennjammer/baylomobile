import { auth } from "@/../auth"
import { redirect } from "next/navigation"
import prisma from "@/lib/prisma"
import { computeImpactData } from "@/lib/impact-constants"
import ShelfClient from "./ShelfClient"
import type { ShelfItem } from "./ShelfClient"

export const dynamic = "force-dynamic"
export const revalidate = 0

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

const NOTIF_ICON: Record<string, string> = {
  TRADE_REQUEST:   "swap",
  TRADE_ACCEPTED:  "check",
  TRADE_REJECTED:  "bolt",
  TRADE_COMPLETED: "star",
  TRADE_CANCELLED: "bolt",
  NEW_MESSAGE:     "chat",
  NEW_REVIEW:      "star",
}

function firstImage(raw: string): string | null {
  try {
    const imgs = JSON.parse(raw)
    return Array.isArray(imgs) && imgs[0] ? (imgs[0] as string) : null
  } catch {
    return null
  }
}

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000)
  if (s < 60)    return `${s}s`
  if (s < 3600)  return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export default async function ShelfPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/login")
  const myId = session.user.id

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  // ── Parallel fetch — shell data + items ───────────────────────────────────
  const [
    user,
    items,
    rawMsgs,
    rawNotifs,
    followReqCount,
    weeklyCount,
    weeklyTradesRaw,
    trendingRaw,
  ] = await Promise.all([
    prisma.user.findUnique({
      where: { id: myId },
      select: { name: true, avatar: true },
    }),
    prisma.item.findMany({
      where: { userId: myId, status: { in: ["AVAILABLE", "OWNED"] } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.message.findMany({
      where: { receiverId: myId },
      include: { sender: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.notification.findMany({
      where: { userId: myId },
      include: { actor: { select: { name: true, avatar: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.follow.count({
      where: { followeeId: myId, status: "PENDING" },
    }),
    prisma.tradeRequest.count({
      where: {
        OR: [{ senderId: myId }, { receiverId: myId }],
        status: "COMPLETED",
        updatedAt: { gte: weekAgo },
      },
    }),
    prisma.tradeRequest.findMany({
      where: {
        OR: [{ senderId: myId }, { receiverId: myId }],
        status: "COMPLETED",
        updatedAt: { gte: weekAgo },
      },
      select: {
        senderId:      true,
        offeredItem:   { select: { category: true } },
        requestedItem: { select: { category: true } },
      },
    }),
    prisma.item.groupBy({
      by: ["category"],
      where: { createdAt: { gte: weekAgo }, status: { not: "REMOVED" } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }),
  ])

  if (!user) redirect("/auth/login")

  // ── Life counts — how many completed trades involved each item ─────────────
  const itemIds = items.map(i => i.id)

  const [offeredCounts, requestedCounts] = itemIds.length > 0
    ? await Promise.all([
        prisma.tradeRequest.groupBy({
          by: ["offeredItemId"],
          where: { offeredItemId: { in: itemIds }, status: "COMPLETED" },
          _count: { id: true },
        }),
        prisma.tradeRequest.groupBy({
          by: ["requestedItemId"],
          where: { requestedItemId: { in: itemIds }, status: "COMPLETED" },
          _count: { id: true },
        }),
      ])
    : [[], []]

  const lifeMap = new Map<string, number>()
  for (const o of offeredCounts)   lifeMap.set(o.offeredItemId!,   (lifeMap.get(o.offeredItemId!)   ?? 0) + o._count.id)
  for (const r of requestedCounts) lifeMap.set(r.requestedItemId!, (lifeMap.get(r.requestedItemId!) ?? 0) + r._count.id)

  // ── Serialize items ────────────────────────────────────────────────────────
  const serializedItems: ShelfItem[] = items.map(item => ({
    id:         item.id,
    title:      item.title,
    status:     item.status as "AVAILABLE" | "OWNED",
    image:      firstImage(item.images),
    condition:  item.condition as string,
    leaves:     item.valueLeaves,
    lifeNumber: (lifeMap.get(item.id) ?? 0) + 1,
    createdAt:  item.createdAt.toISOString(),
  }))

  // ── Weekly CO₂ via real category factors ─────────────────────────────────
  const weeklyCO2 = computeImpactData(myId, weeklyTradesRaw).co2Avoided

  const trendingTags = trendingRaw.map(r => CATEGORY_HASHTAG[r.category] ?? `#${r.category}`)

  // ── Messages (deduplicated by sender) ─────────────────────────────────────
  const msgSeen = new Set<string>()
  const messages = rawMsgs
    .filter(m => { if (msgSeen.has(m.senderId)) return false; msgSeen.add(m.senderId); return true })
    .slice(0, 5)
    .map(m => ({
      name:      m.sender.name,
      preview:   (() => {
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
      time:      timeAgo(m.createdAt),
      unread:    !m.read,
      partnerId: m.senderId,
    }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notifications = rawNotifs.map(n => ({
    id:      n.id,
    who:     n.actor?.name ?? "Baylo",
    avatar:  n.actor?.avatar ?? null,
    icon:    (NOTIF_ICON[n.type] ?? "bell") as any,
    text:    n.message,
    link:    n.link ?? null,
    time:    timeAgo(n.createdAt),
    unread:  !n.read,
    actorId: n.actorId ?? null,
  }))

  const handle = user.name.toLowerCase().replace(/\s+/g, "").slice(0, 20)

  return (
    <ShelfClient
      me={{ name: user.name, handle, avatar: user.avatar ?? null }}
      myId={myId}
      items={serializedItems}
      followReqCount={followReqCount}
      notifs={notifications}
      messages={messages}
      weeklyTrades={weeklyCount}
      weeklyCO2={weeklyCO2}
      trendingTags={trendingTags}
    />
  )
}
