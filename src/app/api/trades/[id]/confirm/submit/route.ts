import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import bcrypt from "bcryptjs"
import pusher from "@/lib/pusher"
import { awardTask } from "@/lib/tasks"
import { MAX_CODE_ATTEMPTS } from "@/lib/swap-code"
import { confirmSubmitSchema, parseBody } from "@/lib/validation"
import { enforceRateLimit } from "@/lib/rate-limit-config"
import { applyEarningsToContracts } from "@/lib/contracts"
import { resolveMeetupHub } from "@/lib/safe-zones"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: tradeId } = await params
    const myId = session.user.id

    // A second, coarser brake on top of the per-code counter below: the counter
    // burns one code, this bounds how fast a caller can burn codes at all.
    const limited = enforceRateLimit("confirmSubmit", myId)
    if (limited) return limited

    const parsed = await parseBody(req, confirmSubmitSchema)
    if (!parsed.ok) return parsed.response
    const body = parsed.data
    const submitted = body.code

    const trade = await prisma.tradeRequest.findUnique({
      where: { id: tradeId },
      include: {
        sender:        { select: { id: true, name: true, email: true } },
        receiver:      { select: { id: true, name: true, email: true } },
        offeredItem:   { select: { id: true, title: true, status: true } },
        requestedItem: { select: { id: true, title: true, status: true } },
      },
    })

    if (!trade) return NextResponse.json({ error: "Trade not found" }, { status: 404 })
    if (trade.senderId !== myId && trade.receiverId !== myId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    if (trade.status !== "CONFIRMING" && trade.status !== "COMPLETED") {
      return NextResponse.json({ error: "Trade is not in confirmation phase" }, { status: 400 })
    }
    if (trade.status === "COMPLETED") {
      return NextResponse.json({ correct: true, completed: true })
    }

    // ── The Safe-Zone meetup claim: VALIDATED HERE, WRITTEN LATER ────────────
    //
    // Both checks run BEFORE anything in this request mutates state -- before
    // the bcrypt compare that can burn one of the partner's guesses, and before
    // the code is marked used. That ordering is the whole point of doing it up
    // here rather than beside the write:
    //
    //   A malformed claim is a bad REQUEST, and a bad request must cost the
    //   caller nothing. Validated next to the write, a correct code paired with
    //   a bad hub id returned 400 *after* the code had already been consumed --
    //   the caller saw an error for an action that had partly happened, which
    //   is the shape that turns one confusing 400 into a support ticket.
    //
    // The claim is a FOREIGN KEY, not a boolean, and it is only accepted if
    // BOTH traded listings were already publicly offered at that hub.
    //
    // TO BE PLAIN ABOUT WHAT THIS IS: pre-committed self-attestation, NOT
    // verification. Nothing here observes the world -- somebody who wants the
    // Leaves without making the trip sends the same request as somebody who
    // made it. What the check buys is that the claim was pre-committed and
    // mutual: both owners named this hub on their listings, independently,
    // before this trade existed, and the counterparty could see it at offer
    // time. The lie has to be set up in advance, by two people, in public. See
    // resolveMeetupHub() for why GPS was considered and rejected.
    //
    // The deprecated boolean is REFUSED rather than ignored. A shipped client
    // still sending `safeZone: true` would otherwise get a 200 and no award,
    // which is the silent-wrong-answer failure this codebase rejects
    // everywhere else.
    if (body.safeZone === true && !body.safeZoneHubId) {
      return NextResponse.json(
        {
          error:
            "A Safe-Zone meetup now has to name which hub you met at. Send safeZoneHubId instead of safeZone.",
          code: "SAFEZONE_HUB_REQUIRED",
        },
        { status: 400 },
      )
    }

    if (body.safeZoneHubId) {
      const claim = await resolveMeetupHub(
        prisma,
        body.safeZoneHubId,
        trade.offeredItemId,
        trade.requestedItemId,
      )
      if (!claim.ok) {
        return NextResponse.json({ error: claim.message, code: "SAFEZONE_HUB_INVALID" }, { status: 400 })
      }
    }

    const isSender  = trade.senderId === myId
    const partnerId = isSender ? trade.receiverId : trade.senderId

    // The user enters their PARTNER's code (cross-exchange proves in-person meeting).
    // So we verify the submitted code against the PARTNER's stored hash.
    const partnerCode = await prisma.swapConfirmationCode.findUnique({
      where: { tradeId_userId: { tradeId, userId: partnerId } },
    })

    if (!partnerCode) {
      return NextResponse.json({ error: "Codes have not been generated yet — open the modal again" }, { status: 400 })
    }

    const now = new Date()
    if (partnerCode.expiresAt < now) {
      return NextResponse.json({ error: "Code has expired — click the button again to get new codes" }, { status: 400 })
    }

    // Guess budget, checked BEFORE the compare so a burned code cannot be
    // tested even once more.
    if (partnerCode.attempts >= MAX_CODE_ATTEMPTS) {
      return NextResponse.json(
        { error: "Too many incorrect attempts — start the confirmation again to get new codes", locked: true },
        { status: 429 },
      )
    }

    const match = await bcrypt.compare(submitted, partnerCode.codeHash)
    if (!match) {
      // The increment is conditional on the value we just read, so two requests
      // racing the same code cannot both spend the same attempt slot.
      const spent = await prisma.swapConfirmationCode.updateMany({
        where: { tradeId, userId: partnerId, attempts: partnerCode.attempts },
        data: { attempts: partnerCode.attempts + 1 },
      })
      if (spent.count !== 1) {
        return NextResponse.json({ error: "Please try again" }, { status: 409 })
      }

      const remaining = MAX_CODE_ATTEMPTS - (partnerCode.attempts + 1)
      if (remaining <= 0) {
        return NextResponse.json(
          { error: "Too many incorrect attempts — start the confirmation again to get new codes", locked: true },
          { status: 429 },
        )
      }
      return NextResponse.json(
        { error: "Incorrect code — check the code in your partner's email", remaining },
        { status: 400 },
      )
    }

    // Mark the partner's code as used (= "I submitted my partner's code correctly")
    await prisma.swapConfirmationCode.update({
      where: { tradeId_userId: { tradeId, userId: partnerId } },
      data:  { used: true },
    })

    // The claim was validated before any mutation happened (see above); this is
    // only the write, and it runs after the code has been verified so that a
    // failed confirmation cannot record a meetup that was never confirmed.
    if (body.safeZoneHubId) {
      await prisma.tradeRequest.update({
        where: { id: tradeId },
        data:  { safeZoneHubId: body.safeZoneHubId },
      })
    }

    // Check if the other participant has already verified
    const myCode = await prisma.swapConfirmationCode.findUnique({
      where: { tradeId_userId: { tradeId, userId: myId } },
    })
    const bothVerified = partnerCode !== null && (myCode?.used ?? false)
    // After marking partner's code used, re-check:
    const updatedCodes = await prisma.swapConfirmationCode.findMany({
      where:  { tradeId },
      select: { used: true },
    })
    const allUsed = updatedCodes.length === 2 && updatedCodes.every((c) => c.used)

    if (!allUsed) {
      return NextResponse.json({ correct: true, completed: false })
    }

    // Both verified — run the atomic completion transaction
    const itemIds = [trade.offeredItemId, trade.requestedItemId]

    try {
      await prisma.$transaction(async (tx) => {
        const freshTrade = await tx.tradeRequest.findUnique({
          where:  { id: tradeId },
          select: { status: true, offeredLeaves: true },
        })
        if (freshTrade?.status === "COMPLETED") throw new Error("already_completed")

        // RULE 3 -- CREDITOR CONSENT. A trade carrying a deferred agreement
        // that the creditor has not accepted does not finalize. This check,
        // not the accept endpoint, is what makes that true: the accept
        // endpoint only flips a status, whereas this is the statement that
        // refuses to hand the items over while consent is outstanding.
        //
        // Only PENDING_ACCEPT blocks. An ACTIVE contract is exactly the case
        // the feature exists for -- the item changes hands now, the Leaves are
        // owed later -- and DECLINED means the parties settled it some other
        // way.
        const pendingContract = await tx.deferredContract.findFirst({
          where:  { tradeId, status: "PENDING_ACCEPT" },
          select: { id: true },
        })
        if (pendingContract) throw new Error("contract_pending")

        const freshItems = await tx.item.findMany({
          where:  { id: { in: itemIds } },
          select: { id: true, status: true },
        })
        if (freshItems.some((i) => ["TRADED", "OWNED", "REMOVED"].includes(i.status))) {
          throw new Error("item_traded")
        }

        // THE AMOUNT COMES FROM THE TRADE. It is read inside this transaction,
        // from the row being settled, and is never re-derived from Offer.
        //
        // This used to be offer.findFirst() on (senderId, postId, ACCEPTED)
        // with no orderBy. That correlation is not unique — five trades match
        // more than one accepted offer, one matches eight, and one sender/post
        // pair holds two accepted offers for DIFFERENT amounts (100 and 200
        // Leaves). So the quantity of currency moved was whichever row the
        // optimiser happened to return first. It was safe only by accident.
        // See the regression test in scripts/verify-settlement-offeredleaves.ts.
        const leaves = freshTrade?.offeredLeaves ?? 0

        // Provenance only — which offer this settlement came from, for the
        // ledger's optional offerId. Ordered so it is at least deterministic;
        // nothing about the amount depends on it, and a miss is not an error.
        const offer = leaves > 0
          ? await tx.offer.findFirst({
              where:   { senderId: trade.senderId, postId: trade.requestedItemId, status: "ACCEPTED" },
              select:  { id: true },
              orderBy: { updatedAt: "desc" },
            })
          : null

        if (leaves > 0) {
          const freshSender = await tx.user.findUnique({
            where:  { id: trade.senderId },
            select: { leaves: true },
          })
          if (!freshSender || freshSender.leaves < leaves) throw new Error("insufficient_leaves")
        }

        await tx.tradeRequest.update({ where: { id: tradeId }, data: { status: "COMPLETED" } })
        await tx.item.update({ where: { id: trade.offeredItemId },   data: { userId: trade.receiverId, status: "OWNED" } })
        await tx.item.update({ where: { id: trade.requestedItemId }, data: { userId: trade.senderId,   status: "OWNED" } })
        await tx.user.updateMany({
          where: { id: { in: [trade.senderId, trade.receiverId] } },
          data:  { totalTrades: { increment: 1 } },
        })

        // The only legitimate movement of Leaves between users: a settled trade.
        // Debit and credit are written in the same transaction so the ledger
        // always balances to zero across all users.
        if (leaves > 0) {
          await tx.user.update({ where: { id: trade.senderId },   data: { leaves: { decrement: leaves } } })
          await tx.user.update({ where: { id: trade.receiverId }, data: { leaves: { increment: leaves } } })
          // eventAt is the settlement itself, which is happening right now, so
          // it coincides with createdAt here. It is still written explicitly:
          // a trade settled by a backfill or repair job would need the real
          // settlement time, and the column must never be guessed at read time.
          const settledAt = new Date()
          await tx.leafTransaction.create({
            data: {
              userId: trade.senderId, type: "TRADE_SPEND", amount: -leaves,
              description: `Leaves given to ${trade.receiver.name} for trade`,
              offerId: offer?.id, tradeId, eventAt: settledAt,
            },
          })
          await tx.leafTransaction.create({
            data: {
              userId: trade.receiverId, type: "TRADE_RECEIVE", amount: leaves,
              description: `Leaves received from ${trade.sender.name} for trade`,
              offerId: offer?.id, tradeId, eventAt: settledAt,
            },
          })
        }

        // Task rewards are awarded here, at the moment settlement completes —
        // not on a dashboard load, which the mobile client will never do.
        // awardTask never throws, so a capped or duplicate award can never roll
        // back the trade itself. VERIFIED_SWAP additionally pays only when the
        // counterparty is new to the user inside NEW_PARTNER_WINDOW_DAYS.
        // safeZoneHubId is re-read here: the second submitter may have set it
        // in this very request, after `trade` was loaded.
        const settled = await tx.tradeRequest.findUnique({
          where:  { id: tradeId },
          select: { safeZoneHubId: true },
        })

        for (const [uid, partnerId] of [
          [trade.senderId,   trade.receiverId],
          [trade.receiverId, trade.senderId],
        ] as const) {
          await awardTask(tx, uid, "VERIFIED_SWAP", tradeId, {
            partnerId, tradeId, description: "Task reward: completed a verified swap",
          })
          // NULL hub means no claim. The award condition is the foreign key
          // itself -- there is no separate flag that could disagree with it.
          if (settled?.safeZoneHubId) {
            // partnerId is REQUIRED here, not decorative. SAFEZONE_MEETUP is a
            // repeatable task and is now partner-gated exactly as VERIFIED_SWAP
            // is; awardTask() fails closed without it. Omitting it was half of
            // the faucet gap closed on 28 Aug 2026 -- a colluding pair could
            // bounce two items back and forth and collect 10 Leaves each per
            // trade, bounded only by the weekly cap, while VERIFIED_SWAP
            // correctly paid them once a month.
            await awardTask(tx, uid, "SAFEZONE_MEETUP", tradeId, {
              partnerId, tradeId, description: "Task reward: confirmed a Safe-Zone meetup",
            })
          }
        }

        // RULE 4 -- FULFILMENT. Leaves that just landed in a debtor's balance
        // go to their oldest open deferred agreement before they go anywhere
        // else. Both parties are swept: the receiver was credited above, and
        // BOTH may have collected task rewards.
        //
        // Inside the settlement transaction on purpose. Every payment writes a
        // CONTRACT_PAY/CONTRACT_COLLECT ledger pair and moves both balances in
        // the same commit as the credit that funded it, so
        // SUM(User.leaves) == SUM(LeafTransaction.amount) is never observably
        // broken -- not even for the instant between earning and paying.
        //
        // Runs AFTER awardTask so the sweep sees the task Leaves too; awardTask
        // deliberately does not sweep on its own here, which would have swept
        // twice for no benefit.
        for (const uid of [trade.senderId, trade.receiverId]) {
          await applyEarningsToContracts(tx, uid)
        }
      })
    } catch (txErr) {
      if (txErr instanceof Error && txErr.message === "already_completed") {
        return NextResponse.json({ correct: true, completed: true })
      }
      if (txErr instanceof Error && txErr.message === "contract_pending") {
        return NextResponse.json(
          { error: "This trade has a deferred points agreement your partner has not accepted yet. It cannot be completed until they accept or decline it." },
          { status: 409 },
        )
      }
      if (txErr instanceof Error && txErr.message === "item_traded") {
        return NextResponse.json({ error: "An item in this trade is no longer available" }, { status: 409 })
      }
      if (txErr instanceof Error && txErr.message === "insufficient_leaves") {
        return NextResponse.json({ error: "Sender no longer has enough Leaves for this trade" }, { status: 400 })
      }
      throw txErr
    }

    void Promise.allSettled([
      prisma.notification.create({
        data: {
          userId: trade.senderId, type: "TRADE_COMPLETED",
          message: `Swap with ${trade.receiver.name} completed! ${trade.offeredItem.title} ↔ ${trade.requestedItem.title}`,
          link: "/dashboard/trades", actorId: trade.receiverId,
        },
      }),
      prisma.notification.create({
        data: {
          userId: trade.receiverId, type: "TRADE_COMPLETED",
          message: `Swap with ${trade.sender.name} completed! ${trade.offeredItem.title} ↔ ${trade.requestedItem.title}`,
          link: "/dashboard/trades", actorId: trade.senderId,
        },
      }),
      pusher.trigger(`private-user-${trade.senderId}`, "trade-status-changed", {
        tradeId, newStatus: "COMPLETED", itemIds,
      }),
      pusher.trigger(`private-user-${trade.receiverId}`, "trade-status-changed", {
        tradeId, newStatus: "COMPLETED", itemIds,
      }),
    ])

    return NextResponse.json({ correct: true, completed: true })
  } catch (err) {
    console.error("[confirm/submit]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
