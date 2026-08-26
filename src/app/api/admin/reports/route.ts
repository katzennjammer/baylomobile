import { NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { ok, invalid } from "@/lib/v1/envelope"
import { parseQuery, paginationShape } from "@/lib/v1/query"
import { decodeCursor, encodeCursor, olderThan, paginate } from "@/lib/v1/cursor"
import {
  REPORT_CATEGORIES,
  REPORT_TARGET_TYPES,
  CATEGORY_LABEL,
  toDbCategory,
  toDbTarget,
  toWireCategory,
  toWireTarget,
} from "@/lib/moderation"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/reports — the moderation queue.
 *
 * WEB ONLY. The mobile client never calls anything under /api/admin: moderation
 * is done at a desk, on a screen wide enough to read a conversation next to the
 * listing it happened on, and shipping a staff surface inside a consumer app
 * binary means shipping its URLs and its shape to everyone who downloads it.
 *
 * THREE queries: the page, the status counts for the filter tabs, and the
 * reporter rows. The counts are separate rather than derived from the page
 * because a tab that says "OPEN (12)" must count all twelve, not the ones on
 * screen.
 *
 * Filters compose and all are optional: status, targetType, category. Unknown
 * parameters are rejected by parseQuery's strict schema, which matters more
 * here than elsewhere — a moderator who mistypes `?staus=OPEN` and silently
 * gets the unfiltered queue will work the wrong list all afternoon.
 */

const querySchema = z.strictObject({
  ...paginationShape,
  status: z.enum(["OPEN", "REVIEWING", "ACTIONED", "DISMISSED"]).optional(),
  targetType: z.enum(REPORT_TARGET_TYPES).optional(),
  category: z.enum(REPORT_CATEGORIES).optional(),
})

export async function GET(req: NextRequest) {
  const gate = await requireRole("MODERATOR")
  if (gate.response) return gate.response

  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response
  const { limit, status, targetType, category } = parsed.data
  const cursor = decodeCursor(parsed.data.cursor)
  if (parsed.data.cursor && !cursor) return invalid("Malformed cursor")

  const where = {
    ...(status ? { status } : {}),
    ...(targetType ? { targetType: toDbTarget(targetType) } : {}),
    ...(category ? { category: toDbCategory(category) } : {}),
  }

  // ── 1 ── the page. Keyset on (createdAt, id), same as every other list here.
  const rows = await prisma.report.findMany({
    where: { ...where, ...(olderThan(cursor) ?? {}) },
    select: {
      id: true,
      targetType: true,
      targetId: true,
      category: true,
      notes: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      reporter: { select: { id: true, name: true, avatar: true } },
      resolvedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  })
  const { page, nextCursor } = paginate(rows, limit, (r) => encodeCursor(r.createdAt, r.id))

  // ── 2 ── counts per status, for the tabs. NOT filtered by the current
  // status — a tab that disappears when you select another one is a worse
  // control than one that stays put, the same call /browse makes for its facets.
  const statusCounts = await prisma.report.groupBy({
    by: ["status"],
    where: {
      ...(targetType ? { targetType: toDbTarget(targetType) } : {}),
      ...(category ? { category: toDbCategory(category) } : {}),
    },
    _count: { id: true },
  })

  return ok(
    {
      reports: page.map((r) => ({
        id: r.id,
        targetType: toWireTarget(r.targetType),
        targetId: r.targetId,
        category: toWireCategory(r.category),
        categoryLabel: CATEGORY_LABEL[toWireCategory(r.category)],
        notes: r.notes,
        status: r.status,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt,
        reporter: r.reporter,
        resolvedBy: r.resolvedBy,
      })),
      counts: Object.fromEntries(statusCounts.map((c) => [c.status, c._count.id])),
    },
    {
      nextCursor,
      applied: { status: status ?? null, targetType: targetType ?? null, category: category ?? null },
    },
  )
}
