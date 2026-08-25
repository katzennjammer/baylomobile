import { auth } from "@/../auth"
import { redirect } from "next/navigation"
import prisma from "@/lib/prisma"
import DashShell from "../_shell/DashShell"
import SettingsForm from "./SettingsForm"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/login")

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user) redirect("/auth/login")

  return (
    <DashShell title="Settings" description="Manage your profile and account">
      <SettingsForm
        name={user.name}
        email={user.email}
        bio={user.bio ?? null}
        location={user.location ?? null}
        hasPassword={!!user.password}
      />
    </DashShell>
  )
}
