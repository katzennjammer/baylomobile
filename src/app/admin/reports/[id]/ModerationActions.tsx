"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import toast from "react-hot-toast"

/**
 * The action panel on a report.
 *
 * EVERY BUTTON HERE REQUIRES A TYPED REASON, and the submit is disabled until
 * one exists. That is not politeness: the reason is the audit row, and the
 * routes reject an empty one with a 400 regardless of what this component does.
 * Making it impossible to click without a reason is what stops a moderator
 * discovering the requirement as an error after they have already decided.
 *
 * The same `reason` text is used for both the audit row and, for a resolution,
 * the sentence the reporter reads. One field for both so the record and the
 * explanation cannot diverge.
 */

interface Props {
  reportId: string
  status: string
  /** Present when the report is about a listing. */
  listing?: { id: string; title: string; hidden: boolean } | null
  /** The person behind the reported content, when there is one. */
  subject?: { id: string; name: string; suspended: boolean } | null
  /** Only an ADMIN may suspend; a MODERATOR sees the button disabled. */
  canSuspend: boolean
}

const btn: React.CSSProperties = {
  padding: "9px 14px", borderRadius: 9, fontSize: 13, fontWeight: 700,
  border: "1px solid rgba(0,0,0,.14)", background: "#fff", color: "#333",
  cursor: "pointer",
}
const solid: React.CSSProperties = { ...btn, background: "#4CAF50", color: "#1A3520", border: 0 }
const danger: React.CSSProperties = { ...btn, background: "#e5484d", color: "#fff", border: 0 }

export default function ModerationActions({ reportId, status, listing, subject, canSuspend }: Props) {
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [days, setDays] = useState<string>("")
  const [busy, setBusy] = useState(false)

  const resolved = status === "ACTIONED" || status === "DISMISSED"

  async function call(url: string, body: Record<string, unknown>, okMsg: string) {
    if (!reason.trim()) {
      toast.error("A reason is required — it goes in the audit log.")
      return
    }
    setBusy(true)
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = await res.json()
      if (res.ok) {
        toast.success(okMsg)
        setReason("")
        router.refresh()
      } else {
        toast.error(payload?.error?.message ?? "That did not work.")
      }
    } catch {
      toast.error("That did not work.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      background: "#fff", borderRadius: 14, border: "1px solid rgba(0,0,0,.08)",
      padding: 20, display: "flex", flexDirection: "column", gap: 14,
    }}>
      <div>
        <p style={{ fontSize: 15, fontWeight: 800 }}>Actions</p>
        <p style={{ fontSize: 12, color: "#888", marginTop: 3 }}>
          Every action below writes an audit row naming you, the time and this reason.
        </p>
      </div>

      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={1000}
        placeholder="Why? The reporter reads this too."
        style={{
          padding: "10px 12px", borderRadius: 10, fontSize: 13, minHeight: 80,
          border: "1.5px solid rgba(0,0,0,.15)", resize: "vertical",
          fontFamily: "inherit", background: "#fff", color: "#111",
        }}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!resolved && status !== "REVIEWING" && (
          <button
            type="button"
            style={btn}
            disabled={busy || !reason.trim()}
            onClick={() => call(`/api/admin/reports/${reportId}/resolve`, { action: "reviewing", note: reason }, "Claimed.")}
          >
            Claim (reviewing)
          </button>
        )}

        {listing && (
          <button
            type="button"
            style={listing.hidden ? btn : danger}
            disabled={busy || !reason.trim()}
            onClick={() =>
              call(
                `/api/admin/listings/${listing.id}`,
                { action: listing.hidden ? "unhide" : "hide", reason, reportId },
                listing.hidden ? "Listing restored." : "Listing hidden.",
              )
            }
          >
            {listing.hidden ? "Restore listing" : "Hide listing"}
          </button>
        )}

        {subject && (
          <>
            {!subject.suspended && (
              <input
                type="number"
                min={1}
                max={3650}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                placeholder="days (blank = indefinite)"
                style={{
                  padding: "9px 12px", borderRadius: 9, fontSize: 13, width: 200,
                  border: "1.5px solid rgba(0,0,0,.15)", background: "#fff", color: "#111",
                }}
              />
            )}
            <button
              type="button"
              style={subject.suspended ? btn : danger}
              disabled={busy || !reason.trim() || !canSuspend}
              title={canSuspend ? undefined : "Suspension requires an ADMIN role"}
              onClick={() =>
                call(
                  `/api/admin/users/${subject.id}`,
                  subject.suspended
                    ? { action: "unsuspend", reason, reportId }
                    : {
                        action: "suspend",
                        reason,
                        reportId,
                        // Blank means indefinite. Sent as an absent field rather
                        // than a default, matching the route: a default here
                        // would quietly turn every suspension into a holiday.
                        ...(days.trim() ? { days: Number(days) } : {}),
                      },
                  subject.suspended ? "Account restored." : "Account suspended.",
                )
              }
            >
              {subject.suspended ? "Unsuspend account" : "Suspend account"}
            </button>
          </>
        )}
      </div>

      {!resolved && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px solid rgba(0,0,0,.07)", paddingTop: 14 }}>
          <button
            type="button"
            style={solid}
            disabled={busy || !reason.trim()}
            onClick={() => call(`/api/admin/reports/${reportId}/resolve`, { action: "actioned", note: reason }, "Marked actioned. Reporter notified.")}
          >
            Mark actioned
          </button>
          <button
            type="button"
            style={btn}
            disabled={busy || !reason.trim()}
            onClick={() => call(`/api/admin/reports/${reportId}/resolve`, { action: "dismissed", note: reason }, "Dismissed. Reporter notified.")}
          >
            Dismiss
          </button>
          <span style={{ fontSize: 12, color: "#999", alignSelf: "center" }}>
            Either one notifies the reporter and closes the report.
          </span>
        </div>
      )}

      {resolved && (
        <p style={{ fontSize: 13, color: "#666", borderTop: "1px solid rgba(0,0,0,.07)", paddingTop: 14 }}>
          This report is {status.toLowerCase()} and the reporter has been told. Hiding a listing
          or suspending an account is still possible above — those are separate acts with their
          own audit rows.
        </p>
      )}
    </div>
  )
}
