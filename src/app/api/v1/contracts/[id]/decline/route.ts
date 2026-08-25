import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { ok, unauthenticated, notFound, conflict } from "@/lib/v1/envelope"
import { parseJsonBody } from "@/lib/v1/body"
import { V1_CONTRACT_SELECT, V1_CONTRACT_PARTIES_SELECT, v1Contract, type V1ContractRow } from "@/lib/v1/contract"

export const dynamic = "force-dynamic"

/**
 * POST /api/v1/contracts/[id]/decline — the creditor refuses.
 *
 * The row moves to DECLINED and STAYS. Deleting it would be tidier and would
 * also erase the only durable trace of a creditor having looked at this
 * debtor's numbers and said no — which is precisely the kind of signal the
 * preview endpoint exists to surface. A declined proposal costs the debtor
 * nothing (it is not a default, it does not count against on-time rate, and it
 * frees their one contract slot immediately), but it is a fact, and facts about
 * deferred payment are what this feature runs on.
 *
 * Either party may decline. The creditor refusing is the point of the endpoint;
 * the debtor "declining" their own proposal is a withdrawal, and giving it a
 * separate endpoint and status would be two more states for the same outcome —
 * the proposal is off the table and the slot is free.
 */

const bodySchema = z.strictObject({
  reason: z.string().trim().max(500).optional(),
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

  const contract = await prisma.deferredContract.findUnique({
    where: { id },
    select: V1_CONTRACT_SELECT,
  })
  if (!contract) return notFound("Contract not found")
  if (contract.debtorId !== viewerId && contract.creditorId !== viewerId) {
    return notFound("Contract not found")
  }

  // Only an unaccepted proposal can be declined. Once ACTIVE the item is on its
  // way to changing hands and the debt is real; there is no unilateral exit
  // from it, by either party. A creditor who wants to forgive an ACTIVE debt is
  // asking for something this feature does not have, and quietly wiring decline
  // to do it would be a reversal by another name.
  if (contract.status !== "PENDING_ACCEPT") {
    return conflict(
      contract.status === "ACTIVE"
        ? "This agreement is already active and cannot be withdrawn."
        : `This agreement is already ${contract.status}`,
      { status: contract.status },
    )
  }

  const moved = await prisma.deferredContract.updateMany({
    where: { id: contract.id, status: "PENDING_ACCEPT" },
    data: { status: "DECLINED" },
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
      declinedBy: contract.creditorId === viewerId ? "creditor" : "debtor",
      // The trade is unblocked either way: settlement only refuses to complete
      // while a contract is PENDING_ACCEPT, and this one no longer is. The
      // parties can now settle at equal value, or propose a smaller amount.
      tradeMayNowComplete: true,
    },
  )
}
