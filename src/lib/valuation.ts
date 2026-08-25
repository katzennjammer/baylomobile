/**
 * The valuation model. One file, no network calls, no model inference.
 *
 * WHAT THIS IS AND IS NOT
 * ----------------------------------------------------------------------------
 * Baylo's listing valuation is a STATISTICAL model, not a language model. The
 * only AI in the listing flow is /api/ai/identify, which reads a photo and
 * returns a category and a condition. Those two labels are the input here; the
 * number comes out of the tables below and nothing else.
 *
 * That split is deliberate and it is the defensible one. An LLM asked to price
 * "black iPhone, screen cracked" can answer 1,800 Leaves on one call and 2,300
 * on the next — same prompt, same item, different number, because sampling is
 * stochastic. A marketplace cannot tell a user their listing is worth X and
 * then tell the next user the identical item is worth Y. Everything below is
 * pure arithmetic over fixed constants and stored rows: same inputs, same
 * output, every time, and every number traceable to a named constant or a real
 * settled trade.
 *
 * THE TWO PATHS
 * ----------------------------------------------------------------------------
 * A valuation resolves by one of exactly two paths, and which one ran is
 * recorded on the Item as `valuationSource`:
 *
 *   "comparables"     >= MIN_COMPARABLES settled Baylo items in this category
 *                     carried a price. The suggestion is derived from them.
 *   "category_band"   fewer than that. The suggestion comes from CATEGORY_BANDS.
 *
 * There is no third path and no silent fallback inside a path: valueItem()
 * always reports which of the two produced the number it returned.
 */

import type { CATEGORY_VALUES, CONDITION_VALUES } from "@/lib/validation"

export type Category = (typeof CATEGORY_VALUES)[number]
export type Condition = (typeof CONDITION_VALUES)[number]

/**
 * Which path produced a value.
 *
 * Stored on Item.valuationSource as exactly these strings, so the question
 * "how many listings were actually valued from comparables?" is one GROUP BY
 * and not an inference from other columns. Kept as a string union rather than
 * a Prisma enum because the same two literals travel on the wire to clients,
 * and a wire value that is generated from a DB enum name is a value that
 * changes when someone renames the enum.
 */
export const VALUATION_SOURCES = ["comparables", "category_band"] as const
export type ValuationSource = (typeof VALUATION_SOURCES)[number]

export const isValuationSource = (v: unknown): v is ValuationSource =>
  typeof v === "string" && (VALUATION_SOURCES as readonly string[]).includes(v)

// ── Tuning constants ─────────────────────────────────────────────────────────

/**
 * How many priced, settled items a category needs before its own trade history
 * outweighs the band table.
 *
 * Three is the floor at which a mean is worth more than a prior, not a
 * statistically comfortable number. It is stated here rather than buried in a
 * query so that raising it is a one-line, reviewable change.
 */
export const MIN_COMPARABLES = 3

/** Never average over more than this many rows; keeps the query bounded. */
export const MAX_COMPARABLES = 100

/**
 * How far a user may move the final value away from the suggestion, either way.
 *
 * The slider is not removed and must not be: in barter the two parties decide
 * what a thing is worth to them, and a platform that fixes the number by fiat
 * is not running a barter market. What the band does is stop the suggestion
 * from being decorative. At 0.25 a 1,000-Leaf suggestion may be listed at
 * anything from 750 to 1,250 — real room to disagree with the model, not enough
 * room for the model to be irrelevant.
 */
export const OVERRIDE_BAND_PCT = 0.25

/**
 * Re-valuations allowed per listing, after the first.
 *
 * The first valuation of a listing is free — it is how the listing gets a
 * number at all. Past that, re-running the model on the same listing can only
 * be an attempt to shop for a friendlier suggestion, and since the model is
 * deterministic the only way the number moves is if the user edits the category
 * or condition to something less true. One is enough for an honest correction.
 */
export const MAX_REVALUATIONS = 1

// ── Condition ────────────────────────────────────────────────────────────────

