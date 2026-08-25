import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { DPA } from "@/lib/reputation-config"
import { sweepLapsedContracts, extensionBounds } from "@/lib/contracts"
import { ok, unauthenticated, notFound, conflict, invalid } from "@/lib/v1/envelope"
import { parseJsonBody, futureInstant } from "@/lib/v1/body"
import { V1_CONTRACT_SELECT, V1_CONTRACT_PARTIES_SELECT, v1Contract, type V1ContractRow } from "@/lib/v1/contract"

export const dynamic = "force-dynamic"

/**
 * POST /api/v1/contracts/[id]/extension/request — the debtor asks. Rule 5.
 *
 * Asking does not move the deadline. It records that the debtor asked and what
 * they asked for; only the creditor's grant moves anything, and only once.
 *
 * EXACTLY ONE EXTENSION, and `extensionUsed` is the whole enforcement. It is set
 * by the GRANT, never by the request — so a debtor cannot burn their own
 * extension by asking, and cannot obtain a second one by asking again. The
 * refusal below fires on a request as well as on a grant, because a debtor who
 * has already had their extension should be told so at the point they ask
 * rather than after the creditor has considered it.
 */

const bodySchema = z.strictObject({
  /** The new deadline being asked for. Bounded relative to the current one. */
  deadline: futureInstant,
  message: z.string().trim().max(500).optional(),
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

  // Sweep first. A debtor whose deadline lapsed before they got round to asking
  // is in default, and the state they are asking to extend no longer exists.
  await sweepLapsedContracts(prisma, { contractId: id })

  const contract = await prisma.deferredContract.findUnique({
    where: { id },
    select: V1_CONTRACT_SELECT,
  })
  if (!contract) return notFound("Contract not found")
  if (contract.debtorId !== viewerId) return notFound("Contract not found")

  if (contract.status !== "ACTIVE") {
    return conflict(
      contract.status === "DEFAULTED"
        ? "This agreement has already lapsed. An extension cannot un-default it."
        : `Only an active agreement can be extended (this one is ${contract.status}).`,
      { status: contract.status },
    )
  }

  // Rule 5, first half. One extension per contract, ever.
  if (contract.extensionUsed) {
    return conflict("You have already used the one extension on this agreement.", {
      rule: "DPA_ONE_EXTENSION",
      extensionUsed: true,
      deadline: contract.deadline,
    })
  }
  if (contract.extensionRequestedAt) {
    return conflict("You already have an extension request awaiting your creditor.", {
      rule: "DPA_EXTENSION_PENDING",
      requestedDeadline: contract.extensionRequestedDeadline,
    })
  }

  const { earliest, latest } = extensionBounds(contract.deadline)
  const requested = parsed.data.deadline
  if (requested < earliest || requested > latest) {
    return invalid(
      `An extension must move the deadline forward by between ${DPA.minExtensionDays} and ${DPA.maxExtensionDays} days.`,
    )
  }

  // Conditional on there being no request yet, so two taps record one request.
  const moved = await prisma.deferredContract.updateMany({
    where: { id: contract.id, status: "ACTIVE", extensionUsed: false, extensionRequestedAt: null },
    data: { extensionRequestedAt: new Date(), extensionRequestedDeadline: requested },
  })
  if (moved.count !== 1) {
    return conflict("This agreement changed while the request was being recorded")
  }

  const fresh = await prisma.deferredContract.findUnique({
    where: { id: contract.id },
    select: { ...V1_CONTRACT_SELECT, ...V1_CONTRACT_PARTIES_SELECT },
  })

  return ok(
    { contract: v1Contract(fresh as V1ContractRow, viewerId) },
    {
      // Stated so no client renders this as "extended".
      deadlineMoved: false,
      awaitingCreditor: true,
      message: parsed.data.message ?? null,
    },
  )
}
