"use client"

import { useState } from "react"
import Link from "next/link"
import toast from "react-hot-toast"

function ArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  )
}

function SwapIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4 3 8l4 4" /><path d="M3 8h14" />
      <path d="m17 20 4-4-4-4" /><path d="M21 16H7" />
    </svg>
  )
}

const RECENT_SWAPS = [
  { a: "Film camera", b: "Guitar pedal", who: "Maria swapped with Jio", when: "2m ago", leaves: "+40 Leaves" },
  { a: "Textbooks", b: "Desk lamp", who: "Anna swapped with Paolo", when: "11m ago", leaves: "+25 Leaves" },
  { a: "Sneakers", b: "Skateboard", who: "Kim swapped with Rafa", when: "24m ago", leaves: "+60 Leaves" },
]

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [email, setEmail] = useState("")
  const [focused, setFocused] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || "Something went wrong. Please try again.")
        return
      }
      setSent(true)
    } catch {
      toast.error("Could not reach the server. Check your connection.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="register-grid" style={{
      minHeight: "100svh",
      paddingTop: 68,
      display: "grid",
      gridTemplateColumns: "1.1fr 1fr",
      background: "var(--bg)",
    }}>

      {/* ── Left panel — showcase ── */}
      <div className="register-left" style={{
        position: "relative",
        background: "var(--text)",
        display: "flex",
        flexDirection: "column",
        gap: "clamp(22px, 2.6vw, 40px)",
        padding: "clamp(34px, 4vw, 64px)",
        overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", inset: 0, zIndex: 0,
          backgroundImage:
            "radial-gradient(90% 70% at 12% 0%, oklch(0.74 0.15 152 / 0.18), transparent 55%), repeating-linear-gradient(135deg, oklch(1 0 0 / 0.035) 0 2px, transparent 2px 15px)",
        }} aria-hidden />


        <div style={{ position: "relative", zIndex: 1, marginTop: "auto" }}>
          <p className="kicker" style={{ display: "block", marginBottom: 16 }}>Account recovery</p>
          <h2 style={{
            fontFamily: "var(--ff)", fontWeight: 800, fontStretch: "125%",
            fontSize: "clamp(32px, 3.8vw, 58px)", lineHeight: 0.9,
            letterSpacing: "-0.02em", textTransform: "uppercase", color: "var(--on-accent)",
          }}>
            Back to trading<br />
            <span style={{ color: "var(--accent)" }}>in no time.</span>
          </h2>
        </div>

        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 12 }} aria-hidden>
          {RECENT_SWAPS.map((s) => (
            <div key={s.a} style={{
              display: "flex", alignItems: "center", gap: 16,
              background: "oklch(1 0 0 / 0.05)", border: "1px solid oklch(1 0 0 / 0.12)",
              borderRadius: 16, padding: "13px 16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={swatchStyle} />
                <span style={{ color: "var(--accent)", display: "grid", placeItems: "center" }}><SwapIcon /></span>
                <span style={swatchStyle} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                <span style={{ fontFamily: "var(--ff)", fontWeight: 700, fontStretch: "108%", fontSize: 14.5, textTransform: "uppercase", letterSpacing: "0.01em", lineHeight: 1, color: "var(--on-accent)" }}>{s.a} ⇄ {s.b}</span>
                <span style={{ fontSize: 12.5, color: "oklch(1 0 0 / 0.5)" }}>{s.who} · {s.when}</span>
              </div>
              <span style={{ marginLeft: "auto", flexShrink: 0, whiteSpace: "nowrap", fontFamily: "var(--ff)", fontWeight: 700, fontSize: 12, letterSpacing: "0.04em", padding: "6px 11px", borderRadius: 100, background: "var(--accent)", color: "var(--on-accent)" }}>{s.leaves}</span>
            </div>
          ))}
        </div>

        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex" }}>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} style={{ width: 38, height: 38, borderRadius: 100, marginLeft: i === 0 ? 0 : -12, border: "2px solid var(--text)", background: "linear-gradient(135deg, oklch(1 0 0 / 0.18), oklch(1 0 0 / 0.06))" }} />
            ))}
          </div>
          <p style={{ fontSize: 13.5, color: "oklch(1 0 0 / 0.55)", lineHeight: 1.4 }}>
            <strong style={{ color: "var(--on-accent)", fontFamily: "var(--ff)", fontWeight: 700 }}>12,400+ trades</strong>{" "}
            made by students and makers across Urban Cebu.
          </p>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div style={{
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "clamp(40px, 6vw, 80px)", overflowY: "auto",
      }}>
        <div style={{ maxWidth: 420, width: "100%", margin: "0 auto" }}>

          {!sent ? (
            <>
              <div style={{ marginBottom: "clamp(28px, 3.5vw, 44px)" }}>
                <p className="kicker" style={{ marginBottom: 12 }}>Forgot password</p>
                <h1 style={{
                  fontFamily: "var(--ff)", fontWeight: 800, fontStretch: "125%",
                  fontSize: "clamp(30px, 3.8vw, 50px)", lineHeight: 0.92,
                  letterSpacing: "-0.02em", textTransform: "uppercase", color: "var(--text)",
                }}>
                  Reset your<br />
                  <span style={{ color: "var(--accent)" }}>password.</span>
                </h1>
                <p style={{ color: "var(--muted)", fontSize: 15, lineHeight: 1.5, marginTop: 14 }}>
                  Enter the email tied to your account and we&rsquo;ll send you a link to set a new password.
                </p>
              </div>

              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <label style={labelStyle}>Email</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    placeholder="you@example.com"
                    style={inputStyle(focused)}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn solid"
                  style={{ width: "100%", justifyContent: "space-between", marginTop: 8, opacity: loading ? 0.6 : 1, fontSize: "clamp(13px, 1vw, 15px)" }}
                >
                  <span>{loading ? "Sending link…" : "Send reset link"}</span>
                  <span className="arrow"><ArrowIcon /></span>
                </button>
              </form>
            </>
          ) : (
            <div>
              {/* success state */}
              <div style={{
                width: 56, height: 56, borderRadius: 100, marginBottom: 22,
                display: "grid", placeItems: "center",
                background: "var(--accent)", color: "var(--on-accent)",
              }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6h16v12H4z" opacity="0" />
                  <path d="m3 7 9 6 9-6" />
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                </svg>
              </div>
              <h1 style={{
                fontFamily: "var(--ff)", fontWeight: 800, fontStretch: "125%",
                fontSize: "clamp(30px, 3.8vw, 50px)", lineHeight: 0.92,
                letterSpacing: "-0.02em", textTransform: "uppercase", color: "var(--text)",
              }}>
                Check your<br />
                <span style={{ color: "var(--accent)" }}>inbox.</span>
              </h1>
              <p style={{ color: "var(--muted)", fontSize: 15, lineHeight: 1.55, marginTop: 14 }}>
                If an account exists for <strong style={{ color: "var(--text)" }}>{email}</strong>, a password-reset
                link is on its way. It expires in 30 minutes.
              </p>
              <div style={{ display: "flex", gap: 10, marginTop: 26, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setSent(false)}
                  className="btn"
                  style={{ fontSize: "clamp(13px, 1vw, 15px)" }}
                >
                  <span>Use another email</span>
                </button>
                <Link href="/auth/login" className="btn solid" style={{ fontSize: "clamp(13px, 1vw, 15px)" }}>
                  <span>Back to login</span>
                  <span className="arrow"><ArrowIcon /></span>
                </Link>
              </div>
            </div>
          )}

          {!sent && (
            <p style={{ marginTop: 24, textAlign: "center", fontSize: 13, color: "var(--muted)" }}>
              Remembered it?{" "}
              <Link href="/auth/login" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 }}>
                Back to login
              </Link>
            </p>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .register-grid { grid-template-columns: 1fr !important; }
          .register-left { display: none !important; }
        }
      `}</style>
    </div>
  )
}

/* ── Shared style helpers ── */
const swatchStyle: React.CSSProperties = {
  width: 42, height: 42, borderRadius: 11, flexShrink: 0,
  backgroundImage: "repeating-linear-gradient(135deg, oklch(1 0 0 / 0.1) 0 2px, transparent 2px 9px)",
  backgroundColor: "oklch(1 0 0 / 0.06)",
}

const labelStyle: React.CSSProperties = {
  display: "block", fontFamily: "var(--ff)", fontWeight: 600, fontStretch: "108%",
  textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 11, color: "var(--muted)", marginBottom: 8,
}

const inputStyle = (focused: boolean): React.CSSProperties => ({
  width: "100%", fontFamily: "var(--ff)", fontSize: 15, color: "var(--text)",
  background: "var(--card)", border: `1.5px solid ${focused ? "var(--accent)" : "var(--line)"}`,
  borderRadius: 12, padding: "0.75em 1em", outline: "none", transition: "border-color 0.25s", display: "block",
})
