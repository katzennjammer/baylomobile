"use client"

import { usePathname } from "next/navigation"
import Navbar from "./Navbar"
import SiteFooter from "./SiteFooter"

export default function ConditionalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const hideChromeOn = ["/dashboard", "/auth"]
  const hideChrome = hideChromeOn.some((prefix) => pathname?.startsWith(prefix))

  if (hideChrome) return <>{children}</>

  return (
    <>
      <Navbar />
      <main>{children}</main>
      <SiteFooter />
    </>
  )
}
