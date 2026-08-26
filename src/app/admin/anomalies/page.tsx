import prisma from "@/lib/prisma"
import { NEW_PARTNER_WINDOW_DAYS } from "@/lib/task-constants"
import { suspensionState } from "@/lib/moderation"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * /admin/anomalies — the two signals this system already produces and has never
 * shown anyone.
 *
 * Both have been written to the database for weeks with no surface, which means
 * neither has ever been read, which means the work of detecting them has so far
 * bought nothing. See the route at /api/admin/anomalies for the full note; the
 * short version:
 *
 *   DPA DEFAULTS       DeferredContract.defaultedAt, stamped by the deadline
 *                      sweep and never cleared even when the debt is later paid.
 *                      `Still owing` is what separates the two cases.
 *   REPEAT PAIRS       VERIFIED_SWAP task completions worth 0 Leaves — the
 *                      faucet guard refusing a partner already traded with
 *                      inside the window. Not misconduct on its own; a signal
 *                      at volume.
 *
 * READ-ONLY BY DESIGN. There is no button on this page. A moderator who wants
 * to act does it through the report queue or the user route, where an audit row
 * gets written — an action taken from a dashboard with no report behind it and
 * no reason typed is exactly the unaccountable moderation the audit log exists
 * to prevent.
 */

const MIN_REPEATS = 3

interface PairRow {
  userId: string
  partnerId: string
  zeroSwaps: bigint | number
  lastAt: Date
}

const card: React.CSSProperties = {
  background: "#fff", borderRadius: 14, border: "1px solid rgba(0,0,0,.08)",
  padding: 20, display: "flex", flexDirection: "column", gap: 12,
}
const th: React.CSSProperties = { padding: "10px 12px", textAlign: "left", color: "#888", fontSize: 12 }
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13 }

export default async function AnomaliesPage() {
  const [defaults, pairs] = await Promise.all([
    prisma.deferredContract.findMany({
      where: { defaultedAt: { not: null } },
      select: {
        id: true, status: true, amountLeaves: true, amountPaidLeaves: true,
        deadline: true, defaultedAt: true, fulfilledAt: true, tradeId: true,
        debtor: { select: { id: true, name: true, email: true, suspendedAt: true, suspendedUntil: true } },
        creditor: { select: { name: true } },
      },
      orderBy: { defaultedAt: "desc" },
      take: 100,
    }),
    // Raw SQL for the same reason /messages/conversations uses it: a GROUP BY
    // over a derived pair key with a HAVING on the aggregate has no Prisma
    // expression. Fully parameterised.
    prisma.$queryRaw<PairRow[]>`
      SELECT
        tc.userId AS userId,
        CASE WHEN tr.senderId = tc.userId THEN tr.receiverId ELSE tr.senderId END AS partnerId,
        COUNT(*)          AS zeroSwaps,
        MAX(tc.createdAt) AS lastAt
      FROM TaskCompletion tc
      JOIN TradeRequest tr ON tr.id = tc.refId
      WHERE tc.task = 'VERIFIED_SWAP'
        AND tc.leaves = 0
      GROUP BY userId, partnerId
      HAVING COUNT(*) >= ${MIN_REPEATS}
      ORDER BY zeroSwaps DESC, lastAt DESC
      LIMIT 100
    `,
  ])

  const ids = [...new Set(pairs.flatMap((p) => [p.userId, p.partnerId]))]
  const people = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true, createdAt: true },
      })
    : []
  const byId = new Map(people.map((p) => [p.id, p]))

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-.02em" }}>Anomalies</h1>
        <p style={{ fontSize: 13, color: "#777", marginTop: 4, maxWidth: "70ch", lineHeight: 1.6 }}>
          Signals the system already records. Neither is misconduct on its own — both are
          worth a human&apos;s eye. Acting on one means opening the relevant report or user,
          so that an audit row gets written with a reason.
        </p>
      </div>

      <div style={card}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 800 }}>Deferred agreement defaults ({defaults.length})</p>
          <p style={{ fontSize: 12, color: "#888", marginTop: 3, lineHeight: 1.55 }}>
            Every contract that has ever missed its deadline. The default mark is never
            cleared, not even when the debt is paid afterwards — paying late settles the
            debt, not the record. <strong>Still owing</strong> is what separates the two.
          </p>
        </div>

        {defaults.length === 0 ? (
          <p style={{ fontSize: 13, color: "#999" }}>No defaults recorded.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
              <thead>
                <tr>
                  <th style={th}>Debtor</th>
                  <th style={th}>Creditor</th>
                  <th style={th}>Principal</th>
                  <th style={th}>Paid</th>
                  <th style={th}>Still owing</th>
                  <th style={th}>Deadline</th>
                  <th style={th}>Defaulted</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {defaults.map((c) => {
                  const owing = c.amountLeaves - c.amountPaidLeaves
                  return (
                    <tr key={c.id} style={{ borderTop: "1px solid rgba(0,0,0,.06)" }}>
                      <td style={td}>
                        {c.debtor.name}
                        <div style={{ fontSize: 11, color: "#aaa" }}>
                          {c.debtor.email}
                          {suspensionState(c.debtor).suspended && " · SUSPENDED"}
                        </div>
                      </td>
                      <td style={td}>{c.creditor.name}</td>
                      <td style={td}>{c.amountLeaves}</td>
                      <td style={td}>{c.amountPaidLeaves}</td>
                      <td style={{ ...td, fontWeight: 700, color: owing > 0 ? "#b91c1c" : "#15803d" }}>
                        {owing}
                      </td>
                      <td style={td}>{c.deadline.toLocaleDateString()}</td>
                      <td style={td}>{c.defaultedAt?.toLocaleDateString()}</td>
                      <td style={td}>{c.status}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={card}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 800 }}>Repeat trade pairs ({pairs.length})</p>
          <p style={{ fontSize: 12, color: "#888", marginTop: 3, lineHeight: 1.55, maxWidth: "80ch" }}>
            Pairs with {MIN_REPEATS} or more verified swaps that awarded <strong>0 Leaves</strong> —
            the faucet guard refusing a partner already traded with inside{" "}
            {NEW_PARTNER_WINDOW_DAYS} days. Friends genuinely do trade repeatedly, so a few
            of these mean nothing. A pair with a dozen is the shape of two accounts run by
            one person, and nothing else in the system would ever mention it.
          </p>
        </div>

        {pairs.length === 0 ? (
          <p style={{ fontSize: 13, color: "#999" }}>
            No pair has hit {MIN_REPEATS} zero-award swaps.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
              <thead>
                <tr>
                  <th style={th}>User</th>
                  <th style={th}>Partner</th>
                  <th style={th}>Zero-award swaps</th>
                  <th style={th}>Most recent</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => {
                  const u = byId.get(p.userId)
                  const q = byId.get(p.partnerId)
                  return (
                    <tr key={`${p.userId}-${p.partnerId}`} style={{ borderTop: "1px solid rgba(0,0,0,.06)" }}>
                      <td style={td}>
                        {u?.name ?? p.userId}
                        <div style={{ fontSize: 11, color: "#aaa" }}>{u?.email}</div>
                      </td>
                      <td style={td}>
                        {q?.name ?? p.partnerId}
                        <div style={{ fontSize: 11, color: "#aaa" }}>{q?.email}</div>
                      </td>
                      <td style={{ ...td, fontWeight: 700 }}>{Number(p.zeroSwaps)}</td>
                      <td style={td}>{new Date(p.lastAt).toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
