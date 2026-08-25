import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { randomInt } from "crypto"
import { sendSwapConfirmationCode } from "@/lib/mailer"
import { MAX_CODE_ATTEMPTS } from "@/lib/swap-code"

/**
 * A confirmation code, from the CSPRNG.
 *
 * `Math.random()` is a xorshift128+ stream whose state is recoverable from
 * enough observed output — and the two codes for a trade are drawn back to back
 * from ONE stream, so a participant who legitimately receives their own code has
 * partial observation of the sequence that produced their partner's. That is a
 * bad property for the secret whose whole job is to prove two people met.
 * randomInt() draws from the same source as the rest of the auth code.
 */
function randomDigits(n: number): string {
  let code = ""
  for (let i = 0; i < n; i++) code += randomInt(0, 10).toString()
  return code
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: tradeId } = await params
    const myId = session.user.id

    const trade = await prisma.tradeRequest.findUnique({
      where: { id: tradeId },
      include: {
        sender:        { select: { id: true, name: true, email: true } },
        receiver:      { select: { id: true, name: true, email: true } },
        offeredItem:   { select: { title: true } },
        requestedItem: { select: { title: true } },
      },
    })

    if (!trade) return NextResponse.json({ error: "Trade not found" }, { status: 404 })
    if (trade.senderId !== myId && trade.receiverId !== myId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    if (trade.status !== "ACCEPTED" && trade.status !== "CONFIRMING") {
      return NextResponse.json({ error: "Trade is not ready for confirmation" }, { status: 400 })
    }

    const now = new Date()

    // Check if non-expired codes already exist for both participants.
    // If so, return early — idempotent: don't re-generate, don't re-email.
    // Idempotent only while both codes are still live AND still guessable. A
    // pair that has been burned by MAX_CODE_ATTEMPTS must fall through to
    // regeneration below, otherwise a locked-out trade could never be restarted.
    const existing = await prisma.swapConfirmationCode.findMany({
      where: {
        tradeId,
        expiresAt: { gt: now },
        attempts: { lt: MAX_CODE_ATTEMPTS },
      },
    })
    if (existing.length === 2) {
      return NextResponse.json({ started: true, alreadyStarted: true })
    }

    // Generate a 6-digit code for each participant, hash with bcrypt.
    const senderCode   = randomDigits(6)
    const receiverCode = randomDigits(6)
    const expiresAt    = new Date(now.getTime() + 15 * 60 * 1000) // 15 minutes

    const [senderHash, receiverHash] = await Promise.all([
      bcrypt.hash(senderCode,   10),
      bcrypt.hash(receiverCode, 10),
    ])

    // Upsert — if a row for [tradeId, userId] already exists (e.g. expired),
    // overwrite it with a fresh code and reset used=false.
    await prisma.$transaction([
      prisma.swapConfirmationCode.upsert({
        where:  { tradeId_userId: { tradeId, userId: trade.senderId } },
        create: { tradeId, userId: trade.senderId,   codeHash: senderHash,   used: false, attempts: 0, expiresAt },
        update: { codeHash: senderHash,   used: false, attempts: 0, expiresAt },
      }),
      prisma.swapConfirmationCode.upsert({
        where:  { tradeId_userId: { tradeId, userId: trade.receiverId } },
        create: { tradeId, userId: trade.receiverId, codeHash: receiverHash, used: false, attempts: 0, expiresAt },
        update: { codeHash: receiverHash, used: false, attempts: 0, expiresAt },
      }),
      prisma.tradeRequest.update({
        where: { id: tradeId },
        data:  { status: "CONFIRMING" },
      }),
    ])

    // Email each participant their own code.
    // Use allSettled so an SMTP failure doesn't crash the response — codes are
    // already saved in the DB, so the flow can still proceed.
    const emailResults = await Promise.allSettled([
      sendSwapConfirmationCode(
        trade.sender.email,
        trade.sender.name,
        senderCode,
        trade.receiver.name,
        { yours: trade.offeredItem.title, theirs: trade.requestedItem.title },
      ),
      sendSwapConfirmationCode(
        trade.receiver.email,
        trade.receiver.name,
        receiverCode,
        trade.sender.name,
        { yours: trade.requestedItem.title, theirs: trade.offeredItem.title },
      ),
    ])
    for (const r of emailResults) {
      if (r.status === "rejected") console.error("[confirm/start] email error:", r.reason)
    }

    return NextResponse.json({ started: true })
  } catch (err) {
    console.error("[confirm/start]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
