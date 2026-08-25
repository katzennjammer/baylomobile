import { auth } from "@/../auth"
import { redirect } from "next/navigation"
import DashShell from "../_shell/DashShell"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function FriendsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/login")

  return (
    <DashShell
      title="Friends"
      description="Connect with traders you've swapped with or follow new ones."
    />
  )
}
