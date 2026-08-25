import { auth } from "@/../auth"
import { redirect } from "next/navigation"
import DashShell from "../_shell/DashShell"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function WishlistPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/login")

  return (
    <DashShell
      title="Wishlist"
      description="Items you've saved that you're looking to trade for."
    />
  )
}
