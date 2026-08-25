import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: tradeId } = await params
    const myId = session.user.id

    const trade = await prisma.tradeRequest.findUnique({
      where:  { id: tradeId },
      select: { senderId: true, receiverId: true, status: true },
    })

    if (!trade) return NextResponse.json({ error: "Trade not found" }, { status: 404 })
    if (trade.senderId !== myId && trade.receiverId !== myId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    if (trade.status === "COMPLETED") {
      return NextResponse.json({ started: true, senderSubmitted: true, receiverSubmitted: true, completed: true })
    }

    const codes = await prisma.swapConfirmationCode.findMany({
      where:  { tradeId },
      select: { userId: true, used: true, expiresAt: true },
    })

    const senderCode   = codes.find((c) => c.userId === trade.senderId)
    const receiverCode = codes.find((c) => c.userId === trade.receiverId)

    return NextResponse.json({
      started:           codes.length === 2,
      senderSubmitted:   senderCode?.used   ?? false,
      receiverSubmitted: receiverCode?.used ?? false,
      completed:         (trade.status as string) === "COMPLETED",
    })
  } catch (err) {
    console.error("[confirm/status]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
