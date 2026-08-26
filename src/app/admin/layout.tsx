import type { ReactNode } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@root/auth"
import prisma from "@/lib/prisma"
import { suspensionState } from "@/lib/moderation"

export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * The /admin shell, and the guard on every page under it.
 *
 * THE ROLE CHECK CANNOT LIVE IN proxy.ts. That file runs in the Next.js proxy
 * (formerly middleware), which has no database access — it can only read the
 * NextAuth JWT, and the JWT does not carry the role. Putting the role in the
 * token would make it a 30-day cached copy of a permission, so a revoked
 * moderator would keep their access until the token expired. proxy.ts therefore
 * does the one thing it can do correctly (bounce a signed-out visitor to the
 * login page) and the real check happens here, against the database, on every
 * request.
 *
 * A LAYOUT GUARD PROTECTS PAGES, NOT DATA. Every /api/admin route calls
 * requireRole() for itself and would 403 a non-staff caller with this file
 * deleted. This is what stops a signed-in ordinary user seeing the moderation
 * UI; the API is what stops them reading the reports.
 *
 * The redirect is to /dashboard, not to a 403 page: an ordinary user who
 * followed a stale link wants to be somewhere useful, and the pages here are
 * not a secret worth an error screen. The API tells the truth with a 403.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/login?callbackUrl=/admin")

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, name: true, deletedAt: true, suspendedAt: true, suspendedUntil: true },
  })

  if (!me || me.deletedAt || suspensionState(me).suspended) redirect("/auth/login")
  if (me.role !== "MODERATOR" && me.role !== "ADMIN") redirect("/dashboard")

  return (
    <div style={{ minHeight: "100vh", background: "#f6f7f8", color: "#111" }}>
      <header
        style={{
          background: "#fff",
          borderBottom: "1px solid rgba(0,0,0,.08)",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <strong style={{ fontSize: 15, letterSpacing: "-.01em" }}>Baylo moderation</strong>
        <nav style={{ display: "flex", gap: 16, fontSize: 14 }}>
          <Link href="/admin" style={{ color: "#444" }}>Queue</Link>
          <Link href="/admin/anomalies" style={{ color: "#444" }}>Anomalies</Link>
          <Link href="/admin/audit" style={{ color: "#444" }}>Audit log</Link>
        </nav>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "#888" }}>
          {me.name} · {me.role}
        </span>
        <Link href="/dashboard" style={{ fontSize: 13, color: "#4CAF50" }}>
          Back to app
        </Link>
      </header>
      <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>{children}</main>
    </div>
  )
}
