import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { DPA } from "@/lib/reputation-config"
import { loadStanding } from "@/lib/reputation-gate"
import {
  sweepLapsedContracts,
  netValueTo,
  termBounds,
  COMMITTING_STATUSES,
} from "@/lib/contracts"
import { ok, unauthenticated, invalid, notFound, forbidden, conflict } from "@/lib/v1/envelope"
import { parseQuery, paginationShape } from "@/lib/v1/query"
import { parseJsonBody, futureInstant } from "@/lib/v1/body"
import { decodeCursor, encodeCursor, olderThan, paginate } from "@/lib/v1/cursor"
import {
  V1_CONTRACT_SELECT,
  V1_CONTRACT_PARTIES_SELECT,
  v1Contract,
  type V1ContractRow,
} from "@/lib/v1/contract"

export const dynamic = "force-dynamic"

/**
 * /api/v1/contracts — propose a Deferred Points Agreement, and list your own.
 *
 * A DPA is a promise to pay a value difference in Leaves by a deadline. The
 * system cannot repossess the item if the promise is broken, so every guard
 * that matters runs BEFORE the promise is made: here, and in the creditor's
 * preview at /api/v1/contracts/[id]/preview.
 */

// ── GET: my contracts ────────────────────────────────────────────────────────

const listSchema = z.strictObject({
  ...paginationShape,
  /** Which side of the relationship to list. Both by default. */
  role: z.enum(["debtor", "creditor", "any"]).optional().default("any"),
  status: z
    .enum(["PENDING_ACCEPT", "ACTIVE", "FULFILLED", "DEFAULTED", "DECLINED"])
    .optional(),
})

export async function GET(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const viewerId = session.user.id

  const parsed = parseQuery(req, listSchema)
  if (!parsed.ok) return parsed.response
  const { limit, role, status } = parsed.data
  const cursor = decodeCursor(parsed.data.cursor)
  if (parsed.data.cursor && !cursor) return invalid("Malformed cursor")

  // The lazy sweep, on the read that is most likely to happen. Runs for the
  // viewer as debtor only: a creditor reading their list must also see a lapsed
  // contract as DEFAULTED, so it runs unscoped-by-debtor for them too, below.
  await sweepLapsedContracts(prisma, { debtorId: viewerId })
  if (role !== "debtor") {
    const lapsedForCreditor = await prisma.deferredContract.findMany({
      where: { creditorId: viewerId, status: "ACTIVE", deadline: { lt: new Date() } },
      select: { id: true },
    })
    for (const c of lapsedForCreditor) {
      await sweepLapsedContracts(prisma, { contractId: c.id })
    }
  }

  const side =
    role === "debtor"
      ? { debtorId: viewerId }
      : role === "creditor"
        ? { creditorId: viewerId }
        : { OR: [{ debtorId: viewerId }, { creditorId: viewerId }] }

  const rows = await prisma.deferredContract.findMany({
    where: { ...side, ...(status ? { status } : {}), ...(olderThan(cursor) ?? {}) },
    select: { ...V1_CONTRACT_SELECT, ...V1_CONTRACT_PARTIES_SELECT },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  })
  const { page, nextCursor } = paginate(rows, limit, (r) => encodeCursor(r.createdAt, r.id))

  const standing = await loadStanding(viewerId)

  return ok(
    {
      contracts: page.map((r) => v1Contract(r as V1ContractRow, viewerId)),
      asDebtor: {
        outstandingDebt: standing.outstandingDebt,
        committedDebt: standing.committedDebt,
        maxOutstandingDebtLeaves: standing.limits.maxOutstandingDebtLeaves,
        openContracts: standing.openContracts,
        hasUnsettledDefault: standing.hasUnsettledDefault,
        canInitiateTrades: !standing.hasUnsettledDefault,
      },
    },
    { nextCursor, role, status: status ?? null },
  )
}

// ── POST: propose ────────────────────────────────────────────────────────────

const proposeSchema = z.strictObject({
  tradeId: z.string().min(1).max(64),
  amountLeaves: z.number().int().min(1, "A deferred amount must be at least 1 Leaf").max(1_000_000),
  deadline: futureInstant,
})

/**
 * POST /api/v1/contracts — the debtor proposes.
 *
 * ONLY THE DEBTOR MAY PROPOSE. A contract is a promise to pay and the only
 * person who can make one is the person who will owe it; the creditor's half of
 * the bargain is consent, which is what PENDING_ACCEPT exists for. Letting a
 * creditor propose would let one party manufacture the other's debt and leave
 * "accept" as the debtor's only defence — the reverse of the intended shape.
 *
 * Six refusals, in the order a proposal is most likely to be wrong:
 *
 *   404  no such trade, or the caller is not in it
 *   400  the trade is not in a state that can carry a contract
 *   403  fewer than DPA.minCompletedTradesToOwe completed trades  (rule 1)
 *   403  the caller's tier may not propose at all                 (rule 2)
 *   409  the caller already has an open contract                  (rule 2)
 *   403  the amount would exceed the tier's debt ceiling          (rule 2)
 *   400  the amount exceeds the actual value difference
 */
