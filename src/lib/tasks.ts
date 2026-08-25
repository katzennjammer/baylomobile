import type { PrismaClient } from "@/generated/prisma/client"
import prisma from "@/lib/prisma"
import {
  TASK_REWARDS,
  TASK_ORDER,
  WEEKLY_TASK_LEAF_CAP,
  NEW_PARTNER_WINDOW_DAYS,
  type TaskKey,
  type TasksStatus,
} from "@/lib/task-constants"

/**
 * Tasks award Pasa Leaves. Every award is a single transaction that writes a
 * TASK_REWARD LeafTransaction row AND increments both `leaves` (spendable) and
 * `lifetimeLeaves` (monotonic, what ranks key off). The balance is therefore
 * always reconstructable from the ledger.
 *
 * Awards happen at the moment the triggering action completes — see the call
 * sites in the trade settlement, POST /api/items and PATCH /api/user.
 * `reconcileTasks()` remains as a backfill, not the primary path.
 */

/** Minimal shape shared by PrismaClient and an interactive transaction client. */
type TaskDb = Pick<PrismaClient, "user" | "taskCompletion" | "leafTransaction" | "tradeRequest">

const DAY_MS = 24 * 60 * 60 * 1000

export interface AwardResult {
  awarded: number
  reason:  "awarded" | "already_awarded" | "weekly_cap" | "repeat_partner" | "error"
}

const nothing = (reason: AwardResult["reason"]): AwardResult => ({ awarded: 0, reason })

/**
 * Leaves this user had already earned from tasks in the 7 days BEFORE
 * `eventAt` — the window the awarding event itself falls in, not the window
 * around wall-clock now.
 *
 * Sums positive TASK_REWARD ledger rows over their `eventAt` — when the action
 * that earned them happened — never their `createdAt`, which is when the row
 * was written. That distinction is the whole point: windowing on write time
 * would collapse a backfill of years of history into a single week.
 *
 * The ledger, not the balance, is the source of truth, so spending Leaves
 * cannot reopen the faucet.
 *
 * The signup grant is deliberately not a TASK_REWARD row and so is exempt.
 */
export async function taskLeavesEarnedInWindow(
  db: TaskDb,
  userId: string,
  eventAt: Date = new Date(),
): Promise<number> {
  const agg = await db.leafTransaction.aggregate({
    where: {
      userId,
      type:      "TASK_REWARD",
      amount:    { gt: 0 },
      eventAt:   { gte: new Date(eventAt.getTime() - 7 * DAY_MS), lte: eventAt },
    },
    _sum: { amount: true },
  })
  return agg._sum.amount ?? 0
}

/**
 * True when `partnerId` is someone `userId` had NOT completed a trade with in
 * the NEW_PARTNER_WINDOW_DAYS before `tradeAt`, ignoring `exceptTradeId` (the
 * trade being awarded). Without this, two users can swap the same two items
 * back and forth forever and mint unlimited Leaves.
 *
 * The window is anchored to the trade being awarded, NOT to wall-clock now.
 * Live that makes no difference (the trade is settling as we speak), but it is
 * what makes the backfill correct: a repeat pair must still score zero when it
 * is reconciled months later, otherwise simply waiting out the window turns the
 * faucet back on for every historical trade.
 */
export async function isNewTradePartner(
  db: TaskDb,
  userId: string,
  partnerId: string,
  exceptTradeId?: string,
  tradeAt: Date = new Date(),
): Promise<boolean> {
  const prior = await db.tradeRequest.findFirst({
    where: {
      status:    "COMPLETED",
      updatedAt: { gte: new Date(tradeAt.getTime() - NEW_PARTNER_WINDOW_DAYS * DAY_MS), lt: tradeAt },
      ...(exceptTradeId ? { id: { not: exceptTradeId } } : {}),
      OR: [
        { senderId: userId,    receiverId: partnerId },
        { senderId: partnerId, receiverId: userId },
      ],
    },
    select: { id: true },
  })
  return prior === null
}

/**
 * Award one task. Idempotent via the @@unique([userId, task, refId]) constraint
 * on TaskCompletion — that constraint is the thing that makes one-time tasks
 * one-time, so it must not be relaxed.
 *
 * Never throws: a duplicate, a hit cap or a repeat partner all return
 * `awarded: 0`. Safe to call from inside a settlement transaction, where an
 * exception would roll back the trade itself.
 *
 * Both zero-value outcomes (repeat_partner, weekly_cap) write a 0-leaf
 * completion row. Each is judged against the week the event happened in, and a
 * past week never re-opens, so the denial is final by construction — recording
 * it is what stops a later reconcile from paying out an award that the rules
 * already refused.
 */
