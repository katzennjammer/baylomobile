"use client"

import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import AvatarImage from "@/components/AvatarImage"

/**
 * The blocked-users list, with unblock.
 *
 * Google Play's UGC policy asks for blocking to be reversible from inside the
 * app, and there is a plainer reason to want this screen: a block made in anger
 * that cannot be found again is a permanent decision made in a second.
 *
 * Loaded client-side rather than server-rendered into the settings page. The
 * list changes as you use it, and re-rendering the whole settings page on every
 * unblock to keep a five-row list in sync is not worth it.
 */

interface BlockedUser {
  id: string
  user: { id: string; name: string; avatar: string | null }
  createdAt: string
}

export default function BlockedUsers() {
  const [blocks, setBlocks] = useState<BlockedUser[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/v1/blocks")
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled) setBlocks(body?.data?.blocks ?? [])
      })
      .catch(() => {
        if (!cancelled) setBlocks([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function unblock(userId: string, name: string) {
    setBusyId(userId)
    try {
      const res = await fetch(`/api/v1/blocks/${userId}`, { method: "DELETE" })
      if (res.ok) {
        setBlocks((prev) => (prev ?? []).filter((b) => b.user.id !== userId))
        toast.success(`Unblocked ${name}.`)
      } else {
        toast.error("Could not unblock. Try again.")
      }
    } catch {
      toast.error("Could not unblock. Try again.")
    } finally {
      setBusyId(null)
    }
  }

  const section: React.CSSProperties = {
    background: "#fff", borderRadius: 16, border: "1px solid rgba(0,0,0,.08)",
    padding: "24px 24px 28px", display: "flex", flexDirection: "column", gap: 16,
  }

  return (
    <div style={section}>
      <div>
        <p style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.02em", marginBottom: 4 }}>
          Blocked people
        </p>
        <p style={{ fontSize: 13, color: "#888", lineHeight: 1.55 }}>
          You will not see each other&apos;s listings or messages. Unblocking restores both —
          it does not undo anything that happened while the block was on.
        </p>
      </div>

      {blocks === null && <p style={{ fontSize: 13, color: "#aaa" }}>Loading…</p>}

      {blocks !== null && blocks.length === 0 && (
        <p style={{ fontSize: 13, color: "#aaa" }}>You have not blocked anyone.</p>
      )}

      {blocks?.map((b) => (
        <div
          key={b.id}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 0", borderTop: "1px solid rgba(0,0,0,.06)",
          }}
        >
          <div style={{
            width: 36, height: 36, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
            background: "rgba(76,175,80,.15)", color: "#2e7d32",
            display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700,
          }}>
            {b.user.avatar ? (
              <AvatarImage src={b.user.avatar} name={b.user.name} width={36} height={36} className="object-cover" />
            ) : (
              b.user.name.charAt(0).toUpperCase()
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{b.user.name}</div>
            <div style={{ fontSize: 12, color: "#aaa" }}>
              Blocked {new Date(b.createdAt).toLocaleDateString()}
            </div>
          </div>

          <button
            type="button"
            onClick={() => unblock(b.user.id, b.user.name)}
            disabled={busyId === b.user.id}
            style={{
              padding: "8px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600,
              border: "1px solid rgba(0,0,0,.15)", background: "transparent",
              color: "#444", cursor: busyId === b.user.id ? "not-allowed" : "pointer",
              opacity: busyId === b.user.id ? 0.5 : 1,
            }}
          >
            {busyId === b.user.id ? "…" : "Unblock"}
          </button>
        </div>
      ))}
    </div>
  )
}