/**
 * Condition multipliers, anchored at GOOD = 1.00.
 *
 * Until this table existed, condition was collected on every listing, stored on
 * every row, and read by nothing in the valuation path: a mint phone and a
 * cracked one in the same category got the identical suggestion. That is not a
 * defensible valuation, it is a category lookup wearing a valuation's name.
 *
 * GOOD is the anchor because CATEGORY_BANDS below describes the ordinary
 * secondhand item — used, working, unremarkable — which is what GOOD means. The
 * other four scale from it. The spread (0.45 to 1.40, about 3x end to end) is
 * chosen to be the same order as the observed secondhand gap between a mint and
 * a damaged unit of the same model; it is a stated assumption of the model, not
 * a measurement, and it is here in one place so a panelist can see the number
 * being assumed rather than have to infer it.
 */
export const CONDITION_MULTIPLIERS: Record<Condition, number> = {
  NEW:      1.40,
  LIKE_NEW: 1.20,
  GOOD:     1.00,
  FAIR:     0.70,
  POOR:     0.45,
}

/** GOOD. The condition CATEGORY_BANDS is expressed in. */
export const BAND_REFERENCE_CONDITION: Condition = "GOOD"

const conditionMultiplier = (c: string): number =>
  CONDITION_MULTIPLIERS[c as Condition] ?? CONDITION_MULTIPLIERS[BAND_REFERENCE_CONDITION]

// ── Category bands ───────────────────────────────────────────────────────────

/**
 * Typical secondhand worth per category, in Pasa Leaves, for an item in GOOD
 * condition.
 *
 * Leaves are a non-monetary trade unit — these are relative worth, not prices.
 * This table is the SINGLE source of truth for the bands. It used to live in
 * the route handler; it lives here so that the route, the item-create guard and
 * the verification harness all read the same numbers, and so that there is
 * exactly one file to point at when asked where the numbers come from.
 *
 * No client keeps a copy. The web wizard reads the endpoint.
 */
export const CATEGORY_BANDS: Record<Category, readonly [number, number]> = {
  ELECTRONICS:  [100, 4000],  CLOTHING:    [30, 600],    BAGS:      [40, 1600],
  BEAUTY:       [20, 1000],   ACCESSORIES: [40, 2000],   FURNITURE: [100, 3000],
  BOOKS:        [15, 200],    GAMING:      [100, 4000],  SPORTS:    [60, 3000],
  BIKES:        [200, 6000],  TOYS:        [20, 600],    TOOLS:     [40, 2000],
  MUSIC:        [100, 6000],  ART:         [40, 1000],   COLLECTIBLES: [20, 2000],
  PETS:         [20, 600],    PLANTS:      [20, 400],    FOOD:      [10, 100],
  SERVICES:     [100, 2000],  OTHER:       [20, 1000],
}

/** For a category outside the enum. Should be unreachable; not a crash if not. */
export const FALLBACK_BAND: readonly [number, number] = [1, 40]

const bandFor = (category: string): readonly [number, number] =>
  CATEGORY_BANDS[category as Category] ?? FALLBACK_BAND

// ── The model ────────────────────────────────────────────────────────────────

/** One settled item feeding the comparables path. */
export interface Comparable {
  valueLeaves: number
  condition: string
}

export interface ValuationInput {
  category: string
  condition: string
  /**
   * Priced, settled items in this category. Pass every row found; the model
   * decides whether there are enough to use them. An empty array is normal and
   * simply resolves to the band path.
   */
  comparables: readonly Comparable[]
}

export interface Valuation {
  /** The model's number. What the user sees pre-filled. */
  suggestedLeaves: number
  /** Low end of the suggested range, condition-adjusted. */
  min: number
  /** High end of the suggested range, condition-adjusted. */
  max: number
  /** Which of the two paths produced suggestedLeaves. Recorded on the Item. */
  valuationSource: ValuationSource
  /** How many settled items fed the comparables path. 0 on the band path. */
  sampleSize: number
  /** Bounds the user's final value must fall inside. Enforced server-side. */
  allowed: { min: number; max: number }
}

/**
 * Round half away from zero, deterministically.
 *
 * Math.round() breaks ties toward +Infinity, so -0.5 and 0.5 round in opposite
 * directions. Every value here is non-negative so that asymmetry never bites,
 * but the model's whole claim is determinism and a rounding rule that depends
 * on sign is not worth defending in a viva.
 */
const round = (n: number): number => Math.floor(n + 0.5)

/**
 * The allowed override band around a suggestion.
 *
 * Exported because three call sites need the identical arithmetic: the endpoint
 * that tells the client what the slider bounds are, the create/update guard
 * that rejects a value outside them, and the harness that checks the two agree.
 * Computing it twice is how a client slider ends up able to select a value the
 * server then refuses.
 */
