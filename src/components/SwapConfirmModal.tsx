"use client"

import { useState, useEffect, useRef, useCallback } from "react"

export interface SwapConfirmModalProps {
  tradeId:              string
  offeredItemTitle:     string
  requestedItemTitle:   string
  sender:               { id: string; name: string }
  receiver:             { id: string; name: string }
  myId:                 string
  onClose:              () => void
  onCompleted:          () => void
}

type Phase =
  | "starting"       // POSTing /confirm/start
  | "entering"       // showing 6-digit input
  | "submitting"     // POSTing /confirm/submit
  | "waiting"        // my code correct; polling for partner
  | "completed"      // both verified
  | "error"          // unrecoverable error

export default function SwapConfirmModal({
  tradeId, offeredItemTitle, requestedItemTitle,
  sender, receiver, myId, onClose, onCompleted,
}: SwapConfirmModalProps) {
  const isSender    = myId === sender.id
  const partnerName = isSender ? receiver.name : sender.name

  const [phase,   setPhase]   = useState<Phase>("starting")
  const [code,    setCode]    = useState("")
  const [safeZone, setSafeZone] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  // ── Start: generate codes and email both users ────────────────────────────
  // The endpoint is idempotent (valid existing codes are reused, not re-sent),
  // so transient failures (5xx / network) are retried automatically with
  // backoff before surfacing an error to the user.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const startConfirmation = useCallback(async () => {
    setPhase("starting")
    setErrorMsg("")
    const delaysMs = [0, 1200, 3000]
    let lastError = "Failed to generate codes — please try again"
    for (const delay of delaysMs) {
      if (delay) await new Promise((r) => setTimeout(r, delay))
      if (!aliveRef.current) return
      try {
        const res  = await fetch(`/api/trades/${tradeId}/confirm/start`, { method: "POST" })
        const data = await res.json() as { started?: boolean; alreadyStarted?: boolean; error?: string }
        if (!aliveRef.current) return
        if (res.ok && data.started) {
          // If already started (codes still valid), skip to entering immediately
          setPhase("entering")
          setTimeout(() => inputRef.current?.focus(), 50)
          return
        }
        if (res.status < 500) {
          // Client error (trade not ready, forbidden, …) — retrying won't help
          setErrorMsg(data.error ?? lastError)
          setPhase("error")
          return
        }
        lastError = data.error ?? lastError
      } catch {
        lastError = "Network error — please try again"
      }
    }
    if (!aliveRef.current) return
    setErrorMsg(lastError)
    setPhase("error")
  }, [tradeId])

  useEffect(() => {
    startConfirmation()
  // Only run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeId])

  // ── Poll /status while waiting for partner ────────────────────────────────
  const checkStatus = useCallback(async () => {
    try {
      const res  = await fetch(`/api/trades/${tradeId}/confirm/status`)
      const data = await res.json() as { completed?: boolean; senderSubmitted?: boolean; receiverSubmitted?: boolean }
      if (data.completed) {
        stopPoll()
        setPhase("completed")
        setTimeout(onCompleted, 1500)
      }
    } catch { /* silent — keep polling */ }
  }, [tradeId, stopPoll, onCompleted])

  useEffect(() => {
    if (phase === "waiting") {
      pollRef.current = setInterval(checkStatus, 4000)
      return stopPoll
    }
  }, [phase, checkStatus, stopPoll])

  useEffect(() => () => stopPoll(), [stopPoll])

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (phase !== "entering" || code.trim().length !== 6) return
    setPhase("submitting")
    setErrorMsg("")
    try {
      const res  = await fetch(`/api/trades/${tradeId}/confirm/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), safeZone }),
      })
      const data = await res.json() as { correct?: boolean; completed?: boolean; error?: string }
      if (!res.ok || data.error) {
        setErrorMsg(data.error ?? "Something went wrong — please try again")
        setPhase("entering")
        setTimeout(() => inputRef.current?.focus(), 50)
        return
      }
      if (data.completed) {
        stopPoll()
        setPhase("completed")
        setTimeout(onCompleted, 1500)
      } else {
        setPhase("waiting")
      }
    } catch {
      setErrorMsg("Network error — please try again")
      setPhase("entering")
    }
  }

  // Dismiss on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1300,      // above chat dock (~1000) and all page content
        backdropFilter: "blur(2px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 18,
          padding: "32px 28px 28px",
          maxWidth: 420, width: "92%",
          boxShadow: "0 24px 60px rgba(0,0,0,0.22)",
          display: "flex", flexDirection: "column", gap: 18,
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 16, right: 16,
            background: "none", border: "none", cursor: "pointer",
            color: "#9a9d92", fontSize: 20, lineHeight: 1, padding: 4,
          }}
          aria-label="Close"
        >
          ✕
        </button>

        {/* Header */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#4CAF50", marginBottom: 6 }}>
            In-person swap
          </div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#161a12" }}>
            Confirm Swap
          </h2>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#6b7280" }}>
            <strong>{offeredItemTitle}</strong> ↔ <strong>{requestedItemTitle}</strong>
          </p>
        </div>

        {/* Phase content */}
        {phase === "starting" && (
          <div style={{ textAlign: "center", padding: "8px 0 4px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            <div style={{ position: "relative", width: 72, height: 72 }}>
              {/* Pulsing ring */}
              <span style={{
                position: "absolute", inset: 0,
                borderRadius: "50%",
                background: "rgba(76,175,80,0.12)",
                animation: "scmPulse 1.4s ease-in-out infinite",
              }} />
              {/* Envelope circle */}
              <div style={{
                position: "relative",
                width: 72, height: 72,
                borderRadius: "50%",
                background: "#f0fdf4",
                border: "2px solid #bbf7d0",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width={34} height={34} viewBox="0 0 24 24" fill="none"
                  stroke="#3C7143" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
                  style={{ animation: "scmBob 1.6s ease-in-out infinite" }}
                >
                  <rect x="2" y="4" width="20" height="16" rx="3" />
                  <path d="m2 7 10 6 10-6" />
                </svg>
              </div>
              {/* Floating dots */}
              {[0, 1, 2].map(i => (
                <span key={i} style={{
                  position: "absolute",
                  width: 6, height: 6,
                  borderRadius: "50%",
                  background: "#4CAF50",
                  top: "50%",
                  left: "50%",
                  opacity: 0,
                  animation: `scmDot 1.4s ease-out ${i * 0.28}s infinite`,
                  transform: "translate(-50%, -50%)",
                }} />
              ))}
            </div>

            <div>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#161a12" }}>
                Sending verification codes
              </p>
              <p style={{ margin: "5px 0 0", fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>
                A 6-digit code is being emailed<br />to you and <strong>{partnerName}</strong>.
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#9ca3af" }}>
              <Spinner size={13} />
              <span>Please wait…</span>
            </div>

            <style>{`
              @keyframes scmPulse{0%,100%{transform:scale(1);opacity:.6}50%{transform:scale(1.18);opacity:0}}
              @keyframes scmBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
              @keyframes scmDot{0%{transform:translate(-50%,-50%) scale(1);opacity:.9}100%{transform:translate(-50%,-50%) scale(3.5);opacity:0}}
            `}</style>
          </div>
        )}

        {(phase === "entering" || phase === "submitting") && (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{
              background: "#f0fdf4", border: "1.5px solid #bbf7d0",
              borderRadius: 12, padding: "14px 16px", fontSize: 13, color: "#166534",
              lineHeight: 1.6,
            }}>
              <strong>Check your email</strong> — you received a 6-digit code.<br />
              When you&rsquo;re with {partnerName}, read your code to them. Then enter <strong>the code from {partnerName}&rsquo;s email</strong> below.
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6, letterSpacing: 0.5 }}>
                Enter the code from {partnerName}&rsquo;s email
              </label>
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                disabled={phase === "submitting"}
                style={{
                  width: "100%", boxSizing: "border-box",
                  border: errorMsg ? "2px solid #ef4444" : "2px solid #d1d5db",
                  borderRadius: 10, padding: "12px 14px",
                  fontSize: 24, fontWeight: 700, letterSpacing: 8,
                  textAlign: "center", color: "#161a12",
                  fontFamily: "'Courier New', monospace",
                  outline: "none",
                  background: phase === "submitting" ? "#f9fafb" : "#ffffff",
                  transition: "border-color .15s",
                }}
                onFocus={(e) => { if (!errorMsg) e.currentTarget.style.borderColor = "#4CAF50" }}
                onBlur={(e)  => { if (!errorMsg) e.currentTarget.style.borderColor = "#d1d5db" }}
                autoComplete="off"
              />
              {errorMsg && (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "#ef4444", fontWeight: 600 }}>
                  {errorMsg}
                </p>
              )}
            </div>

            <label style={{
              display: "flex", alignItems: "center", gap: 9,
              fontSize: 13, color: "#374151", cursor: "pointer", userSelect: "none",
            }}>
              <input
                type="checkbox"
                checked={safeZone}
                onChange={(e) => setSafeZone(e.target.checked)}
                disabled={phase === "submitting"}
                style={{ width: 16, height: 16, accentColor: "#3C7143", cursor: "pointer" }}
              />
              We met at a Safe Zone (public, well-lit meetup spot)
            </label>

            <button
              type="submit"
              disabled={code.length !== 6 || phase === "submitting"}
              style={{
                padding: "13px 0",
                background: code.length === 6 && phase !== "submitting" ? "#3C7143" : "#d1d5db",
                color: code.length === 6 && phase !== "submitting" ? "#ffffff" : "#9ca3af",
                border: "none", borderRadius: 10,
                fontSize: 15, fontWeight: 700, cursor: code.length === 6 && phase !== "submitting" ? "pointer" : "not-allowed",
                fontFamily: "inherit", transition: "background .15s",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {phase === "submitting" ? <><Spinner size={14} /> Verifying…</> : "Verify Code"}
            </button>
          </form>
        )}

        {phase === "waiting" && (
          <div style={{ textAlign: "center", padding: "8px 0", display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
            <div style={{
              width: 56, height: 56, borderRadius: "50%",
              background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28,
            }}>
              ✓
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#166534" }}>Your code is correct!</p>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "#6b7280" }}>
                Waiting for {partnerName} to enter your code…
              </p>
            </div>
            <Spinner size={18} />
          </div>
        )}

        {phase === "completed" && (
          <div style={{ textAlign: "center", padding: "8px 0", display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
            <div style={{
              width: 56, height: 56, borderRadius: "50%",
              background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width={28} height={28} viewBox="0 0 24 24" fill="none"
                   stroke="#3C7143" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#166534" }}>Swap complete!</p>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "#6b7280" }}>
                Both codes verified. Items and Leaves transferred.
              </p>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 14, color: "#ef4444", fontWeight: 600 }}>{errorMsg}</p>
            <button
              onClick={startConfirmation}
              style={{
                padding: "10px 0", background: "#3C7143", color: "#ffffff", border: "none", borderRadius: 8,
                fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Try again
            </button>
            <button
              onClick={onClose}
              style={{
                padding: "10px 0", background: "#f3f4f6", border: "none", borderRadius: 8,
                fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="#4CAF50" strokeWidth={2.5} strokeLinecap="round"
      style={{ animation: "scmSpin 0.9s linear infinite", display: "inline-block" }}
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      <style>{`@keyframes scmSpin{to{transform:rotate(360deg)}}`}</style>
    </svg>
  )
}
