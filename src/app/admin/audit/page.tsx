import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * /admin/audit — the moderation log, readable.
 *
 * An audit trail nobody can read is a table, not an audit trail. The point of
 * writing AdminAction rows is that somebody can afterwards ask "who suspended
 * this account, and what reason did they give" and get an answer without a
 * database prompt.
 *
 * There is no filter UI here yet and that is a deliberate stopping point rather
 * than an oversight: /api/admin/audit takes actorId, targetType and targetId,
 * the report detail page already shows the per-target slice inline, and a
 * hundred rows newest-first is the whole log on a platform this size. The
 * filters get a UI when there is enough here to need one.
 */

const th: React.CSSProperties = { padding: "10px 12px", textAlign: "left", color: "#888", fontSize: 12 }
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13, verticalAlign: "top" }

const ACTION_COLOR: Record<string, string> = {
  REPORT_REVIEWING: "#1d4ed8",
  REPORT_DISMISSED: "#6b7280",
  REPORT_ACTIONED: "#15803d",
  LISTING_HIDDEN: "#b91c1c",
  LISTING_UNHIDDEN: "#15803d",
  USER_SUSPENDED: "#b91c1c",
  USER_UNSUSPENDED: "#15803d",
}

export default async function AuditPage() {
  const actions = await prisma.adminAction.findMany({
    select: {
      id: true, action: true, targetType: true, targetId: true,
      reportId: true, reason: true, detail: true, createdAt: true,
      actor: { select: { name: true, email: true, role: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  })

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em" }}>Audit log</h1>
        <p style={{ fontSize: 13, color: "#777", marginTop: 4, maxWidth: "72ch", lineHeight: 1.6 }}>
          Every moderation action, with who did it and why. Rows are written inside the same
          transaction as the change they describe, and there is no route that edits or deletes
          one — a log with an edit button records what somebody was willing to admit to.
        </p>
      </div>

      {actions.length === 0 ? (
        <p style={{ fontSize: 14, color: "#888", padding: 32, textAlign: "center", background: "#fff", borderRadius: 14 }}>
          No moderation actions yet.
        </p>
      ) : (
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid rgba(0,0,0,.08)", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Who</th>
                <th style={th}>What</th>
                <th style={th}>Target</th>
                <th style={th}>Why</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => {
                // Stored as a JSON string. A malformed value renders as nothing
                // rather than throwing — one bad row must not take down the log.
                let detail: Record<string, unknown> | null = null
                try {
                  detail = a.detail ? (JSON.parse(a.detail) as Record<string, unknown>) : null
                } catch {
                  detail = null
                }
                return (
                  <tr key={a.id} style={{ borderTop: "1px solid rgba(0,0,0,.06)" }}>
                    <td style={{ ...td, whiteSpace: "nowrap", color: "#666" }}>
                      {a.createdAt.toLocaleString()}
                    </td>
                    <td style={td}>
                      {a.actor.name}
                      <div style={{ fontSize: 11, color: "#aaa" }}>{a.actor.role}</div>
                    </td>
                    <td style={{ ...td, color: ACTION_COLOR[a.action] ?? "#333", fontWeight: 700 }}>
                      {a.action}
                    </td>
                    <td style={td}>
                      {a.targetType}
                      <div style={{ fontSize: 11, color: "#aaa", fontFamily: "monospace" }}>
                        {a.targetId}
                      </div>
                      {detail?.title != null && (
                        <div style={{ fontSize: 11, color: "#888" }}>“{String(detail.title)}”</div>
                      )}
                      {detail?.email != null && (
                        <div style={{ fontSize: 11, color: "#888" }}>{String(detail.email)}</div>
                      )}
                    </td>
                    <td style={{ ...td, maxWidth: 320, color: "#555", lineHeight: 1.5 }}>
                      {a.reason}
                      {detail?.indefinite === true && (
                        <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 2 }}>indefinite</div>
                      )}
                      {typeof detail?.days === "number" && (
                        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{detail.days} days</div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
