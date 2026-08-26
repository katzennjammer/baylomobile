"use client"

import { useState } from "react"
import toast from "react-hot-toast"

/**
 * The report and block controls, as one component.
 *
 * ONE COMPONENT FOR ALL THREE SURFACES — a listing, a profile, a message thread
 * — because they are the same two actions with a different target, and three
 * copies is how a category ends up missing from one of them. The target is a
 * (type, id) pair, exactly as the API takes it.
 *
 * Blocking is offered only where there is a person to block. On a listing that
 * means the OWNER, which is why `blockUser` is separate from `target`: you
 * report the listing, but you block the human who posted it.
 *
 * NOTHING HERE IS A SECURITY CONTROL. Every rule this UI expresses — no
 * self-report, one live report per target, the rate limit — is enforced again
 * in the route against the database. Hiding the button on your own listing is a
 * courtesy; the server refuses it either way.
 */

const CATEGORIES = [
  { value: "spam", label: "Spam or misleading" },
  { value: "prohibited_item", label: "Prohibited item" },
  { value: "scam_or_fraud", label: "Scam or fraud" },
  { value: "harassment", label: "Harassment or abuse" },
  { value: "counterfeit", label: "Counterfeit goods" },
  { value: "other", label: "Something else" },
] as const

const MAX_NOTES = 2000

export type ReportTarget = "listing" | "user" | "message"

interface Props {
  /** What is being reported. */
  target: { type: ReportTarget; id: string }
  /** The person behind it, when there is one to block. Omit to hide blocking. */
  blockUser?: { id: string; name: string } | null
  /** Hidden entirely when the viewer is the owner — see the note above. */
  hidden?: boolean
  /** Called after a successful block, so the page can navigate away. */
  onBlocked?: () => void
  className?: string
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 16, zIndex: 1000,
}
const sheet: React.CSSProperties = {
  background: "#fff", borderRadius: 18, padding: 24, width: "100%", maxWidth: 460,
  display: "flex", flexDirection: "column", gap: 16, color: "#111",
  maxHeight: "90vh", overflowY: "auto",
}
const primaryBtn: React.CSSProperties = {
  padding: "11px 18px", borderRadius: 10, border: 0, fontWeight: 700, fontSize: 14,
  background: "#4CAF50", color: "#1A3520", cursor: "pointer",
}
const dangerBtn: React.CSSProperties = { ...primaryBtn, background: "#e5484d", color: "#fff" }
const ghostBtn: React.CSSProperties = {
  ...primaryBtn, background: "transparent", color: "#666",
  border: "1px solid rgba(0,0,0,.15)",
}

export default function ReportBlockMenu({
  target,
  blockUser,
  hidden = false,
  onBlocked,
  className,
}: Props) {
  const [mode, setMode] = useState<null | "report" | "block">(null)
  const [category, setCategory] = useState<string>("")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)

  if (hidden) return null

  async function submitReport() {
    if (!category) {
      toast.error("Pick a reason")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/v1/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: target.type,
          targetId: target.id,
          category,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      })
      const body = await res.json()
      if (res.ok) {
        // The exact promise /trust makes, said back at the moment it is made.
        toast.success("Report received. A moderator will review it and let you know.")
        setMode(null)
        setCategory("")
        setNotes("")
      } else if (res.status === 409) {
        // Not an error the user caused — they already did the right thing.
        toast("You have already reported this. We are still reviewing it.")
        setMode(null)
      } else {
        toast.error(body?.error?.message ?? "Could not send that report.")
      }
    } catch {
      toast.error("Could not send that report.")
    } finally {
      setBusy(false)
    }
  }

  async function submitBlock() {
    if (!blockUser) return
    setBusy(true)
    try {
      const res = await fetch("/api/v1/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: blockUser.id }),
      })
      const body = await res.json()
      if (res.ok) {
        // The consequences the server computed, shown rather than assumed.
        const note = body?.data?.effects?.note
        toast.success(`${blockUser.name} is blocked.`)
        if (note) toast(note, { duration: 8000 })
        setMode(null)
        onBlocked?.()
      } else {
        toast.error(body?.error?.message ?? "Could not block that person.")
      }
    } catch {
      toast.error("Could not block that person.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={className} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setMode("report")} style={ghostBtn}>
          Report
        </button>
        {blockUser && (
          <button type="button" onClick={() => setMode("block")} style={ghostBtn}>
            Block
          </button>
        )}
      </div>

      {mode === "report" && (
        <div style={overlay} onClick={() => !busy && setMode(null)}>
          <div style={sheet} onClick={(e) => e.stopPropagation()}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
                Report this {target.type}
              </h2>
              <p style={{ fontSize: 13, color: "#666", lineHeight: 1.5 }}>
                A human reviews every report. We will tell you what we decided.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {CATEGORIES.map((c) => (
                <label
                  key={c.value}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 12px", borderRadius: 10, fontSize: 14, cursor: "pointer",
                    border: `1.5px solid ${category === c.value ? "#4CAF50" : "rgba(0,0,0,.12)"}`,
                    background: category === c.value ? "rgba(76,175,80,.08)" : "transparent",
                  }}
                >
                  <input
                    type="radio"
                    name="report-category"
                    value={c.value}
                    checked={category === c.value}
                    onChange={() => setCategory(c.value)}
                  />
                  {c.label}
                </label>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>
                What happened? (optional)
              </label>
              <textarea
                value={notes}
                maxLength={MAX_NOTES}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything that would help a moderator understand."
                style={{
                  padding: "10px 14px", borderRadius: 10, fontSize: 14, minHeight: 90,
                  border: "1.5px solid rgba(0,0,0,.15)", resize: "vertical",
                  fontFamily: "inherit", background: "#fff", color: "#111",
                }}
              />
              <span style={{ fontSize: 11, color: "#aaa", alignSelf: "flex-end" }}>
                {notes.length} / {MAX_NOTES}
              </span>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setMode(null)} disabled={busy} style={ghostBtn}>
                Cancel
              </button>
              <button type="button" onClick={submitReport} disabled={busy || !category} style={primaryBtn}>
                {busy ? "Sending…" : "Send report"}
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === "block" && blockUser && (
        <div style={overlay} onClick={() => !busy && setMode(null)}>
          <div style={sheet} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 800 }}>Block {blockUser.name}?</h2>

            <ul style={{ fontSize: 14, color: "#444", lineHeight: 1.7, paddingLeft: 18 }}>
              <li>You will not see each other&apos;s listings</li>
              <li>Neither of you can message the other</li>
              <li>Neither of you can start a new trade or offer</li>
              <li>Your existing conversation is hidden, not deleted</li>
            </ul>

            {/*
              Said before the click, not after. Someone blocking a creditor
              needs to know the debt survives BEFORE they assume otherwise, and
              someone mid-trade needs to know the trade is still on. The server
              returns the specific trades and contracts; this is the rule.
            */}
            <p style={{
              fontSize: 13, color: "#8a6d3b", background: "rgba(240,173,78,.12)",
              border: "1px solid rgba(240,173,78,.3)", borderRadius: 10,
              padding: "10px 12px", lineHeight: 1.55,
            }}>
              Blocking does not cancel a trade already in progress, and it does not clear a
              deferred agreement between you. Those stand. You can cancel a trade yourself
              from your trades list.
            </p>

            <p style={{ fontSize: 12, color: "#888" }}>
              You can unblock from Settings at any time.
            </p>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setMode(null)} disabled={busy} style={ghostBtn}>
                Cancel
              </button>
              <button type="button" onClick={submitBlock} disabled={busy} style={dangerBtn}>
                {busy ? "Blocking…" : "Block"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
