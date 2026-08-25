"use client"

import { getTrustTier, TIER_COLORS } from "@/lib/reputation"
import { getLeafRank } from "@/lib/task-constants"

const STAR_PATH = "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L4.5 9.7l5.9-.9L12 3.5Z"

// Same leaf path as the dashboard ICONS.leaf / Impact card
const LEAF_PATH = "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10ZM2 21c0-3 1.85-5.4 5.1-6"

function LeafIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={LEAF_PATH} />
    </svg>
  )
}

function StarIcon({ size = 12, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={STAR_PATH} />
    </svg>
  )
}

// ── CompactRepBadge ──────────────────────────────────────────────────────────
// One-line badge: ★ 4.8 · 15 trades · Trusted Trader
// Used in item cards, listing detail seller card, offer rows.

interface CompactRepBadgeProps {
  rating:       number
  totalTrades:  number
  ratingCount?: number   // optional — shows "(N)" count if provided
  size?:        "sm" | "md"
}

export function CompactRepBadge({ rating, totalTrades, ratingCount, size = "sm" }: CompactRepBadgeProps) {
  const tier      = getTrustTier(totalTrades, rating)
  const colors    = TIER_COLORS[tier]
  const fontSize  = size === "md" ? 13 : 12
  const dotColor  = "#D1D5DB"

  const hasRating = rating > 0

  if (totalTrades === 0 && !hasRating) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize, color: "#9CA3AF",
      }}>
        <span style={{
          padding: "1px 8px", borderRadius: 999, fontSize: fontSize - 1, fontWeight: 600,
          background: colors.bg, color: colors.text,
        }}>
          {tier}
        </span>
        <span style={{ color: "#9CA3AF", fontSize: fontSize - 1 }}>No ratings yet</span>
      </span>
    )
  }

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize, lineHeight: 1,
    }}>
      {hasRating && (
        <>
          <span style={{ color: "#9A6208", display: "flex", alignItems: "center", gap: 3 }}>
            <StarIcon size={size === "md" ? 14 : 12} filled />
            <span style={{ fontWeight: 700 }}>{rating.toFixed(1)}</span>
            {ratingCount !== undefined && (
              <span style={{ fontWeight: 400, color: "#9CA3AF", fontSize: fontSize - 1 }}>
                ({ratingCount})
              </span>
            )}
          </span>
          <span style={{ color: dotColor }}>·</span>
        </>
      )}
      <span style={{ color: "#6B7280" }}>
        {totalTrades} trade{totalTrades !== 1 ? "s" : ""}
      </span>
      <span style={{ color: dotColor }}>·</span>
      <span style={{
        padding: "1px 7px", borderRadius: 999, fontSize: fontSize - 1, fontWeight: 600,
        background: colors.bg, color: colors.text,
      }}>
        {tier}
      </span>
    </span>
  )
}

// ── TierBadge ─────────────────────────────────────────────────────────────────
// Standalone tier chip used in the full profile panel.

export function TierBadge({ totalTrades, rating }: { totalTrades: number; rating: number }) {
  const tier   = getTrustTier(totalTrades, rating)
  const colors = TIER_COLORS[tier]
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "5px 14px", borderRadius: 999,
      fontSize: 13, fontWeight: 700,
      background: colors.bg, color: colors.text,
      border: `1px solid ${colors.text}22`,
    }}>
      {tier}
    </span>
  )
}

// ── LeafRankBadge ─────────────────────────────────────────────────────────────
// Recognition pill: "65 Leaves · Sprout".
// Keyed on lifetimeLeaves, never on the spendable balance — a user must not
// lose a rank by spending what they earned.
// Geometry matches TierBadge; "sm" matches the CompactRepBadge tier chip.

export function LeafRankBadge({ lifetimeLeaves, size = "md" }: { lifetimeLeaves: number; size?: "sm" | "md" }) {
  const rank = getLeafRank(lifetimeLeaves)
  const sm = size === "sm"
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: sm ? 4 : 6,
      padding: sm ? "1px 7px" : "5px 14px", borderRadius: 999,
      fontSize: sm ? 11 : 13, fontWeight: sm ? 600 : 700,
      background: "rgba(60,113,67,.12)", color: "#3C7143",
      border: "1px solid #3C714322",
    }}>
      <LeafIcon size={sm ? 11 : 13} />
      {lifetimeLeaves} Leaves · {rank.label}
    </span>
  )
}

// ── StarRow ───────────────────────────────────────────────────────────────────
// Read-only 5-star display (used in reviews list).

export function StarRow({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, color: "#9A6208" }}>
      {Array.from({ length: 5 }, (_, i) => (
        <StarIcon key={i} size={size} filled={i < rating} />
      ))}
    </span>
  )
}
