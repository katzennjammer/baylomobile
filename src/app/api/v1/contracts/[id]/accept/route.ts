import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { DPA } from "@/lib/reputation-config"
import { loadStanding } from "@/lib/reputation-gate"
import { sweepLapsedContracts, netValueTo, COMMITTING_STATUSES } from "@/lib/contracts"
import { ok, unauthenticated, notFound, forbidden, conflict, invalid } from "@/lib/v1/envelope"
import { parseJsonBody } from "@/lib/v1/body"
import { V1_CONTRACT_SELECT, V1_CONTRACT_PARTIES_SELECT, v1Contract, type V1ContractRow } from "@/lib/v1/contract"

export const dynamic = "force-dynamic"

/**
 * POST /api/v1/contracts/[id]/accept — the creditor consents. Rule 3.
 *
 * Only the creditor. Only from PENDING_ACCEPT. Until this runs the trade cannot
 * settle at all — the settlement transaction refuses to complete a trade that
 * still carries a PENDING_ACCEPT contract — so "the trade does not finalize
 * until the creditor explicitly accepts" is enforced by the settlement path
 * refusing, not by this endpoint being polite.
 *
 * EVERY DEBTOR-SIDE GATE IS RE-CHECKED HERE. The proposal may have been made
 * days ago, and in between the debtor may have taken on another contract or
 * defaulted on an existing one. Checking only at propose time would make the
 * gates a snapshot of a moment the creditor never saw.
 */

const bodySchema = z.strictObject({
  /**
   * The amount the creditor believes they are agreeing to, echoed back from the
   * preview. Optional, but a client that sends it gets protected from accepting
   * a contract that changed under it.
   */
  confirmAmountLeaves: z.number().int().min(1).max(1_000_000).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const viewerId = session.user.id
  const { id } = await params

  const parsed = await parseJsonBody(req, bodySchema)
  if (!parsed.ok) return parsed.response

  await sweepLapsedContracts(prisma, { contractId: id })

  const contract = await prisma.deferredContract.findUnique({
    where: { id },
    select: {
      ...V1_CONTRACT_SELECT,
      trade: {
        select: {
          id: true, status: true, senderId: true, receiverId: true, offeredLeaves: true,
          offeredItem: { select: { id: true, valueLeaves: true } },
          requestedItem: { select: { id: true, valueLeaves: true } },
        },
      },
    },
  })
  if (!contract) return notFound("Contract not found")
  // The debtor gets a 404 too. They know the contract exists — they proposed it
  // — but "not yours to accept" is not a distinction worth a separate code, and
  // a debtor accepting their own promise is the one thing this endpoint exists
  // to make impossible.
  if (contract.creditorId !== viewerId) return notFound("Contract not found")

  if (contract.status !== "PENDING_ACCEPT") {
    return conflict(`This agreement is already ${contract.status}`, { status: contract.status })
  }
  if (
    parsed.data.confirmAmountLeaves !== undefined &&
    parsed.data.confirmAmountLeaves !== contract.amountLeaves
  ) {
    return conflict(
      `This agreement is for ${contract.amountLeaves} Leaves, not ${parsed.data.confirmAmountLeaves}. Re-read the preview before accepting.`,
      { amountLeaves: contract.amountLeaves },
    )
  }

  const trade = contract.trade
  if (trade.status !== "ACCEPTED" && trade.status !== "CONFIRMING") {
    return invalid(
      `The underlying trade is ${trade.status} and can no longer carry a deferred agreement.`,
    )
  }

  // ── Re-check the debtor, as of now ──
  const debtor = await loadStanding(contract.debtorId)

  if (debtor.completedTrades < DPA.minCompletedTradesToOwe) {
    return forbidden(
      `${debtor.completedTrades} completed trades — a debtor needs ${DPA.minCompletedTradesToOwe}.`,
      { rule: "DPA_MIN_COMPLETED_TRADES", completedTrades: debtor.completedTrades },
    )
  }
  if (!debtor.limits.mayProposeDpa) {
    return forbidden(`The debtor is now a ${debtor.tier} and can no longer hold an agreement.`, {
      rule: "TIER_MAY_NOT_PROPOSE",
      tier: debtor.tier,
    })
  }

  // Other open contracts, this one excluded — it is PENDING_ACCEPT and so is
  // counted in openContracts/committedDebt by loadStanding().
  const otherOpen = await prisma.deferredContract.count({
    where: {
      debtorId: contract.debtorId,
      status: { in: [...COMMITTING_STATUSES] },
      id: { not: contract.id },
    },
  })
  if (otherOpen >= DPA.maxConcurrentAsDebtor) {
    return conflict(
      "The debtor has taken on another deferred agreement since proposing this one.",
      { rule: "DPA_ONE_AT_A_TIME", openContracts: otherOpen },
    )
  }

  const ceiling = debtor.limits.maxOutstandingDebtLeaves
  const otherCommitted = Math.max(0, debtor.committedDebt - contract.amountLeaves)
  if (otherCommitted + contract.amountLeaves > ceiling) {
    return forbidden(
      `Accepting would put the debtor at ${otherCommitted + contract.amountLeaves} Leaves owed, over the ${ceiling} their tier allows.`,
      { rule: "TIER_DEBT_CEILING", tier: debtor.tier, ceiling },
    )
  }

  // The value difference is re-derived too: an item's valueLeaves may have been
  // edited between proposal and acceptance.
  const net = netValueTo(trade, contract.debtorId)
  if (net === null || contract.amountLeaves > net) {
    return invalid(
      `The value difference is now ${net ?? "undefined"} Leaves, which no longer covers the ${contract.amountLeaves} deferred. Ask for a new proposal.`,
    )
  }

  const acceptedAt = new Date()
  // Conditional on PENDING_ACCEPT, so two taps on Accept produce one ACTIVE
  // contract and one 409 rather than two acceptances.
  const moved = await prisma.deferredContract.updateMany({
    where: { id: contract.id, status: "PENDING_ACCEPT" },
    data: { status: "ACTIVE", acceptedAt },
  })
  if (moved.count !== 1) {
    return conflict("This agreement was just resolved by another request")
  }

  const fresh = await prisma.deferredContract.findUnique({
    where: { id: contract.id },
    select: { ...V1_CONTRACT_SELECT, ...V1_CONTRACT_PARTIES_SELECT },
  })

  return ok(
    { contract: v1Contract(fresh as V1ContractRow, viewerId) },
    {
      // Said plainly in the response, not only in the preview: the creditor has
      // just given up the ability to get the item back, and there was never a
      // mechanism to give it back in the first place.
      noItemReturn: true,
      tradeMayNowComplete: true,
    },
  )
}
