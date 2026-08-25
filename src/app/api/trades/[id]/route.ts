import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import pusher from "@/lib/pusher"
import { parseBody, tradeActionSchema } from "@/lib/validation"

// PATCH /api/trades/[id]
// body: { action: "cancel" | "hide" }
// cancel: sets status CANCELLED, frees items if IN_TRADE, notifies other party
// hide:   soft-hides trade from current user's view only (hiddenBySender or hiddenByReceiver)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: tradeId } = await params
    const myId = session.user.id
    const parsed = await parseBody(req, tradeActionSchema)
    if (!parsed.ok) return parsed.response
    const { action } = parsed.data

    const trade = await prisma.tradeRequest.findUnique({
      where: { id: tradeId },
      include: {
        sender:        { select: { id: true, name: true } },
        receiver:      { select: { id: true, name: true } },
        offeredItem:   { select: { id: true, title: true, status: true } },
        requestedItem: { select: { id: true, title: true, status: true } },
      },
    })

    if (!trade) return NextResponse.json({ error: "Trade not found" }, { status: 404 })

    const isSender   = trade.senderId === myId
    const isReceiver = trade.receiverId === myId
    if (!isSender && !isReceiver) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // ── cancel ────────────────────────────────────────────────────────────────
    if (action === "cancel") {
      const cancellable = ["PENDING", "ACCEPTED", "CONFIRMING"]
      if (!cancellable.includes(trade.status)) {
        return NextResponse.json({ error: "Trade cannot be cancelled in its current state" }, { status: 400 })
      }

      const otherId   = isSender ? trade.receiverId : trade.senderId
      const otherName = isSender ? trade.receiver.name : trade.sender.name
      const itemIds   = [trade.offeredItemId, trade.requestedItemId]

      await prisma.tradeRequest.update({ where: { id: tradeId }, data: { status: "CANCELLED" } })

      // Free items back to AVAILABLE only if they were locked for this trade (IN_TRADE)
      // Note: only free if neither item has already been marked TRADED by a race
      await prisma.item.updateMany({
        where: { id: { in: itemIds }, status: "IN_TRADE" },
        data: { status: "AVAILABLE" },
      })

      await prisma.notification.create({
        data: {
          userId:  otherId,
          type:    "TRADE_CANCELLED",
          message: `${isSender ? trade.sender.name : trade.receiver.name} cancelled the trade for "${trade.requestedItem.title}".`,
          link:    "/dashboard/trades",
          actorId: myId,
        },
      })

      await pusher.trigger(`private-user-${otherId}`, "trade-status-changed", {
        tradeId,
        newStatus: "CANCELLED",
        itemIds,
      })
      // Also notify the canceller's own channel so other tabs update
      await pusher.trigger(`private-user-${myId}`, "trade-status-changed", {
        tradeId,
        newStatus: "CANCELLED",
        itemIds,
      })

      void otherName
      return NextResponse.json({ ok: true })
    }

    // ── hide (soft-remove from current user's view only) ──────────────────────
    if (action === "hide") {
      // Only allow hiding dead trades (completed / declined / cancelled)
      const hideable = ["COMPLETED", "REJECTED", "CANCELLED"]
      if (!hideable.includes(trade.status)) {
        return NextResponse.json({ error: "Only completed or dead trades can be hidden" }, { status: 400 })
      }

      await prisma.tradeRequest.update({
        where: { id: tradeId },
        data: isSender ? { hiddenBySender: true } : { hiddenByReceiver: true },
      })

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