export function overrideBounds(suggestedLeaves: number): { min: number; max: number } {
  return {
    // Floor of 1: a suggestion of 1-2 Leaves would otherwise permit 0, and 0 is
    // the sentinel for "no value" everywhere else in the codebase.
    min: Math.max(1, round(suggestedLeaves * (1 - OVERRIDE_BAND_PCT))),
    max: round(suggestedLeaves * (1 + OVERRIDE_BAND_PCT)),
  }
}

/** Is `finalValue` an acceptable user override of `suggestedLeaves`? */
export function isWithinOverrideBand(finalValue: number, suggestedLeaves: number): boolean {
  const { min, max } = overrideBounds(suggestedLeaves)
  return finalValue >= min && finalValue <= max
}

/**
 * Value one item. Pure: no I/O, no clock, no randomness.
 *
 * COMPARABLES PATH. Each settled comparable is first divided by its OWN
 * condition multiplier, which converts it to what that item would have been
 * worth in GOOD condition. The mean of those normalised figures is the
 * category's observed GOOD-condition worth; multiplying it by the subject
 * item's multiplier gives the subject's suggestion. Skipping the normalisation
 * would make the suggestion depend on the condition mix of whatever happened to
 * sell — three mint sales would push every subsequent cracked item up — and
 * would leave condition affecting the band path but not this one.
 *
 * BAND PATH. The band midpoint is the GOOD-condition figure by construction, so
 * it is multiplied directly.
 *
 * In both paths min and max are the same scaling applied to the ends of the
 * distribution, so the range moves with condition rather than staying pinned to
 * the category while only the midpoint slides inside it.
 */
export function valueItem(input: ValuationInput): Valuation {
  const mult = conditionMultiplier(input.condition)

  // Only priced rows count. A 0 or negative valueLeaves is "unpriced", not
  // "worthless", and averaging it in would drag the whole category down.
  const usable = input.comparables.filter((c) => c.valueLeaves > 0)

  let baseMid: number
  let baseLow: number
  let baseHigh: number
  let valuationSource: ValuationSource
  let sampleSize: number

  if (usable.length >= MIN_COMPARABLES) {
    const normalised = usable
      .slice(0, MAX_COMPARABLES)
      .map((c) => c.valueLeaves / conditionMultiplier(c.condition))

    baseMid = normalised.reduce((a, b) => a + b, 0) / normalised.length
    baseLow = Math.min(...normalised)
    baseHigh = Math.max(...normalised)
    valuationSource = "comparables"
    sampleSize = normalised.length
  } else {
    const [lo, hi] = bandFor(input.category)
    baseMid = (lo + hi) / 2
    baseLow = lo
    baseHigh = hi
    valuationSource = "category_band"
    sampleSize = 0
  }

  const suggestedLeaves = Math.max(1, round(baseMid * mult))
  const min = Math.max(1, round(baseLow * mult))
  const max = Math.max(min, round(baseHigh * mult))

  return {
    suggestedLeaves,
    min,
    max,
    valuationSource,
    sampleSize,
    allowed: overrideBounds(suggestedLeaves),
  }
}

/**
 * The Prisma `where` that selects comparables for a category.
 *
 * Shared by the endpoint and the create/update guard so the two cannot disagree
 * about what counts as a comparable — if they could, the server would validate
 * an override against a different suggestion than the one it showed the user.
 *
 * On what counts as settled: settlement reassigns Item.userId and sets status
 * OWNED (see trades/[id]/confirm/submit), so OWNED means "acquired through a
 * settled trade". TRADED is LEGACY ONLY — no code path writes it any more, and
 * the two rows that still carry it were settled on 2026-07-04, before the OWNED
 * convention. They are genuinely settled and the dataset is too small to
 * discard real comparables, so they are included; nothing new will enter
 * through TRADED.
 */
export const SETTLED_STATUSES = ["OWNED", "TRADED"] as const

export const comparablesWhere = (category: string) => ({
  category: category as Category,
  status: { in: [...SETTLED_STATUSES] },
  valueLeaves: { not: null },
})

/** The columns a comparable needs. Nothing else is read. */
export const COMPARABLE_SELECT = { valueLeaves: true, condition: true } as const
