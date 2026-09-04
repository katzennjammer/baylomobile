"use client"

import { useState, Suspense } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import toast from "react-hot-toast"
import Navbar from "@/components/Navbar"
// The same three the register route calls. Imported rather than reimplemented:
// a second copy of "is this person 18" is a second copy that can disagree with
// the first about a birthday falling on today.
import { MIN_AGE, isAdult, parseDateOfBirth } from "@/lib/age"

export type SwapDisplay = {
  id: string
  when: string
  senderFirstName: string
  receiverFirstName: string
  itemA: { title: string; image: string | null }
  itemB: { title: string; image: string | null }
}

export type RecentUser = {
  id: string
  name: string
  avatar: string | null
}

const AVATAR_COLORS = ["#3C7143", "#6B4C9C", "#2563EB", "#D97706", "#7C3AED", "#DC2626"]
function getAvatarColor(name: string): string {
  let hash = 0
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0x7fffffff
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function UserAvatar({ user }: { user: RecentUser }) {
  const initials = user.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?"
  if (user.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatar}
        alt={user.name}
        style={{ width: 38, height: 38, borderRadius: "50%", objectFit: "cover" }}
      />
    )
  }
  return (
    <span style={{
      width: 38, height: 38, borderRadius: "50%",
      background: getAvatarColor(user.name),
      display: "grid", placeItems: "center",
      fontFamily: "var(--ff)", fontWeight: 700, fontSize: 13,
      color: "#fff", userSelect: "none", flexShrink: 0,
    }}>
      {initials}
    </span>
  )
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
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

function ArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
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

function ItemSwatch({ title, image }: { title: string; image: string | null }) {
  const initials = title.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?"
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt={title}
        style={{ width: 42, height: 42, borderRadius: 11, objectFit: "cover", flexShrink: 0 }}
      />
    )
  }
  return (
    <span style={{
      width: 42, height: 42, borderRadius: 11, flexShrink: 0,
      background: "oklch(1 0 0 / 0.1)",
      display: "grid", placeItems: "center",
      fontFamily: "var(--ff)", fontWeight: 700, fontSize: 13,
      color: "var(--on-accent)", userSelect: "none",
    }}>
      {initials}
    </span>
  )
}

