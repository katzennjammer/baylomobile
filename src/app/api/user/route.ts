import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { awardTaskAsync } from "@/lib/tasks"
import { parseBody, updateUserSchema, deleteUserSchema } from "@/lib/validation"
import { deleteAccount } from "./delete-account"

export async function PATCH(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsed = await parseBody(req, updateUserSchema)
  if (!parsed.ok) return parsed.response
  const { name, bio, location, avatar, currentPassword, newPassword } = parsed.data

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

  const data: Record<string, unknown> = {}

  if (typeof name === "string") {
    const trimmed = name.trim()
    if (!trimmed) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 })
    data.name = trimmed
  }
  if (typeof bio === "string") data.bio = bio.trim() || null
  if (typeof location === "string") data.location = location.trim() || null
  // Avatar was accepted by the UI but dropped here, which made COMPLETE_PROFILE
  // unreachable for credentials users: the award below requires a non-empty
  // avatar, and no request could ever set one. Google users got theirs from the
  // OAuth profile and so were the only ones who could complete the task.
  if (typeof avatar === "string") data.avatar = avatar.trim() || null

  if (newPassword) {
    // Length is enforced by passwordSchema before we get here.
    if (user.password) {
      if (!currentPassword) {
        return NextResponse.json({ error: "Current password is required" }, { status: 400 })
      }
      const valid = await bcrypt.compare(currentPassword, user.password)
      if (!valid) return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 })
    }
    data.password = await bcrypt.hash(newPassword, 12)
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
  }

  const updated = await prisma.user.update({ where: { id: user.id }, data })

  // COMPLETE_PROFILE is awarded the moment avatar, bio and location are all
  // filled in — one-time, enforced by the TaskCompletion unique constraint.
  const profileComplete =
    !!updated.avatar?.trim() && !!updated.bio?.trim() && !!updated.location?.trim()
  if (profileComplete) {
    awardTaskAsync(user.id, "COMPLETE_PROFILE", "", {
      description: "Task reward: completed your profile",
    })
  }

  return NextResponse.json({
    name: updated.name,
    bio: updated.bio,
    location: updated.location,
    avatar: updated.avatar,
  })
}

/**
 * DELETE /api/user — the account deletion Google Play requires.
 *
 * See ./delete-account.ts for why this anonymises rather than removes the row:
 * the Leaf ledger cascades from User, and destroying it would break
 * SUM(User.leaves) == SUM(LeafTransaction.amount).
 */
export async function DELETE(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // A typed confirmation plus, for password accounts, the password itself.
  // Deletion is irreversible, so a stray DELETE must not be able to trigger it.
  const parsed = await parseBody(req, deleteUserSchema)
  if (!parsed.ok) return parsed.response

  const outcome = await deleteAccount(session.user.id, parsed.data.password)
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status })
  }

  return NextResponse.json({ deleted: true, ...outcome.summary })
}
