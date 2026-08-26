import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { ok, unauthenticated, notFound, invalid } from "@/lib/v1/envelope"
import { parseJsonBody } from "@/lib/v1/body"
import { enforceRateLimit } from "@/lib/rate-limit-config"
import { blockConsequences } from "@/lib/blocking"

export const dynamic = "force-dynamic"

/**
 * GET  /api/v1/blocks — the caller's blocked-users list (settings screen).
 * POST /api/v1/blocks — block someone.
 *
 * Unblocking is DELETE /api/v1/blocks/[id], where [id] is the BLOCKED USER's
 * id, not the Block row's id. A caller who wants to unblock somebody has their
 * user id in hand — it is what the list above returns and what the profile
 * screen already knows — and making them first look up a join-row id is an
 * extra round trip for nothing.
 *
 * WHAT BLOCKING DOES NOT DO is the interesting part of this endpoint, and the
 * response says so explicitly rather than leaving the user to find out. See the
 * long note above blockConsequences() in @/lib/blocking: an active trade is not
 * cancelled and a Deferred Points Agreement is not voided, because blocking
 * your creditor must not be how you clear a debt.
 */

const bodySchema = z.strictObject({
  userId: z.string().min(1).max(64),
})

export async function GET() {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()

  const rows = await prisma.block.findMany({
    where: { blockerId: session.user.id },
    select: {
      id: true,
      createdAt: true,
      blocked: { select: { id: true, name: true, avatar: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return ok({
    blocks: rows.map((b) => ({
      id: b.id,
      user: b.blocked,
      createdAt: b.createdAt,
    })),
  })
}

export async function POST(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const blockerId = session.user.id

  const limited = enforceRateLimit("block", blockerId)
  if (limited) return limited

  const parsed = await parseJsonBody(req, bodySchema)
  if (!parsed.ok) return parsed.response
  const { userId: blockedId } = parsed.data

  if (blockedId === blockerId) {
    return invalid("You cannot block yourself")
  }

  const target = await prisma.user.findUnique({
    where: { id: blockedId },
    select: { id: true, name: true, avatar: true, deletedAt: true },
  })
  if (!target || target.deletedAt) return notFound("That account no longer exists")

  // What survives the block. Read BEFORE the write so the numbers describe the
  // state the user is being told about, and so a block with obligations in
  // flight cannot report "nothing outstanding" because of a race.
  const consequences = await blockConsequences(blockerId, blockedId)

  // upsert, not create: a double tap is the same block, not an error. The
  // unique index on (blockerId, blockedId) is what makes this idempotent.
  const block = await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId, blockedId } },
    create: { blockerId, blockedId },
    update: {},
    select: { id: true, createdAt: true },
  })

  return ok({
    block: { id: block.id, user: { id: target.id, name: target.name, avatar: target.avatar }, createdAt: block.createdAt },
    effects: {
      // Stated positively so a client can render it as a list of facts rather
      // than reverse-engineering it from what is missing.
      hidden: [
        "You will not see each other's listings",
        "Neither of you can message the other",
        "Neither of you can start a new trade or offer",
        "Your existing conversation is hidden, not deleted",
      ],
      unchanged: consequences,
      // The one sentence that matters if either list above is non-empty.
      note:
        consequences.activeTrades.length || consequences.openContracts.length
          ? "Blocking does not cancel a trade in progress or clear a deferred agreement — those stand. You can still cancel a trade yourself from your trades list."
          : null,
    },
  })
}
