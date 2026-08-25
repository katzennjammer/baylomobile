"use client"

import React from "react"

const STAR_PATH = "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L4.5 9.7l5.9-.9L12 3.5Z"

function StarBtn({
  index, hovered, selected, onHover, onClick,
}: {
  index:    number
  hovered:  number
  selected: number
  onHover:  (i: number) => void
  onClick:  (i: number) => void
}) {
  const active = index <= (hovered || selected)
  return (
    <button
      type="button"
      onClick={() => onClick(index)}
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(0)}
      aria-label={`${index} star${index !== 1 ? "s" : ""}`}
      style={{
        background: "none", border: "none", padding: "2px 3px",
        cursor: "pointer", color: active ? "#9A6208" : "#D1D5DB",
        display: "flex", alignItems: "center",
        transition: "color .1s, transform .1s",
        transform: active ? "scale(1.12)" : "scale(1)",
      }}
    >
      <svg width={32} height={32} viewBox="0 0 24 24"
           fill={active ? "currentColor" : "none"}
           stroke="currentColor" strokeWidth={1.6}
           strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={STAR_PATH} />
      </svg>
    </button>
  )
}

const LABELS: Record<number, string> = {
  1: "Poor",
  2: "Fair",
  3: "Good",
  4: "Great",
  5: "Excellent",
}

interface RateTradeModalProps {
  tradeId:      string
  partnerName:  string
  onRated:      (tradeId: string, stars: number) => void
  onClose:      () => void
}

export default function RateTradeModal({ tradeId, partnerName, onRated, onClose }: RateTradeModalProps) {
  const [hovered,  setHovered]  = React.useState(0)
  const [selected, setSelected] = React.useState(0)
  const [comment,  setComment]  = React.useState("")
  const [loading,  setLoading]  = React.useState(false)
  const [error,    setError]    = React.useState<string | null>(null)

  async function handleSubmit() {
    if (selected === 0) { setError("Please select a star rating."); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId, stars: selected, comment: comment.trim() || undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? "Something went wrong")
      }
      onRated(tradeId, selected)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 1040,
          background: "rgba(0,0,0,0.38)", backdropFilter: "blur(3px)",
        }}
      />

      {/* Modal */}
      <div style={{
        position: "fixed", top: "50%", left: "50%", zIndex: 1050,
        transform: "translate(-50%,-50%)",
        background: "#FDFAF6", borderRadius: 20, padding: "32px 28px 28px",
        width: 400, maxWidth: "calc(100vw - 32px)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.2)",
        display: "flex", flexDirection: "column", gap: 20,
      }}>

        {/* Header */}
        <div>
          <p style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 800, color: "#1A1A1A" }}>
            Rate your trade
          </p>
          <p style={{ margin: 0, fontSize: 14, color: "#6B7280" }}>
            How was trading with <strong style={{ color: "#1A1A1A" }}>{partnerName}</strong>?
          </p>
        </div>

        {/* Star picker */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", gap: 4 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <StarBtn
                key={i}
                index={i}
                hovered={hovered}
                selected={selected}
                onHover={setHovered}
                onClick={setSelected}
              />
            ))}
          </div>
          <p style={{
            margin: 0, fontSize: 13, fontWeight: 700, height: 18,
            color: selected ? "#9A6208" : "#9CA3AF",
            transition: "color .15s",
          }}>
            {selected ? LABELS[selected] : hovered ? LABELS[hovered] : ""}
          </p>
        </div>

        {/* Comment */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
            Comment <span style={{ fontWeight: 400, color: "#9CA3AF" }}>(optional)</span>
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Describe your experience..."
            maxLength={400}
            rows={3}
            style={{
              resize: "none", width: "100%", boxSizing: "border-box",
              padding: "10px 12px", borderRadius: 12, fontSize: 14,
              border: "1.5px solid #E5E7EB", fontFamily: "inherit",
              color: "#1A1A1A", background: "#fff", outline: "none",
              transition: "border-color .15s",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#3C7143")}
            onBlur={(e)  => (e.currentTarget.style.borderColor = "#E5E7EB")}
          />
          <p style={{ margin: 0, fontSize: 11, color: "#9CA3AF", textAlign: "right" }}>
            {comment.length}/400
          </p>
        </div>

        {error && (
          <p style={{ margin: 0, fontSize: 13, color: "#A01818", fontWeight: 600 }}>{error}</p>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              flex: 1, padding: "11px 0", borderRadius: 12,
              border: "1.5px solid rgba(45,47,34,.15)", background: "transparent",
              color: "#555", fontSize: 14, fontWeight: 600, fontFamily: "inherit",
              cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.5 : 1,
              transition: "background .12s",
            }}
            onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = "rgba(0,0,0,.04)" }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
          >
            Skip
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || selected === 0}
            style={{
              flex: 2, padding: "11px 0", borderRadius: 12,
              border: "none", background: selected > 0 ? "#3C7143" : "#D1D5DB",
              color: "#fff", fontSize: 14, fontWeight: 700, fontFamily: "inherit",
              cursor: loading || selected === 0 ? "not-allowed" : "pointer",
              transition: "background .15s, filter .12s",
            }}
            onMouseEnter={(e) => { if (!loading && selected > 0) e.currentTarget.style.filter = "brightness(1.08)" }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = "" }}
          >
            {loading ? "Submitting…" : "Submit review"}
          </button>
        </div>
      </div>
    </>
  )
}
