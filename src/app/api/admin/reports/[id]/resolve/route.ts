import { NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { ok, notFound, conflict } from "@/lib/v1/envelope"
import { parseJsonBody } from "@/lib/v1/body"
import { resolveReport, writeAudit, OPEN_KEY } from "@/lib/moderation"

export const dynamic = "force-dynamic"

/**
 * POST /api/admin/reports/[id]/resolve — close a report, or claim it.
 *
 * Three decisions, one endpoint, because they are the same act at different
 * stages and splitting them into three routes would triple the places the audit
 * row can be forgotten:
 *
 *   reviewing   claim it. Still live; still holds its openKey slot; audited.
 *   dismissed   no violation found. Reporter told.
 *   actioned    a violation was found and something was done about it.
 *
 * "ACTIONED" DOES NOT ITSELF DO ANYTHING. Marking a report actioned records a
 * judgement; hiding the listing or suspending the account are separate calls to
 * separate routes, each with their own audit row. That separation is deliberate:
 * a single "resolve and punish" button makes the audit log ambiguous about what
 * was actually done, and the queue is not the only way a moderator arrives at a
 * listing.
 *
 * `note` is REQUIRED on all three. It is both the audit row's `reason` and,
 * for the two terminal states, the text the reporter reads. One field for both
 * so a moderator cannot write a real reason into the audit and a bland
 * platitude to the reporter — the person affected reads the same sentence the
 * record keeps.
 */

const MAX_NOTE = 1000

const bodySchema = z.strictObject({
  action: z.enum(["reviewing", "dismissed", "actioned"]),
  note: z
    .string()
    .trim()
    .min(1, "A reason is required — it is written to the audit log and shown to the reporter")
    .max(MAX_NOTE),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRole("MODERATOR")
  if (gate.response) return gate.response
  const actor = gate.actor

  const { id } = await params
  const parsed = await parseJsonBody(req, bodySchema)
  if (!parsed.ok) return parsed.response
  const { action, note } = parsed.data

  const report = await prisma.report.findUnique({
    where: { id },
    select: { id: true, status: true, reporterId: true, targetType: true, targetId: true },
  })
  if (!report) return notFound("Report not found")

  // A resolved report stays resolved. Re-resolving would fire a second
  // REPORT_RESOLVED notification at the reporter and overwrite the first
  // decision with no trace of it in `status` — the audit row would show two
  // resolutions and the report itself only the later one.
  if (report.status === "ACTIONED" || report.status === "DISMISSED") {
    return conflict("That report is already resolved", {
      code: "REPORT_ALREADY_RESOLVED",
      status: report.status,
    })
  }

  if (action === "reviewing") {
    if (report.status === "REVIEWING") {
      return conflict("That report is already being reviewed", { code: "REPORT_ALREADY_REVIEWING" })
    }
    // openKey is untouched: REVIEWING is still LIVE, so the report keeps its
    // slot in the unique index and the reporter still cannot refile.
    await prisma.$transaction(async (tx) => {
      await tx.report.update({ where: { id }, data: { status: "REVIEWING" } })
      await writeAudit(tx, {
        actorId: actor.id,
        action: "REPORT_REVIEWING",
        targetType: "REPORT",
        targetId: id,
        reportId: id,
        reason: note,
        detail: { from: report.status, to: "REVIEWING", openKey: OPEN_KEY },
      })
    })
    return ok({ report: { id, status: "REVIEWING" } })
  }

  const status = action === "actioned" ? "ACTIONED" : "DISMISSED"

  // The report update, the audit row and the reporter's notification move
  // together or not at all — see resolveReport(). A resolution that failed to
  // notify would be a promise /trust makes and this system quietly breaks.
  await prisma.$transaction(async (tx) => {
    await resolveReport(tx, {
      reportId: id,
      reporterId: report.reporterId,
      actorId: actor.id,
      status,
      note,
    })
  })

  return ok({
    report: { id, status },
    reporterNotified: true,
  })
}
