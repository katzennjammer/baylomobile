import Link from "next/link"
import { notFound } from "next/navigation"
import { auth } from "@root/auth"
import prisma from "@/lib/prisma"
import {
  CATEGORY_LABEL,
  suspensionState,
  toWireCategory,
  toWireTarget,
} from "@/lib/moderation"
import ModerationActions from "./ModerationActions"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * /admin/reports/[id] — one report, with everything needed to decide it.
 *
 * NO BLOCK FILTER AND NO TAKEDOWN FILTER ANYWHERE ON THIS PAGE. A moderator
 * reading a harassment report must see the content that caused it even when —
 * especially when — the two parties have blocked each other, and must see a
 * listing that a moderator has already hidden. Blocking and hiding are consumer
 * surface rules; they are not rules about what the moderation queue may read,
 * and applying them here would make a report unreadable exactly when it mattered.
 */

const card: React.CSSProperties = {
  background: "#fff", borderRadius: 14, border: "1px solid rgba(0,0,0,.08)",
  padding: 20, display: "flex", flexDirection: "column", gap: 10,
}
const label: React.CSSProperties = { fontSize: 12, color: "#999", fontWeight: 600 }

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()

  const [report, me] = await Promise.all([
    prisma.report.findUnique({
      where: { id },
      select: {
        id: true, targetType: true, targetId: true, category: true,
        notes: true, status: true, createdAt: true,
        resolvedAt: true, resolutionNote: true,
        reporter: {
          select: {
            id: true, name: true, email: true, createdAt: true,
            _count: { select: { reportsMade: true } },
          },
        },
        resolvedBy: { select: { name: true } },
      },
    }),
    prisma.user.findUnique({
      where: { id: session!.user!.id! },
      select: { role: true },
    }),
  ])

  if (!report) notFound()

  const targetType = toWireTarget(report.targetType)

  // The reported content, by kind. Nulls are a real state, not an error: a
  // Report has no foreign key to its target precisely so it survives the target
  // being deleted — see the model note.
  const [listing, subjectUser, message] = await Promise.all([
    targetType === "listing"
      ? prisma.item.findUnique({
          where: { id: report.targetId },
          select: {
            id: true, title: true, description: true, category: true,
            condition: true, valueLeaves: true, status: true,
            moderationHiddenAt: true, createdAt: true,
            user: { select: { id: true, name: true, email: true, suspendedAt: true, suspendedUntil: true } },
          },
        })
      : null,
    targetType === "user"
      ? prisma.user.findUnique({
          where: { id: report.targetId },
          select: {
            id: true, name: true, email: true, bio: true, location: true,
            createdAt: true, rating: true, totalTrades: true, role: true,
            suspendedAt: true, suspendedUntil: true, deletedAt: true,
            _count: { select: { items: true } },
          },
        })
      : null,
    targetType === "message"
      ? prisma.message.findUnique({
          where: { id: report.targetId },
          select: {
            id: true, content: true, createdAt: true,
            sender: { select: { id: true, name: true, email: true, suspendedAt: true, suspendedUntil: true } },
            receiver: { select: { id: true, name: true } },
          },
        })
      : null,
  ])

  // Context around a reported message. A single line lifted out of a
  // conversation is how an innocent remark reads as a threat and a threat reads
  // as a joke; ten either side is enough to tell which.
  const context =
    message
      ? (
          await prisma.message.findMany({
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
        ).reverse()
      : []

  const [otherReports, targetHistory, reporterHistory] = await Promise.all([
    prisma.report.findMany({
      where: { targetType: report.targetType, targetId: report.targetId, id: { not: report.id } },
      select: {
        id: true, category: true, status: true, notes: true, createdAt: true,
        reporter: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.adminAction.findMany({
      where: {
        targetType: targetType === "listing" ? "LISTING" : targetType === "user" ? "USER" : "REPORT",
        targetId: report.targetId,
      },
      select: {
        id: true, action: true, reason: true, createdAt: true,
        actor: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.report.groupBy({
      by: ["status"],
      where: { reporterId: report.reporter.id },
      _count: { id: true },
    }),
  ])

  // Who the action panel would act on. For a listing that is its owner; for a
  // message its sender; for a user report the user themselves.
  const subjectRow = subjectUser ?? listing?.user ?? message?.sender ?? null
  const subject = subjectRow
    ? {
        id: subjectRow.id,
        name: subjectRow.name,
        suspended: suspensionState(subjectRow).suspended,
      }
    : null

  const repHistory = Object.fromEntries(reporterHistory.map((h) => [h.status, h._count.id]))

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Link href="/admin" style={{ fontSize: 13, color: "#4CAF50" }}>← Back to queue</Link>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", gap: 18, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>

          {/* ── The report ── */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <h1 style={{ fontSize: 20, fontWeight: 800 }}>
                {CATEGORY_LABEL[toWireCategory(report.category)]} · {targetType}
              </h1>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{report.status}</span>
            </div>
            <div style={label}>Filed {report.createdAt.toLocaleString()}</div>
            {report.notes && (
              <p style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", background: "#f7f7f8", padding: 12, borderRadius: 10 }}>
                {report.notes}
              </p>
            )}
            {report.resolvedAt && (
              <p style={{ fontSize: 13, color: "#666" }}>
                Resolved {report.resolvedAt.toLocaleString()}
                {report.resolvedBy ? ` by ${report.resolvedBy.name}` : ""} — “{report.resolutionNote}”
              </p>
            )}
          </div>

          {/* ── The reported content ── */}
          <div style={card}>
            <p style={{ fontSize: 15, fontWeight: 800 }}>Reported content</p>

            {targetType === "listing" && (listing ? (
              <>
                <div style={label}>
                  {listing.category} · {listing.condition} · {listing.valueLeaves ?? "—"} Leaves ·{" "}
                  status {listing.status}
                  {listing.moderationHiddenAt && " · HIDDEN BY A MODERATOR"}
                </div>
                <p style={{ fontSize: 15, fontWeight: 700 }}>{listing.title}</p>
                <p style={{ fontSize: 14, color: "#555", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  {listing.description}
                </p>
                <div style={label}>
                  Posted by {listing.user.name} ({listing.user.email}) on{" "}
                  {listing.createdAt.toLocaleString()}
                </div>
              </>
            ) : (
              <p style={{ fontSize: 13, color: "#999" }}>
                This listing no longer exists. The report survives it deliberately — see the
                other reports and the history below.
              </p>
            ))}

            {targetType === "user" && (subjectUser ? (
              <>
                <p style={{ fontSize: 15, fontWeight: 700 }}>
                  {subjectUser.name} <span style={{ color: "#999", fontWeight: 400 }}>({subjectUser.email})</span>
                </p>
                <div style={label}>
                  Joined {subjectUser.createdAt.toLocaleDateString()} · {subjectUser.totalTrades} trades ·
                  rating {subjectUser.rating.toFixed(1)} · {subjectUser._count.items} listings ·
                  role {subjectUser.role}
                  {suspensionState(subjectUser).suspended && " · SUSPENDED"}
                  {subjectUser.deletedAt && " · DELETED"}
                </div>
                {subjectUser.bio && (
                  <p style={{ fontSize: 14, color: "#555", lineHeight: 1.6 }}>{subjectUser.bio}</p>
                )}
              </>
            ) : (
              <p style={{ fontSize: 13, color: "#999" }}>That account no longer exists.</p>
            ))}

            {targetType === "message" && (message ? (
              <>
                <div style={label}>
                  {message.sender.name} → {message.receiver.name} ·{" "}
                  {message.createdAt.toLocaleString()}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 340, overflowY: "auto" }}>
                  {context.map((m) => {
                    const isReported = m.id === message.id
                    return (
                      <div
                        key={m.id}
                        style={{
                          fontSize: 13, padding: "8px 10px", borderRadius: 9, lineHeight: 1.5,
                          background: isReported ? "rgba(229,72,77,.1)" : "#f7f7f8",
                          border: isReported ? "1px solid rgba(229,72,77,.4)" : "1px solid transparent",
                        }}
                      >
                        <span style={{ color: "#999", fontSize: 11 }}>
                          {m.senderId === message.sender.id ? message.sender.name : message.receiver.name} ·{" "}
                          {m.createdAt.toLocaleString()}
                          {isReported && " · REPORTED"}
                        </span>
                        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.content}</div>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <p style={{ fontSize: 13, color: "#999" }}>That message no longer exists.</p>
            ))}
          </div>

          {/* ── Everything else about this target ── */}
          <div style={card}>
            <p style={{ fontSize: 15, fontWeight: 800 }}>
              Other reports about this target ({otherReports.length})
            </p>
            {otherReports.length === 0 ? (
              <p style={{ fontSize: 13, color: "#999" }}>None. This is the first.</p>
            ) : (
              otherReports.map((r) => (
                <div key={r.id} style={{ fontSize: 13, borderTop: "1px solid rgba(0,0,0,.06)", paddingTop: 8 }}>
                  <Link href={`/admin/reports/${r.id}`} style={{ color: "#4CAF50", fontWeight: 600 }}>
                    {CATEGORY_LABEL[toWireCategory(r.category)]}
                  </Link>{" "}
                  <span style={{ color: "#999" }}>
                    · {r.status} · {r.reporter.name} · {r.createdAt.toLocaleDateString()}
                  </span>
                  {r.notes && <div style={{ color: "#666", marginTop: 2 }}>{r.notes}</div>}
                </div>
              ))
            )}
          </div>

          <div style={card}>
            <p style={{ fontSize: 15, fontWeight: 800 }}>
              Moderation history for this target ({targetHistory.length})
            </p>
            {targetHistory.length === 0 ? (
              <p style={{ fontSize: 13, color: "#999" }}>Nothing has been done to it yet.</p>
            ) : (
              targetHistory.map((a) => (
                <div key={a.id} style={{ fontSize: 13, borderTop: "1px solid rgba(0,0,0,.06)", paddingTop: 8 }}>
                  <strong>{a.action}</strong>{" "}
                  <span style={{ color: "#999" }}>
                    · {a.actor.name} · {a.createdAt.toLocaleString()}
                  </span>
                  <div style={{ color: "#666", marginTop: 2 }}>{a.reason}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Sidebar: reporter, then actions ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <div style={card}>
            <p style={{ fontSize: 15, fontWeight: 800 }}>Reporter</p>
            <p style={{ fontSize: 14, fontWeight: 700 }}>{report.reporter.name}</p>
            <div style={label}>{report.reporter.email}</div>
            <div style={label}>
              Joined {report.reporter.createdAt.toLocaleDateString()} ·{" "}
              {report.reporter._count.reportsMade} reports filed
            </div>
            {/*
              A reporter whose reports are mostly dismissed is itself a signal,
              and one nothing else in this system would ever surface.
            */}
            <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
              {(repHistory.ACTIONED ?? 0)} upheld · {(repHistory.DISMISSED ?? 0)} dismissed ·{" "}
              {(repHistory.OPEN ?? 0) + (repHistory.REVIEWING ?? 0)} open
            </div>
          </div>

          <ModerationActions
            reportId={report.id}
            status={report.status}
            listing={listing ? { id: listing.id, title: listing.title, hidden: listing.moderationHiddenAt !== null } : null}
            subject={subject}
            canSuspend={me?.role === "ADMIN"}
          />
        </div>
      </div>
    </div>
  )
}
