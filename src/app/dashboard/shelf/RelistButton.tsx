"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function RelistButton({ itemId }: { itemId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleRelist() {
    setLoading(true)
    try {
      const res = await fetch(`/api/items/${itemId}/relist`, { method: "POST" })
      if (res.ok) {
        router.refresh()
      } else {
        const { error } = await res.json().catch(() => ({ error: "Failed to re-list item" }))
        alert(error ?? "Failed to re-list item")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleRelist}
      disabled={loading}
      style={{
        width: "100%", padding: "8px 0", borderRadius: 8,
        background: loading ? "rgba(76,175,80,.5)" : "#4CAF50",
        color: "#1A3520", fontWeight: 700, fontSize: 12,
        border: "none", cursor: loading ? "not-allowed" : "pointer",
        transition: "background .15s",
      }}
    >
      {loading ? "Re-listing…" : "Re-list on Tradeplace"}
    </button>
  )
}