export async function awardTask(
  db: TaskDb,
  userId: string,
  task: TaskKey,
  refId = "",
  opts: {
    partnerId?: string
    tradeId?: string
    description?: string
    tradeAt?: Date
    /** When the triggering action actually happened. Defaults to now (the live
     *  path); the backfill passes the real event time so both faucet guards see
     *  the week the award was earned in. */
    eventAt?: Date
  } = {},
): Promise<AwardResult> {
  const amount = TASK_REWARDS[task]
  const eventAt = opts.eventAt ?? new Date()

  try {
    const existing = await db.taskCompletion.findUnique({
      where:  { userId_task_refId: { userId, task, refId } },
      select: { id: true },
    })
    if (existing) return nothing("already_awarded")

    // Faucet guard 1 — VERIFIED_SWAP only pays for a genuinely new counterparty.
    if (task === "VERIFIED_SWAP" && opts.partnerId) {
      const fresh = await isNewTradePartner(db, userId, opts.partnerId, opts.tradeId ?? refId, opts.tradeAt ?? eventAt)
      if (!fresh) {
        // Record the zero so this trade is never revisited.
        await db.taskCompletion.create({ data: { userId, task, refId, leaves: 0 } })
        return nothing("repeat_partner")
      }
    }

    // Faucet guard 2 — weekly ceiling, measured over the event's own week.
    // Anchored to eventAt for the same reason guard 1 is: a week that is
    // already over the cap is in the past and can never re-open, so an award
    // denied here is denied for good. Were this measured from wall-clock now,
    // a user could cram a year of events into one week and still collect every
    // Leaf simply by coming back seven days later.
    const earned = await taskLeavesEarnedInWindow(db, userId, eventAt)
    if (earned + amount > WEEKLY_TASK_LEAF_CAP) {
      // Record the zero so the denial is permanent, exactly as for a repeat
      // partner. Without this row the award is merely deferred and the cap
      // throttles the faucet instead of closing it.
      await db.taskCompletion.create({ data: { userId, task, refId, leaves: 0 } })
      return nothing("weekly_cap")
    }

    // The completion row, the ledger entry and both balances move together.
    // The ledger row records both timestamps: createdAt is left to default to
    // now (when this row was written) and eventAt carries when the action that
    // earned it happened. On the live path they coincide; on a backfill they
    // do not, and conflating them would lose half the audit trail.
    await db.taskCompletion.create({ data: { userId, task, refId, leaves: amount } })
    await db.leafTransaction.create({
      data: {
        userId,
        type:        "TASK_REWARD",
        amount,
        description: opts.description ?? `Task reward: ${task}`,
        tradeId:     opts.tradeId ?? null,
        eventAt,
      },
    })
    await db.user.update({
      where: { id: userId },
      data:  { leaves: { increment: amount }, lifetimeLeaves: { increment: amount } },
    })

    return { awarded: amount, reason: "awarded" }
  } catch {
    // P2002 — a concurrent request already awarded it. MySQL rolls back only the
    // failing statement, so an enclosing settlement transaction is unaffected.
    return nothing("error")
  }
}

/**
 * Fire-and-forget wrapper for award sites that must never affect the response.
 * Runs its own transaction so the award stays atomic.
 */
export function awardTaskAsync(
  userId: string,
  task: TaskKey,
  refId = "",
  opts: { partnerId?: string; tradeId?: string; description?: string; tradeAt?: Date; eventAt?: Date } = {},
): void {
  void prisma
    .$transaction((tx) => awardTask(tx as TaskDb, userId, task, refId, opts))
    .catch(() => { /* awards are best-effort; the backfill catches misses */ })
}

// ── Backfill ─────────────────────────────────────────────────────────────────

/**
 * Reconciles a user's task completions against current DB state and returns the
 * up-to-date checklist. This used to be the only award path; awards are now
 * event-driven and this is a backfill for anything an event site missed (and
 * for awards that were deferred by the weekly cap). Called from GET /api/tasks.
 *
 * Award rules:
 *   VERIFY_ACCOUNT   — verified accounts only (User.isVerified). Set by Google
 *                      sign-in today and by phone OTP later; this rule does not
 *                      care which. Never awarded for merely having a password.
 *   COMPLETE_PROFILE — avatar, bio and location all filled in.
 *   FIRST_LISTING    — has listed at least one item.
 *   VERIFIED_SWAP    — once per COMPLETED trade, new counterparty only.
 *   SAFEZONE_MEETUP  — once per COMPLETED trade flagged safeZoneMeetup.
 */
