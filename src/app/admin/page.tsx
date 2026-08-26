import Link from "next/link"
import prisma from "@/lib/prisma"
import {
  CATEGORY_LABEL,
  REPORT_CATEGORIES,
  REPORT_TARGET_TYPES,
  toDbCategory,
  toDbTarget,
  toWireCategory,
  toWireTarget,
  type ReportCategoryWire,
  type ReportTargetWire,
} from "@/lib/moderation"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * /admin — the report queue.
 *
 * Server-rendered and read directly from Prisma rather than through
 * /api/admin/reports. The layout above has already established that this
 * request comes from staff, and a server component fetching its own HTTP API
 * would be a second round trip to re-answer a question already answered.
 * The API exists for the client-side actions and for anything scripted.
 *
 * Filters live in the URL — ?status=OPEN&targetType=listing&category=harassment
 * — so a moderator can bookmark "open harassment reports" and send a colleague
 * a link to the exact list they are looking at.
 */

const STATUSES = ["OPEN", "REVIEWING", "ACTIONED", "DISMISSED"] as const

interface Props {
  searchParams: Promise<{ status?: string; targetType?: string; category?: string }>
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
    border: `1px solid ${active ? "#4CAF50" : "rgba(0,0,0,.14)"}`,
    background: active ? "rgba(76,175,80,.12)" : "#fff",
    color: active ? "#2e7d32" : "#555",
  }
}

const STATUS_COLOR: Record<string, string> = {
  OPEN: "#b45309",
  REVIEWING: "#1d4ed8",
  ACTIONED: "#15803d",
  DISMISSED: "#6b7280",
}

export default async function AdminQueuePage({ searchParams }: Props) {
  const sp = await searchParams

  // Unknown values are dropped rather than passed to Prisma as an enum. A
  // hand-edited URL is the normal way this page gets a bad parameter.
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as (typeof STATUSES)[number])
    : undefined
  const targetType = (REPORT_TARGET_TYPES as readonly string[]).includes(sp.targetType ?? "")
    ? (sp.targetType as ReportTargetWire)
    : undefined
  const category = (REPORT_CATEGORIES as readonly string[]).includes(sp.category ?? "")
    ? (sp.category as ReportCategoryWire)
    : undefined

  const where = {
    ...(status ? { status } : {}),
    ...(targetType ? { targetType: toDbTarget(targetType) } : {}),
    ...(category ? { category: toDbCategory(category) } : {}),
  }

  const [reports, counts] = await Promise.all([
    prisma.report.findMany({
      where,
      select: {
        id: true, targetType: true, targetId: true, category: true,
        notes: true, status: true, createdAt: true, resolvedAt: true,
        reporter: { select: { id: true, name: true } },
        resolvedBy: { select: { name: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
    prisma.report.groupBy({ by: ["status"], _count: { id: true } }),
  ])

  const countBy = Object.fromEntries(counts.map((c) => [c.status, c._count.id]))

  const href = (patch: Record<string, string | undefined>) => {
    const next = { status, targetType, category, ...patch }
    const qs = Object.entries(next)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join("&")
    return qs ? `/admin?${qs}` : "/admin"
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em" }}>Report queue</h1>
        <p style={{ fontSize: 13, color: "#777", marginTop: 4 }}>
          {countBy.OPEN ?? 0} open · {countBy.REVIEWING ?? 0} in review ·{" "}
          {countBy.ACTIONED ?? 0} actioned · {countBy.DISMISSED ?? 0} dismissed
        </p>
      </div>

      {/* Filters. All three compose; each chip toggles its own axis off. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#999", width: 64 }}>Status</span>
          <Link href={href({ status: undefined })} style={chipStyle(!status)}>All</Link>
          {STATUSES.map((s) => (
            <Link key={s} href={href({ status: status === s ? undefined : s })} style={chipStyle(status === s)}>
              {s} ({countBy[s] ?? 0})
            </Link>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#999", width: 64 }}>Type</span>
          <Link href={href({ targetType: undefined })} style={chipStyle(!targetType)}>All</Link>
          {REPORT_TARGET_TYPES.map((t) => (
            <Link key={t} href={href({ targetType: targetType === t ? undefined : t })} style={chipStyle(targetType === t)}>
              {t}
            </Link>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#999", width: 64 }}>Reason</span>
          <Link href={href({ category: undefined })} style={chipStyle(!category)}>All</Link>
          {REPORT_CATEGORIES.map((c) => (
            <Link key={c} href={href({ category: category === c ? undefined : c })} style={chipStyle(category === c)}>
              {CATEGORY_LABEL[c]}
            </Link>
          ))}
        </div>
      </div>

      {reports.length === 0 ? (
        <p style={{ fontSize: 14, color: "#888", padding: 32, textAlign: "center", background: "#fff", borderRadius: 14 }}>
          Nothing here.
        </p>
      ) : (
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid rgba(0,0,0,.08)", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 760 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#888", fontSize: 12 }}>
                <th style={{ padding: "12px 16px" }}>Filed</th>
                <th style={{ padding: "12px 16px" }}>Status</th>
                <th style={{ padding: "12px 16px" }}>Type</th>
                <th style={{ padding: "12px 16px" }}>Reason</th>
                <th style={{ padding: "12px 16px" }}>Reporter</th>
                <th style={{ padding: "12px 16px" }}>Notes</th>
                <th style={{ padding: "12px 16px" }} />
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid rgba(0,0,0,.06)" }}>
                  <td style={{ padding: "12px 16px", whiteSpace: "nowrap", color: "#666" }}>
                    {r.createdAt.toLocaleString()}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ color: STATUS_COLOR[r.status], fontWeight: 700 }}>{r.status}</span>
                    {r.resolvedBy && (
                      <div style={{ fontSize: 11, color: "#aaa" }}>by {r.resolvedBy.name}</div>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px" }}>{toWireTarget(r.targetType)}</td>
                  <td style={{ padding: "12px 16px" }}>
                    {CATEGORY_LABEL[toWireCategory(r.category)]}
                  </td>
                  <td style={{ padding: "12px 16px" }}>{r.reporter.name}</td>
                  <td style={{ padding: "12px 16px", maxWidth: 280, color: "#666" }}>
                    {r.notes ? (r.notes.length > 90 ? `${r.notes.slice(0, 90)}…` : r.notes) : "—"}
                  </td>
                  <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
                    <Link href={`/admin/reports/${r.id}`} style={{ color: "#4CAF50", fontWeight: 600 }}>
                      Review →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
