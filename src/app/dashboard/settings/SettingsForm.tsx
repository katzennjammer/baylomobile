"use client"

import React, { useState } from "react"
import BlockedUsers from "./BlockedUsers"

interface Props {
  name: string
  email: string
  bio: string | null
  location: string | null
  hasPassword: boolean
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: "10px 14px", borderRadius: 10, fontSize: 15,
  border: "1.5px solid rgba(0,0,0,.15)", outline: "none", width: "100%",
  boxSizing: "border-box", background: "#fff", color: "#111",
}

const disabledStyle: React.CSSProperties = {
  ...inputStyle, background: "rgba(0,0,0,.04)", color: "#888", cursor: "not-allowed",
}

export default function SettingsForm({ name, email, bio, location, hasPassword }: Props) {
  const [nameVal, setName] = useState(name)
  const [bioVal, setBio] = useState(bio ?? "")
  const [locationVal, setLocation] = useState(location ?? "")
  const [curPw, setCurPw] = useState("")
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null)
  const [pwMsg, setPwMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setMsg(null)
    const res = await fetch("/api/user", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameVal, bio: bioVal, location: locationVal }),
    })
    const data = await res.json()
    setSaving(false)
    setMsg(res.ok ? { type: "ok", text: "Profile saved." } : { type: "err", text: data.error ?? "Failed to save." })
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwMsg(null)
    if (newPw !== confirmPw) { setPwMsg({ type: "err", text: "Passwords don't match." }); return }
    setSaving(true)
    const res = await fetch("/api/user", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: curPw, newPassword: newPw }),
    })
    const data = await res.json()
    setSaving(false)
    if (res.ok) {
      setPwMsg({ type: "ok", text: "Password updated." })
      setCurPw(""); setNewPw(""); setConfirmPw("")
    } else {
      setPwMsg({ type: "err", text: data.error ?? "Failed to update password." })
    }
  }

  const section: React.CSSProperties = {
    background: "#fff", borderRadius: 16, border: "1px solid rgba(0,0,0,.08)", padding: "24px 24px 28px",
    display: "flex", flexDirection: "column", gap: 20,
  }
  const sectionTitle: React.CSSProperties = {
    fontSize: 16, fontWeight: 800, letterSpacing: "-.02em", marginBottom: 4,
  }
  const saveBtn: React.CSSProperties = {
    padding: "10px 20px", borderRadius: 10, background: "#4CAF50", color: "#1A3520",
    fontWeight: 700, fontSize: 14, border: 0, cursor: saving ? "not-allowed" : "pointer",
    opacity: saving ? .6 : 1, alignSelf: "flex-start",
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Profile info */}
      <form onSubmit={saveProfile} style={section}>
        <p style={sectionTitle}>Profile information</p>
        <Field label="Display name">
          <input style={inputStyle} value={nameVal} onChange={e => setName(e.target.value)} required />
        </Field>
        <Field label="Email">
          <input style={disabledStyle} value={email} disabled />
          <span style={{ fontSize: 11, color: "#aaa" }}>Email cannot be changed here.</span>
        </Field>
        <Field label="Bio">
          <textarea
            style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
            value={bioVal} onChange={e => setBio(e.target.value)}
            placeholder="Tell others what you like to trade…"
          />
        </Field>
        <Field label="Location">
          <input
            style={inputStyle} value={locationVal} onChange={e => setLocation(e.target.value)}
            placeholder="e.g. Cebu City, Philippines"
          />
        </Field>
        {msg && (
          <p style={{ fontSize: 13, fontWeight: 600, color: msg.type === "ok" ? "#0f9d6e" : "#e53" }}>{msg.text}</p>
        )}
        <button type="submit" style={saveBtn} disabled={saving}>
          {saving ? "Saving…" : "Save profile"}
        </button>
      </form>

      {/* Password */}
      <form onSubmit={savePassword} style={section}>
        <p style={sectionTitle}>Password</p>
        {!hasPassword && (
          <p style={{ fontSize: 13, color: "#888", padding: "10px 14px", borderRadius: 10, background: "rgba(0,0,0,.04)" }}>
            Your account uses Google sign-in. You can set a password below to also enable email/password login.
          </p>
        )}
        {hasPassword && (
          <Field label="Current password">
            <input type="password" style={inputStyle} value={curPw} onChange={e => setCurPw(e.target.value)} autoComplete="current-password" />
          </Field>
        )}
        <Field label={hasPassword ? "New password" : "Set a password"}>
          <input type="password" style={inputStyle} value={newPw} onChange={e => setNewPw(e.target.value)} autoComplete="new-password" minLength={8} />
        </Field>
        <Field label="Confirm password">
          <input type="password" style={inputStyle} value={confirmPw} onChange={e => setConfirmPw(e.target.value)} autoComplete="new-password" />
        </Field>
        {pwMsg && (
          <p style={{ fontSize: 13, fontWeight: 600, color: pwMsg.type === "ok" ? "#0f9d6e" : "#e53" }}>{pwMsg.text}</p>
        )}
        <button type="submit" style={saveBtn} disabled={saving || !newPw || !confirmPw}>
          {saving ? "Saving…" : hasPassword ? "Change password" : "Set password"}
        </button>
      </form>

      {/* Blocked people. Play requires blocking to be reversible in-app, and a
          block you cannot find again is a permanent decision made in a second. */}
      <BlockedUsers />

      {/* Account info */}
      <div style={{ ...section, gap: 10 }}>
        <p style={sectionTitle}>Account</p>
        <p style={{ fontSize: 13, color: "#888" }}>
          Need to delete your account? Contact support at{" "}
          <a href="mailto:support@baylo.app" style={{ color: "#4CAF50" }}>support@baylo.app</a>.
        </p>
      </div>
    </div>
  )
}