function RegisterForm({ swaps, userCount, recentUsers }: { swaps: SwapDisplay[]; userCount: number; recentUsers: RecentUser[] }) {
  const router = useRouter()

  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "", dateOfBirth: "" })
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.password !== form.confirmPassword) {
      toast.error("Passwords do not match")
      return
    }
    // The 18+ gate, checked here so the answer is instant, and checked again by
    // /api/auth/register, which is the one that decides. `parseDateOfBirth`
    // and `isAdult` are the SAME functions the route calls — imported rather
    // than reimplemented, so the two cannot drift into disagreeing about a
    // birthday that falls on today.
    const dob = parseDateOfBirth(form.dateOfBirth)
    if (!dob) {
      toast.error("Enter your date of birth")
      return
    }
    if (!isAdult(dob)) {
      toast.error(`You must be ${MIN_AGE} or older to use Baylo`)
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          dateOfBirth: form.dateOfBirth,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 409) {
          toast.error(
            (t) => (
              <span>
                An account with this email already exists —{" "}
                <a
                  href="/auth/login"
                  style={{ color: "inherit", fontWeight: 700, textDecoration: "underline" }}
                  onClick={() => toast.dismiss(t.id)}
                >
                  log in instead
                </a>
              </span>
            ),
            { duration: 6000 }
          )
        } else {
          toast.error(data.error || "Registration failed")
        }
        return
      }
      await signIn("credentials", { email: form.email, password: form.password, redirect: false })
      toast.success("Account created! Welcome to Baylo.")
      router.push("/loading-screen?next=%2Fdashboard")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
    <Navbar variant="register" />
    <div className="register-grid" style={{
      minHeight: "100svh",
      paddingTop: 68,
      display: "grid",
      gridTemplateColumns: "1.1fr 1fr",
      background: "var(--bg)",
    }}>

      {/* ── Left panel — live swap feed ── */}
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

        {/* headline */}
        <div style={{ position: "relative", zIndex: 1, marginTop: "auto" }}>
          <p className="kicker" style={{ display: "block", marginBottom: 16 }}>Join the circular economy</p>
          <h2 style={{
            fontFamily: "var(--ff)", fontWeight: 800, fontStretch: "125%",
            fontSize: "clamp(32px, 3.8vw, 58px)", lineHeight: 0.9,
            letterSpacing: "-0.02em", textTransform: "uppercase",
            color: "var(--on-accent)",
          }}>
            Where Cebu trades<br />
            <span style={{ color: "var(--accent)" }}>without cash.</span>
          </h2>
        </div>

        {/* recent completed swaps */}
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 12 }} aria-hidden>
          {swaps.length === 0 ? (
            <div style={{
              padding: "22px 20px",
              background: "oklch(1 0 0 / 0.05)",
              border: "1px solid oklch(1 0 0 / 0.12)",
              borderRadius: 16,
              textAlign: "center",
            }}>
              <p style={{ color: "oklch(1 0 0 / 0.45)", fontSize: 14, lineHeight: 1.6, margin: 0 }}>
                No completed swaps yet —<br />yours could be the first!
              </p>
            </div>
          ) : swaps.map((s) => (
            <div key={s.id} style={{
              display: "flex", alignItems: "center", gap: 16,
              background: "oklch(1 0 0 / 0.05)",
              border: "1px solid oklch(1 0 0 / 0.12)",
              borderRadius: 16, padding: "13px 16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <ItemSwatch title={s.itemA.title} image={s.itemA.image} />
                <span style={{ color: "var(--accent)", display: "grid", placeItems: "center" }}><SwapIcon /></span>
                <ItemSwatch title={s.itemB.title} image={s.itemB.image} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
                <span style={{
                  fontFamily: "var(--ff)", fontWeight: 700, fontStretch: "108%",
                  fontSize: 14.5, textTransform: "uppercase", letterSpacing: "0.01em",
                  lineHeight: 1, color: "var(--on-accent)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{s.itemA.title} ⇄ {s.itemB.title}</span>
                <span style={{ fontSize: 12.5, color: "oklch(1 0 0 / 0.5)" }}>
                  {s.senderFirstName} swapped with {s.receiverFirstName} · {s.when}
                </span>
              </div>
              <span style={{
                marginLeft: "auto", flexShrink: 0, whiteSpace: "nowrap",
                fontFamily: "var(--ff)", fontWeight: 700, fontSize: 12, letterSpacing: "0.04em",
                padding: "6px 11px", borderRadius: 100,
                background: "var(--accent)", color: "var(--on-accent)",
              }}>✓ Done</span>
            </div>
          ))}
        </div>

        {/* social proof */}
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex" }}>
            {(recentUsers.length > 0 ? recentUsers : Array(4).fill(null)).map((u, i) => (
              <div key={i} style={{ marginLeft: i === 0 ? 0 : -12, border: "2px solid var(--text)", borderRadius: "50%", flexShrink: 0 }}>
                {u ? (
                  <UserAvatar user={u} />
                ) : (
                  <span style={{
                    width: 38, height: 38, borderRadius: "50%", display: "block",
                    background: "linear-gradient(135deg, oklch(1 0 0 / 0.18), oklch(1 0 0 / 0.06))",
                  }} />
                )}
              </div>
            ))}
          </div>
          <p style={{ fontSize: 13.5, color: "oklch(1 0 0 / 0.55)", lineHeight: 1.4 }}>
            {userCount > 0 ? (
              <>
                <strong style={{ color: "var(--on-accent)", fontFamily: "var(--ff)", fontWeight: 700 }}>
                  {userCount.toLocaleString()}{userCount >= 100 ? "+" : ""} trader{userCount !== 1 ? "s" : ""}
                </strong>{" "}
                joined by students and makers across Urban Cebu.
              </>
            ) : (
              "Join Baylo — be the first trader in our community!"
            )}
          </p>
        </div>
      </div>

      {/* ── Right panel — form ── */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "clamp(40px, 6vw, 80px)",
        overflowY: "auto",
      }}>
        <div style={{ maxWidth: 420, width: "100%", margin: "0 auto" }}>

          {/* heading */}
          <div style={{ marginBottom: "clamp(32px, 4vw, 48px)" }}>
            <p className="kicker" style={{ marginBottom: 12 }}>Join Baylo · Free forever</p>
            <h1 style={{
              fontFamily: "var(--ff)", fontWeight: 800, fontStretch: "125%",
              fontSize: "clamp(32px, 4vw, 52px)", lineHeight: 0.92,
              letterSpacing: "-0.02em", textTransform: "uppercase",
              color: "var(--text)",
            }}>
              Create your<br />
              <span style={{ color: "var(--accent)" }}>account.</span>
            </h1>
          </div>

          {/* form */}
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            {/* Name */}
            <div>
              <label style={labelStyle}>Full Name</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onFocus={() => setFocused("name")}
                onBlur={() => setFocused(null)}
                placeholder="Juan Dela Cruz"
                style={inputStyle(focused === "name")}
              />
            </div>

            {/* Email */}
            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                onFocus={() => setFocused("email")}
                onBlur={() => setFocused(null)}
                placeholder="you@example.com"
                style={inputStyle(focused === "email")}
              />
            </div>

            {/* Password */}
            <div>
              <label style={labelStyle}>Password</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPass ? "text" : "password"}
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  onFocus={() => setFocused("password")}
                  onBlur={() => setFocused(null)}
                  placeholder="At least 8 characters"
                  style={{ ...inputStyle(focused === "password"), paddingRight: "3em" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  style={eyeStyle}
                  aria-label={showPass ? "Hide password" : "Show password"}
                >
                  <EyeIcon open={showPass} />
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label style={labelStyle}>Confirm Password</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showConfirm ? "text" : "password"}
                  required
                  value={form.confirmPassword}
                  onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                  onFocus={() => setFocused("confirm")}
                  onBlur={() => setFocused(null)}
                  placeholder="••••••••"
                  style={{ ...inputStyle(focused === "confirm"), paddingRight: "3em" }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  style={eyeStyle}
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                >
                  <EyeIcon open={showConfirm} />
                </button>
              </div>
            </div>

            {/* Date of birth. Baylo is 18+; the server refuses anything under. */}
            <div>
              <label style={labelStyle}>Date of Birth</label>
              <input
                type="date"
                required
                value={form.dateOfBirth}
                onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                onFocus={() => setFocused("dob")}
                onBlur={() => setFocused(null)}
                // A native date input already emits YYYY-MM-DD, which is exactly
                // the wire format /api/auth/register takes — no formatting on
                // the way out, and no timezone to lose. `max` stops the picker
                // offering the future; it is a convenience, not the gate.
                max={new Date().toISOString().slice(0, 10)}
                style={inputStyle(focused === "dob")}
              />
              <p style={{
                fontFamily: "var(--ff)", fontSize: 12, lineHeight: 1.5,
                color: "var(--muted)", marginTop: 6,
              }}>
                Baylo is for people aged {MIN_AGE} and over. This is never shown on your profile.
              </p>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="btn solid"
              style={{
                width: "100%",
                justifyContent: "space-between",
                marginTop: 8,
                opacity: loading ? 0.7 : 1,
                fontSize: "clamp(13px, 1vw, 15px)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {loading && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.5" strokeLinecap="round"
                       style={{ animation: "spin .7s linear infinite", flexShrink: 0 }}>
                    <path d="M12 3a9 9 0 0 1 9 9" />
                    <path d="M21 12a9 9 0 1 1-18 0" opacity=".3" />
                    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                  </svg>
                )}
                {loading ? "Creating account…" : "Create account"}
              </span>
              {!loading && <span className="arrow"><ArrowIcon /></span>}
            </button>
          </form>

          {/* divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0 0" }}>
            <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
            <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>or continue with</span>
            <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
          </div>

          {/* Google */}
          <button
            type="button"
            onClick={() => signIn("google", { callbackUrl: "/loading-screen?next=%2Fdashboard" })}
            style={{
              marginTop: 12, width: "100%",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              fontFamily: "var(--ff)", fontWeight: 600, fontStretch: "106%", fontSize: 15,
              color: "var(--text)", background: "var(--card)",
              border: "1.5px solid var(--line)", borderRadius: 12,
              padding: "12px 20px", cursor: "pointer",
              transition: "border-color .2s, background .2s",
            }}
          >
            <GoogleIcon />
            Continue with Google
          </button>

          {/* sign in link */}
          <p style={{
            marginTop: 24, textAlign: "center",
            fontSize: 13, color: "var(--muted)",
          }}>
            Already have an account?{" "}
            <Link href="/auth/login" style={{
              color: "var(--accent)", fontWeight: 600,
              textDecoration: "underline", textUnderlineOffset: 3,
            }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>

      {/* ── Mobile: stack columns, hide showcase ── */}
      <style>{`
        @media (max-width: 860px) {
          .register-grid { grid-template-columns: 1fr !important; }
          .register-left { display: none !important; }
        }
      `}</style>
    </div>
    </>
  )
}

export default function RegisterClient({ swaps, userCount, recentUsers }: { swaps: SwapDisplay[]; userCount: number; recentUsers: RecentUser[] }) {
  return (
    <Suspense>
      <RegisterForm swaps={swaps} userCount={userCount} recentUsers={recentUsers} />
    </Suspense>
  )
}

/* ── Shared style helpers ── */
const labelStyle: React.CSSProperties = {
  display: "block",
  fontFamily: "var(--ff)",
  fontWeight: 600,
  fontStretch: "108%",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 11,
  color: "var(--muted)",
  marginBottom: 8,
}

const inputStyle = (focused: boolean): React.CSSProperties => ({
  width: "100%",
  fontFamily: "var(--ff)",
  fontSize: 15,
  color: "var(--text)",
  background: "var(--card)",
  border: `1.5px solid ${focused ? "var(--accent)" : "var(--line)"}`,
  borderRadius: 12,
  padding: "0.75em 1em",
  outline: "none",
  transition: "border-color 0.25s",
  display: "block",
})

const eyeStyle: React.CSSProperties = {
  position: "absolute",
  right: "0.85em",
  top: "50%",
  transform: "translateY(-50%)",
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--muted)",
  display: "grid",
  placeItems: "center",
  padding: 0,
  lineHeight: 1,
}
