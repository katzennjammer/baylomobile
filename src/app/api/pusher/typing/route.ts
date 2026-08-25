import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import pusher from "@/lib/pusher"
import { parseBody, typingSchema } from "@/lib/validation"

export async function POST(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsed = await parseBody(req, typingSchema)
  if (!parsed.ok) return parsed.response
  const { receiverId } = parsed.data

  const myId = session.user.id
  if (receiverId === myId) {
    return NextResponse.json({ error: "Cannot send a typing indicator to yourself" }, { status: 400 })
  }

  // `receiverId` used to go straight into a channel name, which let any account
  // publish an event — carrying its own attacker-chosen display name — into any
  // other user's private channel. A typing indicator only makes sense inside an
  // existing conversation, so that is what is required: at least one message in
  // either direction. This is a read the caller cannot forge.
  const conversation = await prisma.message.findFirst({
    where: {
      OR: [
        { senderId: myId, receiverId },
        { senderId: receiverId, receiverId: myId },
      ],
    },
    select: { id: true },
  })

  if (!conversation) {
    // 403 rather than 404: whether that user exists is not the question being
    // answered, and answering it would make this an account-enumeration probe.
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  await pusher.trigger(`private-user-${receiverId}`, "typing", {
    senderId: myId,
    name: session.user.name ?? "Someone",
  })

  return NextResponse.json({ ok: true })
}
