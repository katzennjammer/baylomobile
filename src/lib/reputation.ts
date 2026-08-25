import {
  TIER_THRESHOLDS,
  TIER_LIMITS,
  DEFAULT_PENALTY,
  type TierLimits,
} from "@/lib/reputation-config"

export type TrustTier = "New Trader" | "Rising Trader" | "Trusted Trader" | "Top Trader"

/**
 * The tiers, worst to best. Order is load-bearing: demoteTier() indexes into it.
 */
export const TIER_ORDER: readonly TrustTier[] = [
  "New Trader",
  "Rising Trader",
  "Trusted Trader",
  "Top Trader",
] as const

/**
 * The BASE tier — what a user's trade history alone says about them.
 *
 * Unchanged behaviour; the literals now live in TIER_THRESHOLDS. The branch
 * structure is kept verbatim rather than rewritten as a threshold scan, because
 * the ladder is not monotone in rating (25 trades at 3.5 reads Trusted, 15
 * trades at 3.5 reads Rising) and a tidier scan would silently change who sits
 * where.
 *
 * `rating === 0` means unrated, not badly rated, and never blocks a promotion.
 */
export function getTrustTier(totalTrades: number, rating: number): TrustTier {
  const T = TIER_THRESHOLDS
  if (totalTrades < T.risingMinTrades) return "New Trader"
  if (totalTrades < T.trustedMinTrades) return "Rising Trader"
  if (totalTrades < T.topMinTrades) {
    if (rating > 0 && rating < T.trustedMinRating) return "Rising Trader"
    return "Trusted Trader"
  }
  if (rating > 0 && rating < T.topMinRating) return "Trusted Trader"
  return "Top Trader"
}

/** Moves a tier down `steps` rungs, floored at the bottom of the ladder. */
export function demoteTier(tier: TrustTier, steps: number): TrustTier {
  if (steps <= 0) return tier
  const idx = TIER_ORDER.indexOf(tier)
  return TIER_ORDER[Math.max(0, idx - steps)]
}

/**
 * The EFFECTIVE tier — the base tier after DPA defaults are charged against it.
 *
 * This, not getTrustTier(), is what the gates consult. Two distinct penalties,
 * because settling a late debt should buy back something but not everything:
 *
 *   unsettled default → pinned to the floor tier while it stands
 *   every default ever → one rung, permanently, paid off or not
 *
 * Derived on every call from the caller's own counts. Nothing is stored, so
 * nothing can drift and no sweep can charge the same default twice.
 */
export function getEffectiveTier(
  totalTrades: number,
  rating: number,
  opts: { lifetimeDefaults?: number; hasUnsettledDefault?: boolean } = {},
): TrustTier {
  const base = getTrustTier(totalTrades, rating)
  const { lifetimeDefaults = 0, hasUnsettledDefault = false } = opts

  if (hasUnsettledDefault && DEFAULT_PENALTY.unsettledDefaultFloorsTier) {
    return TIER_ORDER[0]
  }
  return demoteTier(base, lifetimeDefaults * DEFAULT_PENALTY.tierStepsPerDefault)
}

/** What a tier permits. The table itself lives in @/lib/reputation-config. */
export function getTierLimits(tier: TrustTier): TierLimits {
  return TIER_LIMITS[tier]
}

export type { TierLimits }

export const TIER_COLORS: Record<TrustTier, { bg: string; text: string }> = {
  "New Trader":     { bg: "rgba(156,163,175,.15)", text: "#6B7280" },
  "Rising Trader":  { bg: "rgba(245,158,11,.12)",  text: "#9A6208" },
  "Trusted Trader": { bg: "rgba(60,113,67,.12)",   text: "#3C7143" },
  "Top Trader":     { bg: "rgba(60,113,67,.22)",   text: "#1A3520" },
}
