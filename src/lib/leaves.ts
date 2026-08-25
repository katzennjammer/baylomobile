import type { PrismaClient } from "@/generated/prisma/client"

/**
 * Pasa Leaves are non-monetary. They are not bought, they are not pegged to any
 * currency, and the only way they move between users is a completed trade
 * settlement. There is no mint.
 */

/** Minimal shape shared by PrismaClient and an interactive transaction client. */
type LeafDb = Pick<PrismaClient, "user" | "offer">

/**
 * Leaves a user can still commit right now: their Leaf total minus everything
 * already promised to offers that are still PENDING.
 *
 * Both the "make an offer" path and the "accept an offer" path must go through
 * this, otherwise a user can pledge the same leaves to several open offers and
 * over-commit. When re-checking an existing offer, pass its id as
 * `excludeOfferId` so the offer under review is not counted against itself.
 */
export async function availableLeaves(
  db: LeafDb,
  userId: string,
  opts: { excludeOfferId?: string } = {},
): Promise<number> {
  const [user, committed] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { leaves: true } }),
    db.offer.aggregate({
      where: {
        senderId: userId,
        status: "PENDING",
        offeredLeaves: { not: null },
        ...(opts.excludeOfferId ? { id: { not: opts.excludeOfferId } } : {}),
      },
      _sum: { offeredLeaves: true },
    }),
  ])

  // Clamped at 0. This subtraction is what a negative `offeredLeaves` used to
  // exploit: subtracting a negative ADDS, so one pending offer for -1,000,000
  // reported a balance a million Leaves higher than the account held. The
  // schema now refuses negatives at the boundary, and this clamp means that
  // even a negative row already sitting in the table — from before the fix —
  // cannot inflate anything. Both guards, because only one of them protects
  // data that already exists.
  const committedLeaves = Math.max(0, committed._sum.offeredLeaves ?? 0)
  return Math.max(0, (user?.leaves ?? 0) - committedLeaves)
}

/** Display helper — Leaves are whole units and never carry a currency symbol. */
export function formatLeaves(n: number): string {
  return n.toLocaleString("en-US")
}

/**
 * Both Leaf figures a screen needs: the raw balance and the committable one.
 *
 * Exists because availableLeaves() returns only the second, and every screen
 * that shows a balance shows both — asking for them separately means three
 * round trips for two numbers that come from the same two tables.
 *
 * The clamp is the same one, and for the same reason: a negative pending
 * `offeredLeaves` row from before the schema guard must not be able to inflate
 * the available figure by subtracting a negative. Keep the two in step; if the
 * rule above changes, it changes here too.
 */
export async function leafBalances(
  db: LeafDb,
  userId: string,
): Promise<{ leaves: number; available: number }> {
  const [user, committed] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { leaves: true } }),
    db.offer.aggregate({
      where: { senderId: userId, status: "PENDING", offeredLeaves: { not: null } },
      _sum: { offeredLeaves: true },
    }),
  ])
  const leaves = user?.leaves ?? 0
  const committedLeaves = Math.max(0, committed._sum.offeredLeaves ?? 0)
  return { leaves, available: Math.max(0, leaves - committedLeaves) }
}
