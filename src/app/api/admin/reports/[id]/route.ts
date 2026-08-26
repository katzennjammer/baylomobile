import { NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { ok, notFound } from "@/lib/v1/envelope"
import { parseQuery } from "@/lib/v1/query"
import {
  CATEGORY_LABEL,
  suspensionState,
  toWireCategory,
  toWireTarget,
  type ReportTargetWire,
} from "@/lib/moderation"

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/reports/[id] — everything needed to decide one report.
 *
 * The three things a moderator has to see before acting, which is why this is
 * one endpoint and not three:
 *
 *   THE REPORTED CONTENT   the listing, the account, or the message — resolved
 *                          by targetType, and NULL when the target is gone.
 *   THE REPORTER           who filed it, and what else they have filed. A
 *                          reporter with forty dismissed reports is a different
 *                          signal from one with a single open report.
 *   THE TARGET'S HISTORY   every other report against this target, and every
 *                          admin action already taken on it.
 *
 * ON THE MISSING TARGET. `content: null` is a real state and not an error: a
 * Report has no foreign key to its target, deliberately (see the model note),
 * precisely so it outlives a listing that gets deleted. A moderator seeing
 * "content: null, and here are the six other reports about this seller" is
 * better served than one seeing a 404.
 *
 * NO BLOCK FILTER ANYWHERE IN THIS FILE. A moderator reading a harassment
 * report must see the content that caused it even if — especially if — the
 * parties have blocked each other. Blocking is a consumer-surface rule; it is
 * not a rule about what the moderation queue may read, and applying it here
 * would make a report unreadable exactly when it mattered most.
 */

const querySchema = z.strictObject({})

/** The reported content, whatever kind it is, or null if it is gone. */
async function loadContent(targetType: ReportTargetWire, targetId: string) {
  if (targetType === "listing") {
    const item = await prisma.item.findUnique({
      where: { id: targetId },
      select: {
        id: true, title: true, description: true, images: true,
        category: true, condition: true, valueLeaves: true, status: true,
        moderationHiddenAt: true, createdAt: true,
        user: { select: { id: true, name: true, avatar: true, email: true } },
      },
    })
    if (!item) return null
    return { kind: "listing" as const, listing: item, owner: item.user }
  }

  if (targetType === "user") {
    const user = await prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true, name: true, email: true, avatar: true, bio: true,
        location: true, createdAt: true, rating: true, totalTrades: true,
        isVerified: true, deletedAt: true, suspendedAt: true, suspendedUntil: true,
        _count: { select: { items: true, reportsMade: true } },
      },
    })
    if (!user) return null
    return {
      kind: "user" as const,
      user: { ...user, suspension: suspensionState(user) },
      owner: { id: user.id, name: user.name, avatar: user.avatar, email: user.email },
    }
  }

  // MESSAGE. Loaded with a window of surrounding messages, because a single
  // line lifted out of a conversation is exactly how an innocent remark reads
  // as a threat and a threat reads as a joke. Ten messages either side is
  // enough to tell which.
  const message = await prisma.message.findUnique({
    where: { id: targetId },
    select: {
      id: true, content: true, createdAt: true,
      sender: { select: { id: true, name: true, avatar: true, email: true } },
      receiver: { select: { id: true, name: true, avatar: true } },
    },
  })
  if (!message) return null

  const context = await prisma.message.findMany({
    where: {
      OR: [
        { senderId: message.sender.id, receiverId: message.receiver.id },
        { senderId: message.receiver.id, receiverId: message.sender.id },
      ],
    },
    select: { id: true, content: true, createdAt: true, senderId: true },
    orderBy: { createdAt: "desc" },
    take: 21,
  })

  return {
    kind: "message" as const,
    message,
    context: context.reverse(),
    owner: message.sender,
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRole("MODERATOR")
  if (gate.response) return gate.response

  const { id } = await params
  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response

  const report = await prisma.report.findUnique({
    where: { id },
    select: {
      id: true, targetType: true, targetId: true, category: true,
      notes: true, status: true, createdAt: true,
      resolvedAt: true, resolutionNote: true,
      reporter: {
        select: {
          id: true, name: true, avatar: true, email: true, createdAt: true,
          _count: { select: { reportsMade: true } },
        },
      },
      resolvedBy: { select: { id: true, name: true } },
    },
  })
  if (!report) return notFound("Report not found")

  const targetType = toWireTarget(report.targetType)

  const [content, otherReports, targetHistory, reporterHistory] = await Promise.all([
    loadContent(targetType, report.targetId),

    // Everything else ever filed against this same target. The count is the
    // decision: one report is a complaint, six is a pattern.
    prisma.report.findMany({
      where: {
        targetType: report.targetType,
        targetId: report.targetId,
        id: { not: report.id },
      },
      select: {
        id: true, category: true, status: true, notes: true, createdAt: true,
        reporter: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),

    // What has already been done to this target, by whom, and why.
    prisma.adminAction.findMany({
      where: {
        targetType: targetType === "listing" ? "LISTING" : targetType === "user" ? "USER" : "REPORT",
        targetId: report.targetId,
      },
      select: {
        id: true, action: true, reason: true, createdAt: true,
        actor: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),

    // The reporter's own track record. A reporter whose reports are all
    // dismissed is itself a moderation signal, and one this queue would
    // otherwise never surface.
    prisma.report.groupBy({
      by: ["status"],
      where: { reporterId: report.reporter.id },
      _count: { id: true },
    }),
  ])

  return ok({
    report: {
      id: report.id,
      targetType,
      targetId: report.targetId,
      category: toWireCategory(report.category),
      categoryLabel: CATEGORY_LABEL[toWireCategory(report.category)],
      notes: report.notes,
      status: report.status,
      createdAt: report.createdAt,
      resolvedAt: report.resolvedAt,
      resolutionNote: report.resolutionNote,
      resolvedBy: report.resolvedBy,
    },
    reporter: {
      ...report.reporter,
      // Filed vs upheld: the ratio a moderator needs before trusting the notes.
      history: Object.fromEntries(reporterHistory.map((h) => [h.status, h._count.id])),
    },
    content,
    otherReports: otherReports.map((r) => ({
      ...r,
      category: toWireCategory(r.category),
    })),
    targetHistory,
  })
}
