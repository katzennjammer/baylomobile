import type { Prisma, PrismaClient } from "@/generated/prisma/client"

/**
 * Report vocabulary, suspension, and the audit writer.
 *
 * Shared between the reporting routes, the block routes and the /api/admin
 * surface. Two neighbours own the other halves:
 *
 *   @/lib/api-auth   requireRole(), which lives beside resolveSession() because
 *                    it IS an authentication concern -- and because putting it
 *                    here would make this module import api-auth while api-auth
 *                    imports suspensionState() from here, a cycle.
 *   @/lib/blocking   block enforcement, which is a query-shape concern.
 *
 * NOTHING IN THIS MODULE IMPORTS @/lib/api-auth. Keep it that way.
 */

// ── Suspension ───────────────────────────────────────────────────────────────

export interface SuspensionState {
  suspended: boolean
  /** True when suspendedAt is set and suspendedUntil is null. */
  indefinite: boolean
  until: Date | null
}

/**
 * The ONLY correct reading of (suspendedAt, suspendedUntil).
 *
 * The trap this function exists to close: `suspendedUntil == null` looks like
 * "not suspended" and means the opposite — an indefinite suspension. Testing
 * either column alone gets it backwards half the time, so nothing tests either
 * column alone.
 *
 * A lapsed suspension (until is in the past) reads as NOT suspended and the row
 * is left alone. There is no sweep and none is needed: unlike a DPA deadline,
 * nothing accrues while a suspension runs, so lazily deciding "is it over?" at
 * read time gives exactly the same answer a sweep would have written.
 */
export function suspensionState(user: {
  suspendedAt: Date | null
  suspendedUntil: Date | null
}): SuspensionState {
  if (!user.suspendedAt) return { suspended: false, indefinite: false, until: null }
  if (user.suspendedUntil === null) {
    return { suspended: true, indefinite: true, until: null }
  }
  return {
    suspended: user.suspendedUntil.getTime() > Date.now(),
    indefinite: false,
    until: user.suspendedUntil,
  }
}

/**
 * suspensionState() as a WHERE fragment: "this user is not suspended RIGHT NOW".
 *
 * The same rule as the function above, and it exists because the obvious
 * shorthand is wrong in a way that reads as correct. `suspendedAt: null` looks
 * like "not suspended" and silently keeps hiding a user whose suspension
 * EXPIRED, because suspendedAt is never cleared by the passage of time — only
 * by an unsuspend. A seven-day suspension would become permanent for every
 * query that took the shortcut.
 *
 * Expressed as a NOT around the positive condition rather than as a top-level
 * OR, so it composes into a `where` that already has an `OR` of its own without
 * either clobbering the other.
 */
export function notSuspendedWhere(now: Date = new Date()): Prisma.UserWhereInput {
  return {
    NOT: {
      AND: [
        { suspendedAt: { not: null } },
        // Indefinite (until IS NULL) or still running (until in the future).
        { OR: [{ suspendedUntil: null }, { suspendedUntil: { gt: now } }] },
      ],
    },
  }
}

// ── Report vocabulary ────────────────────────────────────────────────────────

/**
 * The wire spelling of a report category, and the closed set of them.
 *
 * Lower-case snake on the wire, SCREAMING_SNAKE in the database. The two maps
 * below are the whole translation, and they are explicit rather than derived
 * (`.toLowerCase()`) for the reason Item.valuationSource records: a wire value
 * generated from a database enum name changes the day somebody renames the
 * enum, and by then a mobile client has shipped against the old spelling.
 */
export const REPORT_CATEGORIES = [
  "spam",
  "prohibited_item",
  "scam_or_fraud",
  "harassment",
  "counterfeit",
  "other",
] as const

export type ReportCategoryWire = (typeof REPORT_CATEGORIES)[number]
export type ReportCategoryDb =
  | "SPAM"
  | "PROHIBITED_ITEM"
  | "SCAM_OR_FRAUD"
  | "HARASSMENT"
  | "COUNTERFEIT"
  | "OTHER"

const CATEGORY_TO_DB: Record<ReportCategoryWire, ReportCategoryDb> = {
  spam: "SPAM",
  prohibited_item: "PROHIBITED_ITEM",
  scam_or_fraud: "SCAM_OR_FRAUD",
  harassment: "HARASSMENT",
  counterfeit: "COUNTERFEIT",
  other: "OTHER",
}

const CATEGORY_TO_WIRE: Record<ReportCategoryDb, ReportCategoryWire> = {
  SPAM: "spam",
  PROHIBITED_ITEM: "prohibited_item",
  SCAM_OR_FRAUD: "scam_or_fraud",
  HARASSMENT: "harassment",
  COUNTERFEIT: "counterfeit",
  OTHER: "other",
}

export const toDbCategory = (c: ReportCategoryWire): ReportCategoryDb => CATEGORY_TO_DB[c]
export const toWireCategory = (c: string): ReportCategoryWire =>
  CATEGORY_TO_WIRE[c as ReportCategoryDb] ?? "other"

/** Human labels for the admin queue. Reworded freely; never sent as an id. */
export const CATEGORY_LABEL: Record<ReportCategoryWire, string> = {
  spam: "Spam",
  prohibited_item: "Prohibited item",
  scam_or_fraud: "Scam or fraud",
  harassment: "Harassment",
  counterfeit: "Counterfeit",
  other: "Other",
}

export const REPORT_TARGET_TYPES = ["listing", "user", "message"] as const
export type ReportTargetWire = (typeof REPORT_TARGET_TYPES)[number]
export type ReportTargetDb = "LISTING" | "USER" | "MESSAGE"