export async function reconcileTasks(userId: string): Promise<TasksStatus | null> {
  const [user, firstItem, completedTrades, existing] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: userId },
      select: { isVerified: true, avatar: true, bio: true, location: true, createdAt: true, updatedAt: true },
    }),
    // The first listing's own date is this task's event time.
    prisma.item.findFirst({
      where: { userId }, orderBy: { createdAt: "asc" }, select: { createdAt: true },
    }),
    prisma.tradeRequest.findMany({
      where:  { OR: [{ senderId: userId }, { receiverId: userId }], status: "COMPLETED" },
      select: { id: true, safeZoneMeetup: true, senderId: true, receiverId: true, updatedAt: true },
    }),
    prisma.taskCompletion.findMany({
      where:  { userId },
      select: { task: true, refId: true },
    }),
  ])
  if (!user) return null

  const googleVerified = user.isVerified
  const profileComplete =
    !!user.avatar?.trim() && !!user.bio?.trim() && !!user.location?.trim()

  // Every eligible award carries the timestamp of the action that earned it, so
  // both faucet guards judge it against the week it actually happened in.
  // VERIFY_ACCOUNT has no event of its own — the account's creation is the
  // closest honest stand-in; COMPLETE_PROFILE uses the last profile edit.
  const eligible: { task: TaskKey; refId: string; partnerId?: string; eventAt: Date }[] = []
  if (googleVerified)   eligible.push({ task: "VERIFY_ACCOUNT",   refId: "", eventAt: user.createdAt })
  if (profileComplete)  eligible.push({ task: "COMPLETE_PROFILE", refId: "", eventAt: user.updatedAt })
  if (firstItem)        eligible.push({ task: "FIRST_LISTING",    refId: "", eventAt: firstItem.createdAt })
  for (const t of completedTrades) {
    const partnerId = t.senderId === userId ? t.receiverId : t.senderId
    eligible.push({ task: "VERIFIED_SWAP", refId: t.id, partnerId, eventAt: t.updatedAt })
    if (t.safeZoneMeetup) eligible.push({ task: "SAFEZONE_MEETUP", refId: t.id, eventAt: t.updatedAt })
  }

  const have = new Set(existing.map((c) => `${c.task}:${c.refId}`))
  const missing = eligible
    .filter((e) => !have.has(`${e.task}:${e.refId}`))
    // Chronological order matters: each award's weekly window includes the
    // awards before it, so filling buckets out of order would make the outcome
    // depend on query order rather than on history. Earliest event wins.
    .sort((x, y) => x.eventAt.getTime() - y.eventAt.getTime())

  for (const m of missing) {
    await prisma.$transaction((tx) =>
      awardTask(tx as TaskDb, userId, m.task, m.refId, {
        partnerId: m.partnerId,
        tradeId:   m.refId || undefined,
        tradeAt:   m.eventAt,
        eventAt:   m.eventAt,
      }),
    )
  }

  return buildTasksStatus(userId, googleVerified)
}

/** Reads the current checklist straight out of the DB — no awarding. */
export async function buildTasksStatus(
  userId: string,
  googleVerified?: boolean,
): Promise<TasksStatus | null> {
  const [user, completions] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: userId },
      select: { leaves: true, lifetimeLeaves: true, isVerified: true },
    }),
    prisma.taskCompletion.findMany({
      where:  { userId },
      select: { task: true, leaves: true },
    }),
  ])
  if (!user) return null

  const byTask = new Map<string, { count: number; leavesEarned: number }>()
  for (const c of completions) {
    const cur = byTask.get(c.task) ?? { count: 0, leavesEarned: 0 }
    cur.count += 1
    cur.leavesEarned += c.leaves
    byTask.set(c.task, cur)
  }

  return {
    lifetimeLeaves: user.lifetimeLeaves,
    leaves:         user.leaves,
    googleVerified: googleVerified ?? user.isVerified,
    tasks: TASK_ORDER.map((task) => {
      const agg = byTask.get(task)
      return {
        task,
        done:         (agg?.count ?? 0) > 0,
        count:        agg?.count ?? 0,
        leavesEarned: agg?.leavesEarned ?? 0,
      }
    }),
  }
}
