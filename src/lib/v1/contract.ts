import type { ContractStatus } from "@/generated/prisma/enums"

/**
 * The wire shape of a DeferredContract, and the select that fills it.
 *
 * One shape for the list, the propose response and the accept response, so a
 * client parses a contract once. The preview endpoint returns this plus the
 * debtor statistics, rather than a different contract shape.
 */

export const V1_CONTRACT_SELECT = {
  id: true,
  tradeId: true,
  debtorId: true,
  creditorId: true,
  amountLeaves: true,
  amountPaidLeaves: true,
  deadline: true,
  status: true,
  extensionUsed: true,
  extensionRequestedAt: true,
  extensionRequestedDeadline: true,
  createdAt: true,
  acceptedAt: true,
  fulfilledAt: true,
  defaultedAt: true,
} as const

const PARTY = { id: true, name: true, avatar: true } as const

export const V1_CONTRACT_PARTIES_SELECT = {
  debtor: { select: PARTY },
  creditor: { select: PARTY },
} as const

export interface V1ContractRow {
  id: string
  tradeId: string
  debtorId: string
  creditorId: string
  amountLeaves: number
  amountPaidLeaves: number
  deadline: Date
  status: ContractStatus
  extensionUsed: boolean
  extensionRequestedAt: Date | null
  extensionRequestedDeadline: Date | null
  createdAt: Date
  acceptedAt: Date | null
  fulfilledAt: Date | null
  defaultedAt: Date | null
  debtor?: { id: string; name: string; avatar: string | null }
  creditor?: { id: string; name: string; avatar: string | null }
}

/**
 * Serialises a contract for a given viewer.
 *
 * `role` is derived here rather than left to the client to work out from an id
 * comparison, for the same reason `kind` is derived on trades: the client
 * should never have to infer its own position in a relationship from ids.
 *
 * `defaulted` is reported separately from `status`. A contract that defaulted
 * and was later paid off in full reads `status: "FULFILLED"` — the debt really
 * is settled and the trading restriction really is lifted — but
 * `defaulted: true` stays, because the default is a permanent part of the
 * record and a creditor deciding on this debtor's next proposal must see it.
 */
export function v1Contract(row: V1ContractRow, viewerId: string) {
  const remaining = Math.max(0, row.amountLeaves - row.amountPaidLeaves)
  return {
    id: row.id,
    tradeId: row.tradeId,
    role: row.debtorId === viewerId ? "debtor" : row.creditorId === viewerId ? "creditor" : null,
    status: row.status,
    amountLeaves: row.amountLeaves,
    amountPaidLeaves: row.amountPaidLeaves,
    remainingLeaves: remaining,
    deadline: row.deadline,
    overdue: remaining > 0 && row.deadline.getTime() < Date.now(),
    defaulted: row.defaultedAt !== null,
    extension: {
      used: row.extensionUsed,
      requestedAt: row.extensionRequestedAt,
      requestedDeadline: row.extensionRequestedDeadline,
      pending: row.extensionRequestedAt !== null && !row.extensionUsed,
    },
    debtor: row.debtor ?? null,
    creditor: row.creditor ?? null,
    createdAt: row.createdAt,
    acceptedAt: row.acceptedAt,
    fulfilledAt: row.fulfilledAt,
    defaultedAt: row.defaultedAt,
  }
}
