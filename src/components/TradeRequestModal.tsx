"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import toast from "react-hot-toast"

type OwnedItem = {
  id: string
  title: string
  images: string
}

type TradeRequestModalProps = {
  requestedItemId: string
  requestedItemTitle: string
  ownedItems: OwnedItem[]
  onClose: () => void
}

export default function TradeRequestModal({
  requestedItemId,
  requestedItemTitle,
  ownedItems,
  onClose,
}: TradeRequestModalProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const [selectedItemId, setSelectedItemId] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session) {
      router.push("/auth/login")
      return
    }
    if (!selectedItemId) {
      toast.error("Please select an item to offer")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offeredItemId: selectedItemId,
          requestedItemId,
          message,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to send trade request")
      }

      toast.success("Trade request sent!")
      onClose()
      router.refresh()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Propose a Trade</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <p className="text-sm text-gray-500 mb-1">You want</p>
            <p className="font-medium text-gray-900 text-sm">{requestedItemTitle}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              What are you offering? <span className="text-red-500">*</span>
            </label>
            {ownedItems.length === 0 ? (
              <p className="text-sm text-gray-400">
                You have no available items to offer.{" "}
                <a href="/listings/new" className="text-emerald-600 hover:underline">Post an item first.</a>
              </p>
            ) : (
              <select
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                required
              >
                <option value="">Select your item...</option>
                {ownedItems.map((item) => (
                  <option key={item.id} value={item.id}>{item.title}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Message (optional)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Tell them why you want to trade..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || ownedItems.length === 0}
              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Sending..." : "Send Request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
