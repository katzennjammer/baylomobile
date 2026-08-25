"use client"

import { useState } from "react"
import TradeRequestModal from "@/components/TradeRequestModal"

type OwnedItem = { id: string; title: string; images: string }

export default function TradeButton({
  requestedItemId,
  requestedItemTitle,
  ownedItems,
}: {
  requestedItemId: string
  requestedItemTitle: string
  ownedItems: OwnedItem[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full py-3 bg-emerald-600 text-white rounded-xl font-medium text-sm hover:bg-emerald-700 transition-colors"
      >
        Propose a Trade
      </button>
      {open && (
        <TradeRequestModal
          requestedItemId={requestedItemId}
          requestedItemTitle={requestedItemTitle}
          ownedItems={ownedItems}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
