export type TrustTier = "New Trader" | "Rising Trader" | "Trusted Trader" | "Top Trader"

// Thresholds:
//   New Trader     : < 3 completed trades
//   Rising Trader  : 3–9 trades  (or 10-24 trades with avg rating < 4.0)
//   Trusted Trader : 10–24 trades + rating ≥ 4.0  (or 25+ with rating < 4.5)
//   Top Trader     : 25+ trades  + rating ≥ 4.5
export function getTrustTier(totalTrades: number, rating: number): TrustTier {
  if (totalTrades < 3) return "New Trader"
  if (totalTrades < 10) return "Rising Trader"
  if (totalTrades < 25) {
    if (rating > 0 && rating < 4.0) return "Rising Trader"
    return "Trusted Trader"
  }
  if (rating > 0 && rating < 4.5) return "Trusted Trader"
  return "Top Trader"
}

export const TIER_COLORS: Record<TrustTier, { bg: string; text: string }> = {
  "New Trader":     { bg: "rgba(156,163,175,.15)", text: "#6B7280" },
  "Rising Trader":  { bg: "rgba(245,158,11,.12)",  text: "#9A6208" },
  "Trusted Trader": { bg: "rgba(60,113,67,.12)",   text: "#3C7143" },
  "Top Trader":     { bg: "rgba(60,113,67,.22)",   text: "#1A3520" },
}
