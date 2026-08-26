import { NextRequest } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { ok, notFound, conflict, forbidden, invalid } from "@/lib/v1/envelope"
import { parseJsonBody } from "@/lib/v1/body"
import { writeAudit, suspensionState } from "@/lib/moderation"

export const dynamic = "force-dynamic"

/**
 * POST /api/admin/users/[id] — suspend or unsuspend an account.
 *
 * WHAT A SUSPENSION DOES: sets User.suspendedAt (and optionally suspendedUntil).
 * resolveSession() refuses a suspended account, so every authenticated route in
 * the application stops working for them within the life of one request — not
 * within the 15-minute life of their access token, and not within the 30-day
 * life of a web cookie. Their listings also leave every feed, because
 * visibleItemWhere() excludes a suspended owner: an account that cannot sign in
 * cannot answer a message or turn up to a meetup, and leaving its listings
 * up sends people to a counterparty who is structurally unable to reply.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. Exactly what blocking does not do, and for
 * the identical reason: it does not cancel their in-flight trades and it does
 * not void their Deferred Points Agreements. A suspension that cleared debts
 * would make misbehaving the cheapest way to escape one, and this system does
 * not do reversals — see the note on the DeferredContract model. The debt
 * stands, the deadline keeps running, and the sweep will still default them.
 *
 * NOTE THE ROLE FLOOR: ADMIN, not MODERATOR. Suspension is the heaviest button
 * on the surface and the only one that can silence another staff account, so it
 * sits one rung above hiding a listing.
 *
 * THERE IS NO `role` FIELD IN THE SCHEMA BELOW, AND THERE MUST NEVER BE. This
 * is the closest route in the codebase to a promotion endpoint, which makes it
 * the one somebody would add it to. See the note on User.role: an API that can
 * grant ADMIN is a privilege-escalation target, and promotion is manual SQL.
 */

const bodySchema = z.strictObject({
  action: z.enum(["suspend", "unsuspend"]),
  reason: z
    .string()
    .trim()
    .min(1, "A reason is required — it is written to the audit log")
    .max(1000),
  /**
   * Days. Omitted means INDEFINITE, which is a real and different decision, not
   * a missing value — hence no default. A default here would quietly turn every
   * "suspend this scammer" into a timed holiday.
   */
  days: z.number().int().min(1).max(3650).optional(),
  reportId: z.string().min(1).max(64).optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireRole("ADMIN")
  if (gate.response) return gate.response
  const actor = gate.actor

  const { id } = await params
  const parsed = await parseJsonBody(req, bodySchema)
  if (!parsed.ok) return parsed.response
  const { action, reason, days, reportId } = parsed.data

  if (action === "unsuspend" && days !== undefined) {
    return invalid("`days` has no meaning when unsuspending")
  }

  // Suspending yourself locks you out of the route that would undo it, and the
  // recovery is a SQL prompt. Cheap to prevent, tedious to recover from.
  if (id === actor.id) {
    return forbidden("You cannot suspend your own account", { code: "SELF_SUSPEND" })
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, name: true, email: true, role: true,
      deletedAt: true, suspendedAt: true, suspendedUntil: true,
    },
  })
  if (!user) return notFound("Account not found")
  if (user.deletedAt) return conflict("That account has been deleted", { code: "ACCOUNT_DELETED" })

  // An ADMIN cannot be suspended through the API at all. Two admins suspending
  // each other is a coin-flip over who controls the platform, and the correct
  // arbiter of that is a person with database access, not whoever clicks first.
  if (user.role === "ADMIN") {
    return forbidden("An admin account cannot be suspended through the API", {
      code: "TARGET_IS_ADMIN",
    })
  }

  const current = suspensionState(user)
  if (action === "suspend" && current.suspended) {
    return conflict("That account is already suspended", {
      code: "ALREADY_SUSPENDED",
      until: current.until,
      indefinite: current.indefinite,
    })
  }
  if (action === "unsuspend" && !current.suspended) {
    return conflict("That account is not suspended", { code: "NOT_SUSPENDED" })
  }

  const now = new Date()
  const until = days === undefined ? null : new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data:
        action === "suspend"
          ? { suspendedAt: now, suspendedUntil: until }
          : // BOTH cleared. suspendedAt alone would leave suspensionState()
            // reading a stale suspendedUntil on the next suspension.
            { suspendedAt: null, suspendedUntil: null },
    })
    await writeAudit(tx, {
      actorId: actor.id,
      action: action === "suspend" ? "USER_SUSPENDED" : "USER_UNSUSPENDED",
      targetType: "USER",
      targetId: id,
      reportId: reportId ?? null,
      reason,
      detail: {
        email: user.email,
        name: user.name,
        // The prior state, so an appeal can see whether this was a first
        // suspension or the fourth. The User row itself keeps no history —
        // this column IS the history.
        previous: {
          suspendedAt: user.suspendedAt,
          suspendedUntil: user.suspendedUntil,
        },
        ...(action === "suspend"
          ? { days: days ?? null, indefinite: days === undefined, until }
          : {}),
      },
    })
  })

  return ok({
    user: {
      id,
      suspendedAt: action === "suspend" ? now : null,
      suspendedUntil: action === "suspend" ? until : null,
      indefinite: action === "suspend" && days === undefined,
    },
    audited: true,
    // Said out loud in the response, because it is the thing a moderator is
    // most likely to assume happened and it did not.
    note:
      action === "suspend"
        ? "Their in-flight trades and any deferred agreements are unaffected — a suspension does not clear a debt."
        : null,
  })
}
