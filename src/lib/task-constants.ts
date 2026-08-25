// ── Task reward system ───────────────────────────────────────────────────────
// Tasks award Pasa Leaves. Every award writes a LeafTransaction row of type
// TASK_REWARD, so a user's balance is always reconstructable from the ledger.
//
// Two balances, two jobs:
//   User.leaves         — spendable, moves on trades and settlement.
//   User.lifetimeLeaves — monotonic, only ever incremented by a positive award.
//                         Ranks, badges and profile display key off this, so a
//                         user never loses rank by spending what they earned.
//
// VERIFIED_SWAP and SAFEZONE_MEETUP are repeatable (once per trade); the rest
// are one-time. Faucet limits live here too — see WEEKLY_TASK_LEAF_CAP and
// NEW_PARTNER_WINDOW_DAYS.

export type TaskKey =
  | "VERIFY_ACCOUNT"
  | "COMPLETE_PROFILE"
  | "FIRST_LISTING"
  | "VERIFIED_SWAP"
  | "SAFEZONE_MEETUP"

export const TASK_REWARDS: Record<TaskKey, number> = {
  VERIFY_ACCOUNT:   10,
  COMPLETE_PROFILE: 10,
  FIRST_LISTING:    15,
  VERIFIED_SWAP:    20,
  SAFEZONE_MEETUP:  10,
}

export const TASK_ORDER: TaskKey[] = [
  "VERIFY_ACCOUNT",
  "COMPLETE_PROFILE",
  "FIRST_LISTING",
  "VERIFIED_SWAP",
  "SAFEZONE_MEETUP",
]

// ── Faucet limits ────────────────────────────────────────────────────────────

// Maximum Leaves a user can earn from tasks in any rolling 7-day window.
// Enforced server-side by summing that user's positive TASK_REWARD ledger rows
// over the 7 days before the awarding event — the event's own week, not the
// week the award happens to be processed in. An award refused by the cap is
// refused permanently, since a past week can never drop back under it.
// The signup grant is NOT counted against this cap — it is one-time and
// separately gated.
export const WEEKLY_TASK_LEAF_CAP = 100

// VERIFIED_SWAP only awards when the counterparty is someone the user has not
// completed a trade with inside this window. Repeat trades with the same
// partner still complete normally, they just award nothing — otherwise two
// users could swap the same two items back and forth and mint Leaves forever.
export const NEW_PARTNER_WINDOW_DAYS = 30

// One-time grant given at account verification — NOT at registration. That
// distinction is the entire safety property: an ungated grant at signup lets an
// attacker mint Leaves by mass-creating accounts, so the grant is gated behind
// proving control of a Google account (and later a phone number).
//
// Separately gated (User.signupGrantClaimed, one per account) and exempt from
// WEEKLY_TASK_LEAF_CAP — the exemption falls out of it being written as a
// SIGNUP_GRANT ledger row rather than a TASK_REWARD one, which is what the cap
// sums. Paid by markVerified(); see @/lib/verification.
export const SIGNUP_GRANT_LEAVES = 50

// ── Recognition ranks ────────────────────────────────────────────────────────
// Ranked on lifetimeLeaves, never on the spendable balance — otherwise a user
// would drop a rank every time they traded. Display-only, ascending thresholds.
export const LEAF_RANKS = [
  { min: 0,   label: "Seedling" },
  { min: 50,  label: "Sprout" },
  { min: 150, label: "Grower" },
  { min: 300, label: "Guardian" },
] as const

export function getLeafRank(lifetimeLeaves: number): {
  label: string
  next: { label: string; toNext: number } | null
} {
  let idx = 0
  for (let i = 0; i < LEAF_RANKS.length; i++) {
    if (lifetimeLeaves >= LEAF_RANKS[i].min) idx = i
  }
  const next = LEAF_RANKS[idx + 1]
  return {
    label: LEAF_RANKS[idx].label,
    next: next ? { label: next.label, toNext: next.min - lifetimeLeaves } : null,
  }
}

export interface TaskState {
  task:          TaskKey
  done:          boolean
  count:         number   // completions (can exceed 1 for repeatable tasks)
  leavesEarned:  number
}

export interface TasksStatus {
  lifetimeLeaves: number
  leaves:         number
  googleVerified: boolean
  tasks:          TaskState[]
}
