import { NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"

export async function POST(req: Request) {
  const session = await resolveSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const myId = session.user.id

  let body: { tradeId?: unknown; stars?: unknown; comment?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { tradeId, stars, comment } = body

  if (typeof tradeId !== "string" || !tradeId) {
    return NextResponse.json({ error: "tradeId is required" }, { status: 400 })
  }
  if (!Number.isInteger(stars) || (stars as number) < 1 || (stars as number) > 5) {
    return NextResponse.json({ error: "stars must be an integer 1–5" }, { status: 400 })
  }
  const starsInt = stars as number
  const commentStr = typeof comment === "string" ? comment.trim() || null : null

  // Load trade — check existence, status, and participation
  const trade = await prisma.tradeRequest.findUnique({
    where: { id: tradeId },
    select: { id: true, status: true, senderId: true, receiverId: true },
  })

  if (!trade) {
    return NextResponse.json({ error: "Trade not found" }, { status: 404 })
  }
  if (trade.status !== "COMPLETED") {
    return NextResponse.json({ error: "Can only rate a completed trade" }, { status: 400 })
  }
  const isParticipant = trade.senderId === myId || trade.receiverId === myId
  if (!isParticipant) {
    return NextResponse.json({ error: "Not a participant in this trade" }, { status: 403 })
  }

  // Derived reviewee — structurally guarantees no self-rating
  const revieweeId = trade.senderId === myId ? trade.receiverId : trade.senderId

  // One rating per (trade, reviewer)
  const existing = await prisma.review.findUnique({
    where: { tradeId_reviewerId: { tradeId, reviewerId: myId } },
  })
  if (existing) {
    return NextResponse.json({ error: "You have already rated this trade" }, { status: 409 })
  }

  // Transactionally: create review + recalculate reviewee's average rating
  const [review] = await prisma.$transaction(async (tx) => {
    const created = await tx.review.create({
      data: {
        tradeId,
        reviewerId: myId,
        revieweeId,
        rating: starsInt,
        comment: commentStr,
      },
    })

    const agg = await tx.review.aggregate({
      where: { revieweeId },
      _avg: { rating: true },
    })

    await tx.user.update({
      where: { id: revieweeId },
      data: { rating: agg._avg.rating ?? 0 },
    })

    return [created]
  })

  // Fire-and-forget notification — do not block the response
  const reviewer = await prisma.user.findUnique({
    where: { id: myId },
    select: { name: true },
  })
  await prisma.notification.create({
    data: {
      userId:  revieweeId,
      actorId: myId,
      type:    "NEW_REVIEW",
      message: `${reviewer?.name ?? "Someone"} left you a ${starsInt}-star review`,
      link:    "/profile",
    },
  })

  return NextResponse.json({ ok: true, reviewId: review.id })
}
