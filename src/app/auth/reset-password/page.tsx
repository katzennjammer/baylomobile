"use client"

import { useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import toast from "react-hot-toast"

function ArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  )
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  )
}

function ResetForm() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get("token")

  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)

  if (!token) {
    return (
      <div style={{ textAlign: "center" }}>
        <p style={{ color: "var(--muted)", fontSize: 15, marginBottom: 20 }}>This reset link is invalid or has already been used.</p>
        <Link href="/auth/forgot" className="btn solid" style={{ fontSize: 15 }}>
          <span>Request a new link</span>
          <span className="arrow"><ArrowIcon /></span>
        </Link>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { toast.error("Passwords do not match"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || "Failed to reset password"); return }
      setDone(true)
      setTimeout(() => router.push("/auth/login"), 3000)
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div>
        <div style={{ width: 56, height: 56, borderRadius: 100, marginBottom: 22, display: "grid", placeItems: "center", background: "var(--accent)", color: "var(--on-accent)" }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 style={{ fontFamily: "var(--ff)", fontWeight: 800, fontStretch: "125%", fontSize: "clamp(30px,3.8vw,50px)", lineHeight: 0.92, letterSpacing: "-0.02em", textTransform: "uppercase", color: "var(--text)" }}>
          Password<br /><span style={{ color: "var(--accent)" }}>updated.</span>
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 15, lineHeight: 1.55, marginTop: 14 }}>
          Your password has been changed. Redirecting you to login…
        </p>
      </div>
    )
  }

  return (
    <>
      <div style={{ marginBottom: "clamp(28px,3.5vw,44px)" }}>
        <p className="kicker" style={{ marginBottom: 12 }}>Password reset</p>
        <h1 style={{ fontFamily: "var(--ff)", fontWeight: 800, fontStretch: "125%", fontSize: "clamp(30px,3.8vw,50px)", lineHeight: 0.92, letterSpacing: "-0.02em", textTransform: "uppercase", color: "var(--text)" }}>
          Choose a new<br /><span style={{ color: "var(--accent)" }}>password.</span>
        </h1>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <label style={labelStyle}>New password</label>
          <div style={{ position: "relative" }}>
            <input
              type={showPass ? "text" : "password"}
              required minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocused("pass")}
              onBlur={() => setFocused(null)}
              placeholder="At least 8 characters"
              style={{ ...inputStyle(focused === "pass"), paddingRight: "3em" }}
            />
            <button type="button" onClick={() => setShowPass(v => !v)} style={eyeStyle} aria-label="Toggle">
              <EyeIcon open={showPass} />
            </button>
          </div>
        </div>

        <div>
          <label style={labelStyle}>Confirm password</label>
          <div style={{ position: "relative" }}>
            <input
              type={showConfirm ? "text" : "password"}
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onFocus={() => setFocused("confirm")}
              onBlur={() => setFocused(null)}
              placeholder="••••••••"
              style={{ ...inputStyle(focused === "confirm"), paddingRight: "3em" }}
            />
            <button type="button" onClick={() => setShowConfirm(v => !v)} style={eyeStyle} aria-label="Toggle">
              <EyeIcon open={showConfirm} />
            </button>
          </div>
        </div>

        <button type="submit" disabled={loading} className="btn solid" style={{ width: "100%", justifyContent: "space-between", marginTop: 8, opacity: loading ? 0.6 : 1, fontSize: "clamp(13px,1vw,15px)" }}>
          <span>{loading ? "Saving…" : "Set new password"}</span>
          <span className="arrow"><ArrowIcon /></span>
        </button>
      </form>
    </>
  )
}

export default function ResetPasswordPage() {
  return (
    <div style={{ minHeight: "100svh", paddingTop: 68, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: "68px clamp(20px,6vw,80px) 40px" }}>
      <div style={{ maxWidth: 420, width: "100%" }}>
        <Suspense fallback={null}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  )
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

const eyeStyle: React.CSSProperties = {
  position: "absolute", right: "0.85em", top: "50%", transform: "translateY(-50%)",
  background: "none", border: "none", cursor: "pointer", color: "var(--muted)",
  display: "grid", placeItems: "center", padding: 0, lineHeight: 1,
}