export async function POST(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const debtorId = session.user.id

  const parsed = await parseJsonBody(req, proposeSchema)
  if (!parsed.ok) return parsed.response
  const { tradeId, amountLeaves, deadline } = parsed.data

  const trade = await prisma.tradeRequest.findUnique({
    where: { id: tradeId },
    select: {
      id: true,
      status: true,
      senderId: true,
      receiverId: true,
      offeredLeaves: true,
      offeredItem: { select: { id: true, title: true, valueLeaves: true } },
      requestedItem: { select: { id: true, title: true, valueLeaves: true } },
    },
  })
  // 404 rather than 403 for a trade the caller is not in — the same disclosure
  // rule the rest of v1 follows.
  if (!trade) return notFound("Trade not found")
  if (trade.senderId !== debtorId && trade.receiverId !== debtorId) {
    return notFound("Trade not found")
  }

  // The contract must be agreed BEFORE the swap settles. After COMPLETED the
  // items have changed hands and a "promise" to pay the difference is just an
  // unsecured request; before ACCEPTED there is no agreed trade to attach to.
  if (trade.status !== "ACCEPTED" && trade.status !== "CONFIRMING") {
    return invalid(
      `A deferred agreement can only be attached to an accepted trade that has not yet completed (this one is ${trade.status})`,
    )
  }

  const creditorId = trade.senderId === debtorId ? trade.receiverId : trade.senderId

  // One live contract per trade. A DECLINED or FULFILLED one does not block a
  // fresh proposal — a creditor who said no to 300 Leaves may well say yes to
  // 150 — which is why this filters on status rather than on the trade alone.
  const existing = await prisma.deferredContract.findFirst({
    where: { tradeId, status: { in: [...COMMITTING_STATUSES] } },
    select: { id: true, status: true },
  })
  if (existing) {
    return conflict("This trade already has a deferred agreement", {
      contractId: existing.id,
      status: existing.status,
    })
  }

  // loadStanding() runs the lazy deadline sweep first, so a debtor whose
  // previous contract lapsed an hour ago is already in default here.
  const standing = await loadStanding(debtorId)

  // ── Rule 1: eligibility ──
  if (standing.completedTrades < DPA.minCompletedTradesToOwe) {
    return forbidden(
      `You need at least ${DPA.minCompletedTradesToOwe} completed trades to defer payment. You have ${standing.completedTrades}.`,
      {
        rule: "DPA_MIN_COMPLETED_TRADES",
        required: DPA.minCompletedTradesToOwe,
        completedTrades: standing.completedTrades,
      },
    )
  }

  // ── Rule 2: exposure cap ──
  if (!standing.limits.mayProposeDpa) {
    return forbidden(`${standing.tier}s cannot propose a deferred agreement.`, {
      rule: "TIER_MAY_NOT_PROPOSE",
      tier: standing.tier,
    })
  }
  if (standing.openContracts >= DPA.maxConcurrentAsDebtor) {
    return conflict(
      `You already have ${standing.openContracts} open deferred agreement. Settle it before proposing another.`,
      { rule: "DPA_ONE_AT_A_TIME", openContracts: standing.openContracts },
    )
  }
  const ceiling = standing.limits.maxOutstandingDebtLeaves
  if (standing.committedDebt + amountLeaves > ceiling) {
    return forbidden(
      `As a ${standing.tier} you may owe at most ${ceiling} Leaves. You already have ${standing.committedDebt} committed, so ${amountLeaves} would take you to ${standing.committedDebt + amountLeaves}.`,
      {
        rule: "TIER_DEBT_CEILING",
        tier: standing.tier,
        ceiling,
        committedDebt: standing.committedDebt,
        requested: amountLeaves,
        headroom: Math.max(0, ceiling - standing.committedDebt),
      },
    )
  }

  // ── The amount must be a real difference ──
  //
  // A DPA covers the gap between two unequal items. Deferring more than the gap
  // is not deferring a difference, it is borrowing, and this feature is not a
  // loan facility.
  const net = netValueTo(trade, debtorId)
  if (net === null) {
    return invalid(
      "Both items need a Leaf value before their difference can be deferred (a Leaves-for-item trade has no item difference to defer).",
    )
  }
  if (net <= 0) {
    return invalid(
      "You are not the party receiving the higher-value item, so there is no difference for you to owe.",
    )
  }
  if (amountLeaves > net) {
    return invalid(
      `The value difference in your favour is ${net} Leaves; you cannot defer more than that.`,
    )
  }

  // ── Term bounds ──
  const { earliest, latest } = termBounds()
  if (deadline < earliest || deadline > latest) {
    return invalid(
      `The deadline must be between ${DPA.minTermDays} and ${DPA.maxTermDays} days from now.`,
    )
  }

  const contract = await prisma.deferredContract.create({
    data: {
      tradeId,
      debtorId,
      creditorId,
      amountLeaves,
      deadline,
      // Explicit rather than left to the column default. This status is a rule
      // ("the trade does not finalize until the creditor accepts"), not a
      // convenience, and it should be legible at the point it is decided.
      status: "PENDING_ACCEPT",
    },
    select: { ...V1_CONTRACT_SELECT, ...V1_CONTRACT_PARTIES_SELECT },
  })

  return ok(
    { contract: v1Contract(contract as V1ContractRow, debtorId) },
    {
      // Where the creditor must go before they can accept. Named in the
      // response so a client cannot plausibly build an accept button without
      // having seen the endpoint that justifies it.
      creditorPreviewPath: `/api/v1/contracts/${contract.id}/preview`,
      valueDifferenceLeaves: net,
    },
  )
}
