import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { sweepLapsedContracts } from "@/lib/contracts"
import { ok, unauthenticated, notFound, conflict } from "@/lib/v1/envelope"
import { parseJsonBody } from "@/lib/v1/body"
import { V1_CONTRACT_SELECT, V1_CONTRACT_PARTIES_SELECT, v1Contract, type V1ContractRow } from "@/lib/v1/contract"

export const dynamic = "force-dynamic"

/**
 * POST /api/v1/contracts/[id]/extension/grant — the creditor allows it. Rule 5.
 *
 * The creditor, and only the creditor. An extension is the creditor giving up
 * something real — their claim ripens later, and the debtor's default is
 * postponed — so it cannot be self-served by the debtor under any name.
 *
 * This is the only place `extensionUsed` is set to true, and it is set in the
 * SAME conditional write that moves the deadline, guarded on
 * `extensionUsed: false`. That single statement is what makes "exactly one"
 * true: a second grant finds extensionUsed already true, matches zero rows, and
 * returns 409 without touching the deadline.
 *
 * The new deadline is the one the DEBTOR requested, not one the creditor
 * supplies here. The creditor is consenting to a specific proposal they can
 * read on the contract, and letting them pick a different date at grant time
 * would make "grant" a counter-offer that the debtor never agreed to.
 */

const bodySchema = z.strictObject({})

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
    select: V1_CONTRACT_SELECT,
  })
  if (!contract) return notFound("Contract not found")
  if (contract.creditorId !== viewerId) return notFound("Contract not found")

  if (contract.status !== "ACTIVE") {
    return conflict(
      contract.status === "DEFAULTED"
        ? "This agreement has already lapsed into default and cannot be extended."
        : `Only an active agreement can be extended (this one is ${contract.status}).`,
      { status: contract.status },
    )
  }
  if (contract.extensionUsed) {
    return conflict("This agreement has already had its one extension.", {
      rule: "DPA_ONE_EXTENSION",
      deadline: contract.deadline,
    })
  }
  if (!contract.extensionRequestedAt || !contract.extensionRequestedDeadline) {
    return conflict("The debtor has not requested an extension on this agreement.", {
      rule: "DPA_NO_EXTENSION_REQUESTED",
    })
  }

  // THE statement. extensionUsed: false in the WHERE is the "exactly one" rule;
  // everything above is just a better error message for the same condition.
  const moved = await prisma.deferredContract.updateMany({
    where: { id: contract.id, status: "ACTIVE", extensionUsed: false },
    data: {
      deadline: contract.extensionRequestedDeadline,
      extensionUsed: true,
      // The request fields are left standing rather than cleared. They record
      // what was asked and when, and clearing them would make a granted
      // extension indistinguishable from one that was never requested.
    },
  })
  if (moved.count !== 1) {
    return conflict("This agreement changed while the extension was being granted")
  }

  const fresh = await prisma.deferredContract.findUnique({
    where: { id: contract.id },
    select: { ...V1_CONTRACT_SELECT, ...V1_CONTRACT_PARTIES_SELECT },
  })

  return ok(
    { contract: v1Contract(fresh as V1ContractRow, viewerId) },
    {
      previousDeadline: contract.deadline,
      newDeadline: contract.extensionRequestedDeadline,
      extensionsRemaining: 0,
    },
  )
}
