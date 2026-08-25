import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import pusher from "@/lib/pusher"
import { availableLeaves } from "@/lib/leaves"
import { createOfferSchema, parseBody } from "@/lib/validation"

export async function POST(req: NextRequest) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // createOfferSchema rejects a non-positive offeredLeaves outright. The old
    // `if (offeredLeaves && offeredLeaves > 0)` guard below simply skipped the
    // balance check for a negative value, which then inflated availableLeaves.
    const parsed = await parseBody(req, createOfferSchema)
    if (!parsed.ok) return parsed.response
    const { postId, offeredItems, offeredLeaves, message } = parsed.data

    const post = await prisma.item.findUnique({
      where: { id: postId },
      include: { user: { select: { id: true, name: true } } },
    })
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })
    if (post.userId === session.user.id) {
      return NextResponse.json({ error: "Cannot make an offer on your own post" }, { status: 400 })
    }

    if (offeredLeaves && offeredLeaves > 0) {
      const available = await availableLeaves(prisma, session.user.id)
      if (offeredLeaves > available) {
        return NextResponse.json(
          { error: `Not enough Pasa Leaves — you need ${offeredLeaves} but have ${available} available` },
          { status: 400 },
        )
      }
    }

    const offer = await prisma.offer.create({
      data: {
        postId,
        senderId: session.user.id,
        receiverId: post.userId,
        offeredItems: JSON.stringify(offeredItems || []),
        offeredLeaves: offeredLeaves || null,
        message: message?.trim() || null,
        status: "PENDING",
      },
    })

    const sender = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, avatar: true },
    })

    // Build the offer card content for the message
    const msgContent = JSON.stringify({
      type: "offer",
      offerId: offer.id,
      postId,
      postItem: { title: post.title },
      offeredItems: offeredItems || [],
      offeredLeaves: offeredLeaves || null,
      userMessage: message?.trim() || null,
      senderName: sender?.name ?? "Someone",
      senderId: session.user.id,
      status: "PENDING",
    })

    const chatMessage = await prisma.message.create({
      data: {
        senderId: session.user.id,
        receiverId: post.userId,
        content: msgContent,
      },
    })

    const pusherPayload = {
      id: chatMessage.id,
      content: chatMessage.content,
      senderId: chatMessage.senderId,
      receiverId: chatMessage.receiverId,
      createdAt: chatMessage.createdAt.toISOString(),
      senderName: sender?.name ?? "",
      senderAvatar: sender?.avatar ?? null,
    }
    pusher.trigger(`private-user-${post.userId}`, "new-message", pusherPayload).catch(() => {})

    await prisma.notification.deleteMany({
      where: { userId: post.userId, actorId: session.user.id, type: "NEW_MESSAGE", read: false },
    })
    await prisma.notification.create({
      data: {
        userId: post.userId,
        type: "NEW_MESSAGE",
        message: `made you an offer on "${post.title}"`,
        link: `/dashboard/messages?partner=${session.user.id}`,
        actorId: session.user.id,
      },
    })

    return NextResponse.json({ offerId: offer.id, messageId: chatMessage.id, partnerId: post.userId, partnerName: post.user.name }, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