const TARGET_TO_DB: Record<ReportTargetWire, ReportTargetDb> = {
  listing: "LISTING",
  user: "USER",
  message: "MESSAGE",
}
const TARGET_TO_WIRE: Record<ReportTargetDb, ReportTargetWire> = {
  LISTING: "listing",
  USER: "user",
  MESSAGE: "message",
}

export const toDbTarget = (t: ReportTargetWire): ReportTargetDb => TARGET_TO_DB[t]
export const toWireTarget = (t: string): ReportTargetWire =>
  TARGET_TO_WIRE[t as ReportTargetDb] ?? "user"

/**
 * Cap on the reporter's free text.
 *
 * `notes` is @db.Text (64 KB). 2,000 characters is enough to describe what
 * happened and short enough that a moderator reads it rather than skimming it —
 * and short enough that the report table is not a place to store a novel per
 * button press.
 */
export const MAX_REPORT_NOTES = 2000

/** Statuses that count as still open. Both of them, everywhere. */
export const LIVE_REPORT_STATUSES = ["OPEN", "REVIEWING"] as const

/**
 * The value of Report.openKey while a report is live.
 *
 * A single shared literal because it appears in a unique index: two spellings
 * would silently permit two live reports per target, which is the exact thing
 * the index exists to prevent.
 */
export const OPEN_KEY = "live"

// ── The audit writer ─────────────────────────────────────────────────────────

export type AdminActionKind =
  | "REPORT_REVIEWING"
  | "REPORT_DISMISSED"
  | "REPORT_ACTIONED"
  | "LISTING_HIDDEN"
  | "LISTING_UNHIDDEN"
  | "USER_SUSPENDED"
  | "USER_UNSUSPENDED"
  // Safe-Zone hubs. These are acts on SHARED INFRASTRUCTURE rather than on a
  // person or their content, which is a new kind of entry in this log and
  // deliberately kept in the same one: a hub coordinate that quietly moved 400
  // metres, with nobody named against the change, is a worse failure than most
  // takedowns -- people navigate to these places, and the first sign of trouble
  // is two strangers standing in different car parks.
  | "HUB_CREATED"
  | "HUB_UPDATED"
  | "HUB_DEACTIVATED"
  | "HUB_REACTIVATED"

export type AdminTargetType = "REPORT" | "LISTING" | "USER" | "HUB"

/** A Prisma client or a transaction client. */
type Db = PrismaClient | Prisma.TransactionClient

/**
 * Writes one audit row.
 *
 * ALWAYS CALLED INSIDE THE SAME TRANSACTION AS THE CHANGE IT DESCRIBES, and
 * that is the only rule this function has. An audit row written afterwards, on
 * its own connection, is an audit row that can fail to exist for a change that
 * did happen — and a moderation log with holes in it is worse than no log,
 * because it invites the reader to trust the rows that are there.
 *
 * It deliberately does NOT swallow errors, unlike awardTaskAsync() next door.
 * A task reward that fails to record costs somebody ten Leaves; an admin action
 * that fails to record costs the ability to answer "who suspended this user?".
 * If the audit write throws, the moderation action rolls back with it. That is
 * the correct outcome.
 */
export async function writeAudit(
  db: Db,
  input: {
    actorId: string
    action: AdminActionKind
    targetType: AdminTargetType
    targetId: string
    reportId?: string | null
    reason: string
    detail?: unknown
  },
) {
  return db.adminAction.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      reportId: input.reportId ?? null,
      reason: input.reason,
      detail: input.detail === undefined ? null : JSON.stringify(input.detail),
    },
  })
}

/**
 * Closes a report and tells the reporter.
 *
 * Three things move together, in one transaction:
 *   1. the report's status, resolvedBy/resolvedAt, and openKey -> NULL
 *   2. the audit row
 *   3. the REPORT_RESOLVED notification to the reporter
 *
 * ON (1): `openKey` is nulled in the SAME UPDATE as `status`. Two statements
 * would leave a window in which the report reads as resolved while still
 * holding its slot in the unique index, and a reporter refiling in that window
 * gets a spurious conflict. See the long note on the column.
 *
 * ON (3): the notification is inside the transaction, not fired afterwards.
 * /trust promises the reporter an outcome and Google Play's UGC policy expects
 * one; a resolution that silently fails to notify is a promise this system is
 * quietly not keeping, and the way to find out is never.
 *
 * `note` is what the reporter reads. It is written by the moderator and passed
 * through verbatim — it is not a template, because the useful half of "we
 * removed the listing" is which listing and why.
 */
export async function resolveReport(
  db: Db,
  input: {
    reportId: string
    reporterId: string
    actorId: string
    status: "ACTIONED" | "DISMISSED"
    note: string
  },
) {
  const now = new Date()

  await db.report.update({
    where: { id: input.reportId },
    data: {
      status: input.status,
      // Same statement as `status`. Never its own.
      openKey: null,
      resolvedById: input.actorId,
      resolvedAt: now,
      resolutionNote: input.note,
    },
  })

  await writeAudit(db, {
    actorId: input.actorId,
    action: input.status === "ACTIONED" ? "REPORT_ACTIONED" : "REPORT_DISMISSED",
    targetType: "REPORT",
    targetId: input.reportId,
    reportId: input.reportId,
    reason: input.note,
  })

  await db.notification.create({
    data: {
      userId: input.reporterId,
      type: "REPORT_RESOLVED",
      message:
        input.status === "ACTIONED"
          ? `We reviewed your report and took action. ${input.note}`
          : `We reviewed your report and did not find a policy violation. ${input.note}`,
      // No `actorId`: the reporter must not learn which moderator handled it,
      // and on a harassment report they must certainly not be handed a name to
      // go and contact. The audit row knows; the notification does not.
      link: "/dashboard",
      entityType: "report",
      entityId: input.reportId,
    },
  })
}
