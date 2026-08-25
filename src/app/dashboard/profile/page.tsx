import { auth } from "@/../auth"
import { redirect } from "next/navigation"
import prisma from "@/lib/prisma"
import DashShell from "../_shell/DashShell"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function ProfilePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/login")
  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user) redirect("/auth/login")

  return (
    <DashShell
      title={user.name}
      description={`@${user.name.toLowerCase().replace(/\s+/g, "").slice(0, 20)} · ${user.location ?? "Location not set"} · ${user.totalTrades} trades`}
    />
  )
}
