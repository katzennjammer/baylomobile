"use client"

import { useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import AuthModal from "./AuthModal"

export default function CategoryGateLink({
  href,
  children,
  className,
  "data-reveal": dataReveal,
  "data-reveal-delay": dataRevealDelay,
}: {
  href: string
  children: React.ReactNode
  className?: string
  "data-reveal"?: boolean | string
  "data-reveal-delay"?: number | string
}) {
  const { status } = useSession()
  const [open, setOpen] = useState(false)

  if (status === "authenticated") {
    return (
      <Link
        className={className}
        href={href}
        data-reveal={dataReveal}
        data-reveal-delay={dataRevealDelay}
      >
        {children}
      </Link>
    )
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        data-reveal={dataReveal}
        data-reveal-delay={dataRevealDelay}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
      >
        {children}
      </button>
      {open && <AuthModal onClose={() => setOpen(false)} />}
    </>
  )
}
