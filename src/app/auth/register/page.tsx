import prisma from "@/lib/prisma"
import RegisterClient, { type SwapDisplay } from "./RegisterClient"

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

export default async function RegisterPage() {
  const [rawSwaps, userCount, recentUsers] = await Promise.all([
    prisma.tradeRequest.findMany({
      where: { status: "COMPLETED" },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: {
        id: true,
        updatedAt: true,
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

  const swaps: SwapDisplay[] = rawSwaps.map((t) => ({
    id: t.id,
    when: formatRelativeTime(t.updatedAt),
    senderFirstName: t.sender.name.split(" ")[0],
    receiverFirstName: t.receiver.name.split(" ")[0],
    itemA: {
      title: t.offeredItem.title,
      image: parseFirstImage(t.offeredItem.images),
    },
    itemB: {
      title: t.requestedItem.title,
      image: parseFirstImage(t.requestedItem.images),
    },
  }))

  return (
    <RegisterClient
      swaps={swaps}
      userCount={userCount}
      recentUsers={recentUsers}
    />
  )
}
