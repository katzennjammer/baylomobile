// ── Reputation gates ─────────────────────────────────────────────────────────
// Every threshold and every limit the trust tiers impose, in one file, so they
// can be tuned without reading a single route handler.
//
// Two halves, and the split matters:
//
//   TIER_THRESHOLDS  — how a tier is DERIVED (trades + rating). These were
//                      previously inline literals in getTrustTier(), where the
//                      tier was display-only and nothing depended on the
//                      numbers being findable.
//   TIER_LIMITS      — what a tier PERMITS. New. This is the half that turns a
//                      badge into a control.
//
// Nothing here enforces anything. Enforcement lives in @/lib/reputation-gate
// and is called from the route handlers, because a limit that is only consulted
// by the UI is not a limit — the client is not a trusted participant.

import type { TrustTier } from "@/lib/reputation"

// ── Tier derivation ──────────────────────────────────────────────────────────
//
// Preserved EXACTLY as getTrustTier() has always computed it, literals lifted
// out and named. Two properties are easy to lose when tuning these, so they are
// written down:
//
//   1. An UNRATED user (rating === 0, i.e. no reviews yet) is never held back
//      by a rating floor. Zero means "unknown", not "terrible".
//   2. The ladder is not monotone in rating. At 25+ trades a 3.5 rating still
//      reads Trusted, while at 15 trades it reads Rising. That is the shipped
//      behaviour and this refactor does not quietly change it.
export const TIER_THRESHOLDS = {
  /** Completed trades needed to leave "New Trader". Also the DPA debtor floor. */
  risingMinTrades: 3,
  trustedMinTrades: 10,
  topMinTrades: 25,
  /** Rating floors. Ignored entirely while a user has no reviews at all. */
  trustedMinRating: 4.0,
  topMinRating: 4.5,
} as const

// ── What a tier permits ──────────────────────────────────────────────────────

export interface TierLimits {
  /**
   * The most valuable item (Item.valueLeaves) this tier may ACQUIRE in a trade,
   * whether by initiating one or by accepting one. `null` is unlimited.
   *
   * Applied to the item the user RECEIVES, never the one they give away — the
   * exposure being capped is the counterparty's, not theirs.
   */
  maxItemValueLeaves: number | null
  /** Whether this tier may propose a Deferred Points Agreement as the debtor. */
  mayProposeDpa: boolean
  /**
   * Ceiling on this tier's total unpaid DPA principal at any moment, summed
   * across every contract that is not yet settled. `0` means no debt at all,
   * which is what makes mayProposeDpa: false redundant-but-explicit at the
   * bottom tier.
   */
  maxOutstandingDebtLeaves: number
}

/**
 * The tier table. Tune freely — nothing reads these numbers except
 * @/lib/reputation-gate, and nothing caches them.
 *
 * The shape of the ladder, if not the exact numbers: a New Trader can neither
 * owe nor reach for anything expensive, because they have no history to lose.
 * Every tier above them buys a larger cap with completed trades, which is the
 * only currency the gates accept.
 */
export const TIER_LIMITS: Record<TrustTier, TierLimits> = {
  "New Trader": {
    maxItemValueLeaves: 200,
    mayProposeDpa: false,
    maxOutstandingDebtLeaves: 0,
  },
  "Rising Trader": {
    maxItemValueLeaves: 600,
    mayProposeDpa: true,
    maxOutstandingDebtLeaves: 150,
  },
  "Trusted Trader": {
    maxItemValueLeaves: 2000,
    mayProposeDpa: true,
    maxOutstandingDebtLeaves: 500,
  },
  "Top Trader": {
    maxItemValueLeaves: null,
    mayProposeDpa: true,
    maxOutstandingDebtLeaves: 1500,
  },
}

// ── Default consequences ─────────────────────────────────────────────────────
//
// A default costs reputation and access. It never costs the item — see the note
// at the head of @/lib/contracts.
//
// The penalty is DERIVED from the contract rows rather than stamped onto the
// User row, and that is a deliberate choice with two reasons. First, the one
// obvious place to put it (User.rating) is recomputed from the review average
// on every new review, so a decrement there would be silently erased by the
// next 5-star rating. Second, a derived penalty cannot be double-applied, which
// is the exact failure the lazy deadline sweep is most likely to produce.

export const DEFAULT_PENALTY = {
  /**
   * Tier steps lost per default, counted over the user's whole history —
   * including defaults they later paid off. The default happened; paying late
   * settles the debt, not the record.
   */
  tierStepsPerDefault: 1,
  /**
   * While a default is UNSETTLED the user is pinned to the floor tier outright,
   * regardless of trade count. Paying it off releases the pin and leaves only
   * the per-default demotion above.
   */
  unsettledDefaultFloorsTier: true,
} as const

// ── Deferred Points Agreement ────────────────────────────────────────────────

export const DPA = {
  /**
   * Completed trades required before a user may be a DEBTOR. Not a tier lookup:
   * this is a hard floor checked on its own, so lowering a tier threshold can
   * never accidentally let a two-trade account borrow.
   *
   * Counted from COMPLETED TradeRequest rows, never from User.totalTrades —
   * that counter has drifted above the real count on live data.
   */
  minCompletedTradesToOwe: 3,
  /**
   * Contracts a debtor may hold in a non-terminal state at once. One, and it
   * counts PENDING_ACCEPT as well as ACTIVE and DEFAULTED — otherwise a debtor
   * stacks five proposals under the cap and blows through it the moment the
   * fifth creditor accepts.
   */
  maxConcurrentAsDebtor: 1,
  /** Bounds on the term a debtor may propose, in days from proposal. */
  minTermDays: 1,
  maxTermDays: 30,
  /** The one extension, if the creditor grants it. Days past the old deadline. */
  minExtensionDays: 1,
  maxExtensionDays: 14,
} as const
