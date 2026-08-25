import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import pusher from "@/lib/pusher"
import { createMessageSchema, parseBody } from "@/lib/validation"

export async function GET(req: NextRequest) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const partnerId = new URL(req.url).searchParams.get("partnerId")
    if (!partnerId) return NextResponse.json({ error: "partnerId required" }, { status: 400 })

    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: session.user.id, receiverId: partnerId },
          { senderId: partnerId, receiverId: session.user.id },
        ],
      },
      orderBy: { createdAt: "asc" },
    })

    await prisma.message.updateMany({
      where: { senderId: partnerId, receiverId: session.user.id, read: false },
      data: { read: true },
    })

    return NextResponse.json(messages)
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const parsed = await parseBody(req, createMessageSchema)
    if (!parsed.ok) return parsed.response
    const { receiverId, content, tradeId } = parsed.data

    const message = await prisma.message.create({
      data: {
        senderId: session.user.id,
        receiverId,
        content,
        tradeId: tradeId || null,
      },
    })

    await prisma.notification.deleteMany({
      where: { userId: receiverId, actorId: session.user.id, type: "NEW_MESSAGE", read: false },
    })
    await prisma.notification.create({
      data: {
        userId: receiverId,
        type: "NEW_MESSAGE",
        message: "sent you a message",
        link: `/dashboard/messages?partner=${session.user.id}`,
        actorId: session.user.id,
      },
    })

    // Push to receiver's private channel
    const payload = {
      id: message.id,
      content: message.content,
      senderId: message.senderId,
      receiverId: message.receiverId,
      createdAt: message.createdAt.toISOString(),
      senderName: session.user.name ?? "",
      senderAvatar: session.user.image ?? null,
    }
    pusher.trigger(`private-user-${receiverId}`, "new-message", payload).catch(() => {})

    return NextResponse.json(message, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
