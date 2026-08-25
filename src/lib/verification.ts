import prisma from "@/lib/prisma"
import { SIGNUP_GRANT_LEAVES } from "@/lib/task-constants"
import { awardTask } from "@/lib/tasks"
import { applyEarningsToContracts } from "@/lib/contracts"
import type { PrismaClient } from "@/generated/prisma/client"

type TaskDb = Pick<PrismaClient, "user" | "taskCompletion" | "leafTransaction" | "tradeRequest">

/**
 * The one place an account becomes verified.
 *
 * `User.isVerified` is the whole definition of "verified". It replaced the old
 * `password === null` test, which really meant "signed up with Google and never
 * set a password" — an authentication detail standing in for a trust decision,
 * with no room for any second verification route.
 *
 * Every way of verifying funnels through here: the web Google callback, the
 * native Google token exchange, and phone OTP when it lands. A new route only
 * has to call markVerified() — the award and the grant come with it, and no
 * logic downstream of this function needs to change.
 *
 * Three things happen when the flag flips, and they are deliberately separate
 * from each other:
 *
 *   1. isVerified false -> true.
 *   2. VERIFY_ACCOUNT, through the normal awardTask path — ledger row, both
 *      balances, subject to the weekly cap like any other task.
 *   3. The one-time signup grant, which is NOT a task: separately gated on
 *      signupGrantClaimed and exempt from the weekly cap.
 *
 * Idempotent by construction. Every step is individually guarded, so calling
 * this on an already-verified account is a no-op that credits nothing — 2 by
 * the TaskCompletion unique constraint, 3 by the signupGrantClaimed flag.
 */

export interface VerificationResult {
  /** True only on the call that actually flipped the flag. */
  flipped: boolean
  /** Leaves paid by the signup grant on this call (0 if already claimed). */
  grantAwarded: number
  /** Leaves paid by VERIFY_ACCOUNT on this call (0 if already awarded/capped). */
  taskAwarded: number
}

export async function markVerified(
  userId: string,
  /** The verification moment. Becomes `eventAt` on both ledger rows. */
  at: Date = new Date(),
): Promise<VerificationResult> {
  // 1. Flip. Conditional on the current value so `flipped` reports whether THIS
  //    call did it, rather than whether the row now says true.
  const flip = await prisma.user.updateMany({
    where: { id: userId, isVerified: false },
    data: { isVerified: true },
  })
  const flipped = flip.count === 1

  // 2. VERIFY_ACCOUNT via the normal award path. Its own transaction: an award
  //    that hits the weekly cap must not roll back the verification itself.
  //    eventAt is this moment — the account became verified now, which is a
  //    real event, unlike the account-creation stand-in reconcileTasks() has to
  //    use when backfilling an account that verified before this code existed.
  let taskAwarded = 0
  try {
    const res = await prisma.$transaction(async (tx) => {
      const awarded = await awardTask(tx as TaskDb, userId, "VERIFY_ACCOUNT", "", {
        description: "Task reward: verified your account",
        eventAt: at,
      })
      // Earned Leaves go to an open deferred agreement first — rule 4. In the
      // same transaction as the award, so the balance and the debt never
      // disagree between two commits.
      if (awarded.awarded > 0) await applyEarningsToContracts(tx, userId)
      return awarded
    })
    taskAwarded = res.awarded
  } catch {
    // Best-effort, exactly like every other award site: reconcileTasks() is
    // still there to catch a miss. Verification itself must not fail over it.
  }

  // 3. The signup grant.
  const grantAwarded = await claimSignupGrant(userId, at)

  return { flipped, grantAwarded, taskAwarded }
}

/**
 * Credits SIGNUP_GRANT_LEAVES exactly once per account.
 *
 * The concurrency guard is the WHERE clause, not a read-then-write. Two
 * simultaneous verifications both issue the same conditional UPDATE; InnoDB
 * serialises them on the row, and the second one re-reads the committed value
 * and matches nothing. Only the update that reports count === 1 writes a ledger
 * row, so a double credit is not merely unlikely — it cannot be expressed.
 *
 * Reading the flag first and then updating would be the bug this avoids: both
 * requests would read false, and both would pay.
 */
async function claimSignupGrant(userId: string, at: Date): Promise<number> {
  if (SIGNUP_GRANT_LEAVES <= 0) return 0

  return prisma.$transaction(async (tx) => {
    // The flag and both balances move in ONE statement, so the claim and the
    // credit cannot come apart.
    const claimed = await tx.user.updateMany({
      where: { id: userId, isVerified: true, signupGrantClaimed: false },
      data: {
        signupGrantClaimed: true,
        leaves: { increment: SIGNUP_GRANT_LEAVES },
        lifetimeLeaves: { increment: SIGNUP_GRANT_LEAVES },
      },
    })
    if (claimed.count !== 1) return 0

    // Same transaction: the balance and the ledger row that explains it are
    // never observable apart, which is what keeps SUM(User.leaves) equal to the
    // sum of positive ledger rows.
    await tx.leafTransaction.create({
      data: {
        userId,
        type: "SIGNUP_GRANT",
        amount: SIGNUP_GRANT_LEAVES,
        description: "Signup grant",
        eventAt: at,
      },
    })

    // The grant is Leaves earned, so it settles debt like any other earning.
    // In practice a brand-new account has no contracts to settle -- a debtor
    // needs three completed trades -- but the rule is "every credit sweeps",
    // and an exception here would be one more place for that to stop being true.
    await applyEarningsToContracts(tx, userId)

    return SIGNUP_GRANT_LEAVES
  })
}
