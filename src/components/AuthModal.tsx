"use client"

import Link from "next/link"
import { useEffect } from "react"

export default function AuthModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(10px)",
        padding: "20px",
        animation: "baylo-fade-in .2s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card)", border: "1px solid var(--line)",
          borderRadius: 24, padding: "44px 40px 36px",
          maxWidth: 420, width: "100%", position: "relative",
          boxShadow: "0 40px 100px -20px rgba(0,0,0,0.7)",
          animation: "baylo-slide-up .25s cubic-bezier(.22,1,.36,1)",
        }}
      >
        {/* close */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute", top: 16, right: 16,
            width: 34, height: 34, borderRadius: 8,
            background: "var(--bg)", border: "1px solid var(--line)",
            color: "var(--muted)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "color .2s, border-color .2s",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        {/* logo badge */}
        <div style={{
          width: 72, height: 72, borderRadius: 18,
          background: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 20,
          boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
        }}>
          <img src="/logo.png" alt="Baylo" style={{ width: 52, height: 52, objectFit: "contain" }} />
        </div>

        <h2 style={{
          fontFamily: "var(--ff)", fontWeight: 800, fontStretch: "118%",
          fontSize: "clamp(22px,4vw,27px)", color: "var(--text)",
          marginBottom: 10, lineHeight: 1.2,
        }}>
          Join Baylo to browse
        </h2>
        <p style={{ color: "var(--muted)", fontSize: 15, lineHeight: 1.6, marginBottom: 28 }}>
          Create a free account — or log in — to explore listings, discover local swap meets, and start trading without spending a peso.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Link
            href="/auth/register"
            onClick={onClose}
            style={{
              fontFamily: "var(--ff)", fontWeight: 700, fontStretch: "108%",
              fontSize: 15.5, textAlign: "center",
              background: "var(--accent)", color: "var(--on-accent)",
              padding: "13px 20px", borderRadius: 12,
              transition: "filter .2s, transform .2s",
              display: "block",
            }}
          >
            Create a free account
          </Link>
          <Link
            href="/auth/login"
            onClick={onClose}
            style={{
              fontFamily: "var(--ff)", fontWeight: 600, fontStretch: "106%",
              fontSize: 15, textAlign: "center",
              background: "var(--bg)", color: "var(--text)",
              border: "1px solid var(--line)",
              padding: "12px 20px", borderRadius: 12,
              transition: "border-color .2s, color .2s",
              display: "block",
            }}
          >
            Log in
          </Link>
        </div>

        <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 12.5, marginTop: 20, lineHeight: 1.5 }}>
          By joining, you agree to our{" "}
          <Link href="/trust" style={{ color: "var(--accent)", textDecoration: "underline" }}>Trust & Safety</Link> guidelines.
        </p>
      </div>

      <style>{`
        @keyframes baylo-fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes baylo-slide-up { from { opacity: 0; transform: translateY(18px) scale(.97) } to { opacity: 1; transform: none } }
      `}</style>
    </div>
  )
}
