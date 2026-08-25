import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { loadStanding } from "@/lib/reputation-gate"
import { sweepLapsedContracts, netValueTo } from "@/lib/contracts"
import { ok, unauthenticated, notFound } from "@/lib/v1/envelope"
import { parseQuery } from "@/lib/v1/query"
import { V1_CONTRACT_SELECT, V1_CONTRACT_PARTIES_SELECT, v1Contract, type V1ContractRow } from "@/lib/v1/contract"

export const dynamic = "force-dynamic"

/**
 * GET /api/v1/contracts/[id]/preview — what the creditor sees before accepting.
 *
 * THIS ENDPOINT IS THE FEATURE'S ONLY REAL DEFENCE, and it is worth being blunt
 * about why. Nothing downstream of acceptance can compel payment: there is no
 * repossession, no reversal, no way to take the item back. Once the creditor
 * says yes, the debtor's incentive to pay is reputational, and reputation only
 * works on someone who intends to keep trading. Against a debtor who does not,
 * the platform has nothing.
 *
 * So the moment of protection is BEFORE the yes, and it consists entirely of
 * showing the creditor what they are actually agreeing to. That is what turns
 * an unenforceable promise into an informed decision — not a promise that is
 * any more enforceable, but a decision the creditor made with the debtor's
 * record in front of them. The four statistics below are the record:
 *
 *   completedTrades  — has this person finished anything at all?
 *   outstandingDebt  — how much are they already promising other people?
 *   onTimeRate       — when they have promised before, did they deliver?
 *   pastDefaults     — how many times has someone in your position lost?
 *
 * A creditor who accepts after reading this has made a bet they can see. A
 * creditor who was never shown it was simply exposed. That is the entire
 * difference the endpoint makes, and it is why the accept endpoint should never
 * have shipped without it.
 *
 * Both parties may read it. The debtor seeing their own record exactly as the
 * creditor will is good faith, not a leak — every figure here is derived from
 * the debtor's own contracts and trades.
 */

const querySchema = z.strictObject({})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const viewerId = session.user.id
  const { id } = await params

  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response

  // Sweep this contract first, so a preview never shows ACTIVE for something
  // whose deadline passed while nobody was looking.
  await sweepLapsedContracts(prisma, { contractId: id })

  const contract = await prisma.deferredContract.findUnique({
    where: { id },
    select: {
      ...V1_CONTRACT_SELECT,
      ...V1_CONTRACT_PARTIES_SELECT,
      trade: {
        select: {
          id: true,
          status: true,
          senderId: true,
          receiverId: true,
          offeredLeaves: true,
          offeredItem: { select: { id: true, title: true, valueLeaves: true } },
          requestedItem: { select: { id: true, title: true, valueLeaves: true } },
        },
      },
    },
  })
  if (!contract) return notFound("Contract not found")
  if (contract.debtorId !== viewerId && contract.creditorId !== viewerId) {
    return notFound("Contract not found")
  }

  // The debtor's standing, swept and derived fresh. loadStanding() re-runs the
  // sweep scoped to the debtor, which also catches their OTHER lapsed contracts
  // — a creditor deciding on this proposal needs those counted as defaults.
  const debtor = await loadStanding(contract.debtorId)

  const trade = contract.trade
  const net = netValueTo(trade, contract.debtorId)

  // Which item each party actually walks away with, so the creditor can see the
  // trade they are being asked to underwrite rather than two ids.
  const debtorIsSender = trade.senderId === contract.debtorId
  const debtorReceives = debtorIsSender ? trade.requestedItem : trade.offeredItem
  const debtorGives = debtorIsSender ? trade.offeredItem : trade.requestedItem

  return ok({
    contract: v1Contract(contract as V1ContractRow, viewerId),

    /** The four statistics the decision rests on. */
    debtorStats: {
      completedTrades: debtor.completedTrades,
      outstandingDebt: debtor.outstandingDebt,
      // Null when this debtor has never finished a contract. A client MUST
      // render that as "no history" and not as 0% — a first-time debtor is
      // unproven, not proven bad, and the two deserve different answers.
      onTimeFulfillmentRate: debtor.onTimeRate,
      pastDefaults: debtor.lifetimeDefaults,
    },

    /** Context for reading those four numbers. */
    debtor: {
      id: debtor.userId,
      name: contract.debtor?.name ?? null,
      avatar: contract.debtor?.avatar ?? null,
      tier: debtor.tier,
      baseTier: debtor.baseTier,
      rating: debtor.rating,
      finishedContracts: debtor.finishedContracts,
      hasUnsettledDefault: debtor.hasUnsettledDefault,
      debtCeiling: debtor.limits.maxOutstandingDebtLeaves,
    },

    trade: {
      id: trade.id,
      status: trade.status,
      offeredLeaves: trade.offeredLeaves,
      debtorReceives,
      debtorGives,
      valueDifferenceLeaves: net,
    },

    /**
     * What the creditor is actually agreeing to, spelled out rather than left
     * to be inferred from the fields above. `noItemReturn` is not a disclaimer
     * bolted on — it is the true statement of what the platform will do if this
     * goes wrong, and a creditor who has not been told it has not been informed.
     */
    terms: {
      youReceiveNow: debtorGives,
      youGiveNow: debtorReceives,
      theyOweYou: contract.amountLeaves,
      byDeadline: contract.deadline,
      extensionsPossible: contract.extensionUsed ? 0 : 1,
      onDefault: [
        "The debt remains owed in full and keeps collecting from their earnings.",
        "They are blocked from starting new trades until it is settled.",
        "Their trust tier drops and the default is shown on their profile permanently.",
      ],
      noItemReturn:
        "The item does not come back. This platform cannot repossess or reverse a swap — " +
        "if they never pay, you keep the reputational record and nothing else.",
    },
  })
}
