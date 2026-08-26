import { NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { ok } from "@/lib/v1/envelope"
import { parseQuery } from "@/lib/v1/query"
import { NEW_PARTNER_WINDOW_DAYS } from "@/lib/task-constants"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/anomalies — the two signals this system already produces and
 * has never shown anyone.
 *
 * Both of these have been getting written to the database for weeks. Neither
 * has had a surface, which means neither has ever been READ, which means the
 * work of detecting them has so far bought nothing.
 *
 *   1  DPA DEFAULTS. DeferredContract.defaultedAt, stamped by the lazy deadline
 *      sweep and never cleared — not even when a defaulted contract is later
 *      paid off in full. Deliberately so: paying late settles the debt, not the
 *      record. So this list is "everyone who has ever missed a deadline", which
 *      is the list a moderator wants, and `stillOwing` separates the ones who
 *      made good afterwards from the ones who did not.
 *
 *   2  REPEAT-TRADE-PAIR FLAGS. TaskCompletion rows with task = VERIFIED_SWAP
 *      and leaves = 0. awardTask() writes one of those every time two users who
 *      have already traded inside NEW_PARTNER_WINDOW_DAYS trade again: the swap
 *      completes normally and pays nothing, because otherwise two accounts
 *      could pass the same two items back and forth and mint Leaves forever.
 *
 *      A zero row is not itself misconduct — friends trade repeatedly, and the
 *      faucet guard already did its job. It is a SIGNAL, and it is worth a
 *      human's eye at volume: one pair with eleven zero-award swaps in a
 *      fortnight is the shape of two accounts run by one person, and nothing
 *      else in this system would ever mention it.
 *
 * Read-only. Nothing here writes, nothing here acts, and there is no
 * "investigate" button — a moderator who wants to act does it through the
 * report queue or the user route, where the audit row gets written.
 */

const querySchema = z.strictObject({
  /** Minimum zero-award swaps before a pair is worth listing. */
  minRepeats: z.coerce.number().int().min(2).max(100).optional().default(3),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
})

/** One row of the repeat-pair query. */
interface PairRow {
  userId: string
  partnerId: string
  zeroSwaps: bigint | number
  lastAt: Date
}

export async function GET(req: NextRequest) {
  const gate = await requireRole("MODERATOR")
  if (gate.response) return gate.response

  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response
  const { minRepeats, limit } = parsed.data

  // ── 1 ── every contract that has ever defaulted.
  const defaults = await prisma.deferredContract.findMany({
    where: { defaultedAt: { not: null } },
    select: {
      id: true,
      status: true,
      amountLeaves: true,
      amountPaidLeaves: true,
      deadline: true,
      defaultedAt: true,
      fulfilledAt: true,
      debtor: { select: { id: true, name: true, email: true, suspendedAt: true } },
      creditor: { select: { id: true, name: true } },
      tradeId: true,
    },
    orderBy: { defaultedAt: "desc" },
    take: limit,
  })

  // ── 2 ── repeat pairs.
  //
  // Raw SQL, and for the same reason /messages/conversations is: this is a
  // GROUP BY over a derived pair key with a HAVING on the aggregate, and Prisma
  // has no expression for it. Fully parameterised — minRepeats and limit are
  // integers validated by the schema above and passed as bindings, not
  // interpolated.
  //
  // TaskCompletion.refId is the tradeId for a VERIFIED_SWAP, which is what lets
  // the join recover who the partner was: the completion row records that USER
  // got zero, and the trade records who they got zero with.
  const pairs = await prisma.$queryRaw<PairRow[]>`
    SELECT
      tc.userId AS userId,
      CASE WHEN tr.senderId = tc.userId THEN tr.receiverId ELSE tr.senderId END AS partnerId,
      COUNT(*)          AS zeroSwaps,
      MAX(tc.createdAt) AS lastAt
    FROM TaskCompletion tc
    JOIN TradeRequest tr ON tr.id = tc.refId
    WHERE tc.task = 'VERIFIED_SWAP'
      AND tc.leaves = 0
    GROUP BY userId, partnerId
    HAVING COUNT(*) >= ${minRepeats}
    ORDER BY zeroSwaps DESC, lastAt DESC
    LIMIT ${limit}
  `

  // Names for the pairs, in one query rather than one per row.
  const ids = [...new Set(pairs.flatMap((p) => [p.userId, p.partnerId]))]
  const people = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true, suspendedAt: true, createdAt: true },
      })
    : []
  const byId = new Map(people.map((p) => [p.id, p]))

  return ok(
    {
      dpaDefaults: defaults.map((c) => ({
        contractId: c.id,
        tradeId: c.tradeId,
        status: c.status,
        principal: c.amountLeaves,
        paid: c.amountPaidLeaves,
        // The number that separates "missed a deadline then paid" from
        // "missed a deadline and still has not".
        stillOwing: c.amountLeaves - c.amountPaidLeaves,
        deadline: c.deadline,
        defaultedAt: c.defaultedAt,
        fulfilledAt: c.fulfilledAt,
        debtor: c.debtor,
        creditor: c.creditor,
      })),
      repeatPairs: pairs.map((p) => ({
        user: byId.get(p.userId) ?? { id: p.userId },
        partner: byId.get(p.partnerId) ?? { id: p.partnerId },
        zeroAwardSwaps: Number(p.zeroSwaps),
        lastAt: p.lastAt,
      })),
    },
    {
      applied: { minRepeats, limit },
      explain: {
        dpaDefaults:
          "DeferredContract.defaultedAt is stamped by the deadline sweep and never cleared. stillOwing > 0 means the debt is still live.",
        repeatPairs: `VERIFIED_SWAP completions worth 0 Leaves — the faucet guard refusing a partner already traded with inside ${NEW_PARTNER_WINDOW_DAYS} days. Not misconduct on its own; a signal at volume.`,
      },
    },
  )
}
