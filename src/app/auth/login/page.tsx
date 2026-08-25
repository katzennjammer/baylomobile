import prisma from "@/lib/prisma"
import LoginClient, { type SwapDisplay } from "./LoginClient"
import { isLeavesOnlyTrade } from "@/lib/trade-format"

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function parseFirstImage(images: string): string | null {
  try {
    const arr = JSON.parse(images)
    return Array.isArray(arr) && arr[0] ? (arr[0] as string) : null
  } catch {
    return null
  }
}

export default async function LoginPage() {
  const [rawSwaps, userCount, recentUsers] = await Promise.all([
    prisma.tradeRequest.findMany({
      where: { status: "COMPLETED" },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: {
        id: true,
        updatedAt: true,
        senderId: true,
        offeredItemId: true,
        requestedItemId: true,
        sender: { select: { name: true } },
        receiver: { select: { name: true } },
        offeredItem: { select: { title: true, images: true } },
        requestedItem: { select: { title: true, images: true } },
      },
    }),
    prisma.user.count(),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { id: true, name: true, avatar: true },
    }),
  ])

  // Recover offeredLeaves for any Leaves-only completed trades
  const loginPointsOnly = rawSwaps.filter((t) => isLeavesOnlyTrade(t.offeredItemId, t.requestedItemId))
  const loginOfferedLeavesMap = new Map<string, number>()

  if (loginPointsOnly.length > 0) {
    const offerRecs = await prisma.offer.findMany({
      where: {
        OR: loginPointsOnly.map((t) => ({ senderId: t.senderId, postId: t.requestedItemId, status: "ACCEPTED" })),
        offeredLeaves: { gt: 0 },
      },
      select: { senderId: true, postId: true, offeredLeaves: true },
    })
    const offerMap = new Map(offerRecs.map((o) => [`${o.senderId}:${o.postId}`, o.offeredLeaves ?? 0]))
    for (const t of loginPointsOnly) {
      const lv = offerMap.get(`${t.senderId}:${t.requestedItemId}`)
      if (lv) loginOfferedLeavesMap.set(t.id, lv)
    }
  }

  const swaps: SwapDisplay[] = rawSwaps.map((t) => ({
    id: t.id,
    when: formatRelativeTime(t.updatedAt),
    senderFirstName: t.sender.name.split(" ")[0],
    receiverFirstName: t.receiver.name.split(" ")[0],
    offeredLeaves: loginOfferedLeavesMap.get(t.id) ?? null,
    itemA: {
      title: t.offeredItem.title,
      image: parseFirstImage(t.offeredItem.images),
    },
    itemB: {
      title: t.requestedItem.title,
      image: parseFirstImage(t.requestedItem.images),
    },
  }))

  return <LoginClient swaps={swaps} userCount={userCount} recentUsers={recentUsers} />
}
