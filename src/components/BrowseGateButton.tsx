"use client"

import { useState } from "react"
import AuthModal from "./AuthModal"

export default function BrowseGateButton({ children, className, ...rest }: { children: React.ReactNode; className?: string; [key: string]: unknown }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
        {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {children}
      </button>
      {open && <AuthModal onClose={() => setOpen(false)} />}
    </>
  )
}
