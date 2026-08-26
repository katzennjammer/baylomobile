import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { ok, unauthenticated, notFound, forbidden, conflict } from "@/lib/v1/envelope"
import { parseJsonBody } from "@/lib/v1/body"
import { enforceRateLimit } from "@/lib/rate-limit-config"
import {
  REPORT_CATEGORIES,
  REPORT_TARGET_TYPES,
  MAX_REPORT_NOTES,
  LIVE_REPORT_STATUSES,
  OPEN_KEY,
  toDbCategory,
  toDbTarget,
  toWireCategory,
  toWireTarget,
  type ReportTargetWire,
} from "@/lib/moderation"

export const dynamic = "force-dynamic"

/**
 * POST /api/v1/reports — file a report.
 * GET  /api/v1/reports — the reports YOU filed, with their outcomes.
 *
 * Four things guard this endpoint, and they guard different attacks:
 *
 *   RATE LIMIT      one reporter cannot bury the queue in a loop.
 *   ONE LIVE REPORT  the same reporter cannot pile on the same target.
 *   NO SELF-REPORT   you cannot report yourself or your own listing.
 *   TARGET EXISTS    and, for a message, you must be in the conversation.
 *
 * The last one is the least obvious and the most important. Without it,
 * `targetType: "message"` with a guessed id is an ORACLE: a 201 means the id
 * exists, a 404 means it does not, and a few thousand requests map out the
 * message table. Reports are checked against the reporter's own visibility, so
 * a report is only possible for content the reporter could already see.
 */

const bodySchema = z.strictObject({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.string().min(1).max(64),
  category: z.enum(REPORT_CATEGORIES),
  notes: z
    .string()
    .trim()
    .max(MAX_REPORT_NOTES, `notes cannot exceed ${MAX_REPORT_NOTES} characters`)
    .optional(),
})

/**
 * Who owns the reported thing, or null when it does not exist / is not visible
 * to this reporter.
 *
 * Returns the owner id rather than a boolean because the self-report check
 * needs it, and resolving it twice is how the two checks drift apart.
 */
async function resolveTargetOwner(
  targetType: ReportTargetWire,
  targetId: string,
  reporterId: string,
): Promise<{ ownerId: string; label: string } | null> {
  if (targetType === "listing") {
    const item = await prisma.item.findUnique({
      where: { id: targetId },
      select: { userId: true, title: true },
    })
    return item ? { ownerId: item.userId, label: item.title } : null
  }

  if (targetType === "user") {
    const user = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, name: true, deletedAt: true },
    })
    // A deleted account is anonymised and unbrowsable; reporting one would
    // create a queue item a moderator can do nothing with.
    return user && !user.deletedAt ? { ownerId: user.id, label: user.name } : null
  }

  // MESSAGE. Participation is required — see the oracle note above. A message
  // the reporter neither sent nor received is reported as "not found", the same
  // answer a nonexistent id gets, so the two are indistinguishable from outside.
  const message = await prisma.message.findFirst({
    where: {
      id: targetId,
      OR: [{ senderId: reporterId }, { receiverId: reporterId }],
    },
    select: { senderId: true, content: true },
  })
  if (!message) return null
  return {
    ownerId: message.senderId,
    label: message.content.slice(0, 120),
  }
}

export async function POST(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const reporterId = session.user.id

  const limited = enforceRateLimit("report", reporterId)
  if (limited) return limited

  const parsed = await parseJsonBody(req, bodySchema)
  if (!parsed.ok) return parsed.response
  const { targetType, targetId, category, notes } = parsed.data

  const target = await resolveTargetOwner(targetType, targetId, reporterId)
  if (!target) return notFound("That content no longer exists")

  // Self-report. Covers both spellings at once: reporting your own account
  // (targetType user, ownerId === you) and reporting your own listing or your
  // own message (ownerId === you), because resolveTargetOwner() returns the
  // owner in every case rather than the target id.
  if (target.ownerId === reporterId) {
    return forbidden("You cannot report your own content", { code: "SELF_REPORT" })
  }

  const dbTarget = toDbTarget(targetType)

  // The application half of "one live report per reporter per target". The
  // unique index on (reporterId, targetType, targetId, openKey) is the other
  // half and the authoritative one; this check exists to return a useful 409
  // with the existing report's id instead of a driver constraint error.
  const existing = await prisma.report.findFirst({
    where: {
      reporterId,
      targetType: dbTarget,
      targetId,
      status: { in: [...LIVE_REPORT_STATUSES] },
    },
    select: { id: true, status: true, createdAt: true },
  })
  if (existing) {
    return conflict("You have already reported this — we are still reviewing it", {
      code: "REPORT_ALREADY_OPEN",
      reportId: existing.id,
      status: existing.status,
      reportedAt: existing.createdAt,
    })
  }

  try {
    const report = await prisma.report.create({
      data: {
        reporterId,
        targetType: dbTarget,
        targetId,
        category: toDbCategory(category),
        notes: notes || null,
        status: "OPEN",
        // Written here and nulled only by resolveReport(). See the column note.
        openKey: OPEN_KEY,
      },
      select: { id: true, status: true, createdAt: true },
    })

    return ok({
      report: {
        id: report.id,
        status: report.status,
        targetType,
        targetId,
        category,
        createdAt: report.createdAt,
      },
      // What /trust promises, said back at the moment of the promise.
      message: "Thanks — a moderator will review this and let you know the outcome.",
    })
  } catch (err) {
    // The unique index firing means a concurrent duplicate beat the findFirst
    // above. That is the race the index exists for, and the honest answer is
    // the same 409 the sequential case gets.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return conflict("You have already reported this — we are still reviewing it", {
        code: "REPORT_ALREADY_OPEN",
      })
    }
    throw err
  }
}

/**
 * GET — the reporter's own reports.
 *
 * Exists so "we will let you know the outcome" is checkable rather than a
 * matter of faith in a notification arriving. Returns only rows this caller
 * filed; the moderator's view is a different endpoint behind requireRole().
 *
 * Note what is NOT returned: `resolvedById`. A reporter must never be handed
 * the identity of the moderator who read their harassment report.
 */
export async function GET() {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()

  const rows = await prisma.report.findMany({
    where: { reporterId: session.user.id },
    select: {
      id: true,
      targetType: true,
      targetId: true,
      category: true,
      notes: true,
      status: true,
      resolutionNote: true,
      resolvedAt: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
  })

  return ok({
    reports: rows.map((r) => ({
      id: r.id,
      targetType: toWireTarget(r.targetType),
      targetId: r.targetId,
      category: toWireCategory(r.category),
      notes: r.notes,
      status: r.status,
      resolutionNote: r.resolutionNote,
      resolvedAt: r.resolvedAt,
      createdAt: r.createdAt,
    })),
  })
}
