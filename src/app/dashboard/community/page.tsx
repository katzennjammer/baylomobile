import { auth } from "@/../auth"
import { redirect } from "next/navigation"
import DashShell from "../_shell/DashShell"

export default async function CommunityPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/login")

  return (
    <DashShell
      title="Community"
      description="See what traders nearby are sharing, discussing, and swapping."
    />
  )
}
