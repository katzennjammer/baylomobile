import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { ok, unauthenticated, notFound, conflict } from "@/lib/v1/envelope"
import { parseQuery } from "@/lib/v1/query"
import { categoryLabel, conditionLabel } from "@/lib/v1/taxonomy"
import { categorySchema, conditionSchema } from "@/lib/validation"
import { valuate } from "@/lib/valuation-server"
import {
  MAX_REVALUATIONS,
  MIN_COMPARABLES,
  OVERRIDE_BAND_PCT,
  CONDITION_MULTIPLIERS,
  BAND_REFERENCE_CONDITION,
  type Condition,
} from "@/lib/valuation"

export const dynamic = "force-dynamic"

/**
 * GET /api/v1/valuation — the suggested value for a category and condition.
 *
 * THIS IS NOT AN AI ENDPOINT. It lived at /api/ai/value, which was wrong in a
 * way that mattered: the path told every reader — and the capstone document
 * describing it — that a model produced the number, when the handler imported
 * Prisma and a formatter and made no model call at all. The AI in the listing
 * flow is /api/ai/identify, which reads the photo and returns a category and a
 * condition label. Those labels come in here as parameters and the arithmetic
 * in @/lib/valuation turns them into a number. Nothing on this path is
 * stochastic.
 *
 * /api/ai/value still resolves, as a deprecated shim over the same library, so
 * the shipped web client and anything else pointed at it keep working.
 *
 * DETERMINISM. Same category, same condition, same database state, same
 * response — byte for byte. The one input that can move between two calls is
 * the comparables set, and that only changes when a trade settles. `take` is
 * bounded and `orderBy` is a total order on (createdAt, id), so even at the
 * MAX_COMPARABLES ceiling the same rows come back in the same sequence rather
 * than in whatever order the optimiser felt like.
 *
 * RE-VALUATION. Passing `itemId` marks the call as a re-valuation of an
 * existing listing and spends one of that listing's MAX_REVALUATIONS. Omitting
 * it is the initial valuation of a listing that does not exist yet, which is
 * not rate-limited by this counter because there is no listing to count against.
 */

const querySchema = z.strictObject({
  category: categorySchema,
  condition: conditionSchema,
  /** Present = re-valuing an existing listing. Absent = valuing a draft. */
  itemId: z.string().min(1).max(64).optional(),
})

export async function GET(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const viewerId = session.user.id

  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response
  const { category, condition, itemId } = parsed.data

  // ── Re-valuation budget ──────────────────────────────────────────────────
  // Checked and spent BEFORE the model runs. Spending it after would mean a
  // request that produced a valuation and then failed to record that it had,
  // which is a free re-valuation for anyone who can make the write fail.
  if (itemId) {
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      select: { userId: true, revaluationCount: true },
    })
    // 404 for absent and for not-yours alike: a 403 would confirm the listing
    // exists, which is the line the rest of the item routes already take.
    if (!item) return notFound("Listing not found")
    if (item.userId !== viewerId) return notFound("Listing not found")

    if (item.revaluationCount >= MAX_REVALUATIONS) {
      return conflict(
        `This listing has already used its re-valuation. Values are computed the same way every time, so re-running the estimate on unchanged details returns the same number.`,
        { revaluationCount: item.revaluationCount, maxRevaluations: MAX_REVALUATIONS },
      )
    }

    // Conditional update, not a read-then-write: two concurrent requests would
    // both read 0 and both write 1, spending one budget twice. The WHERE makes
    // the check and the increment the same statement, so the second matches
    // zero rows.
    const spent = await prisma.item.updateMany({
      where: { id: itemId, userId: viewerId, revaluationCount: { lt: MAX_REVALUATIONS } },
      data: { revaluationCount: { increment: 1 } },
    })
    if (spent.count === 0) {
      return conflict("This listing has already used its re-valuation.", {
        maxRevaluations: MAX_REVALUATIONS,
      })
    }
  }

  // ── The model ────────────────────────────────────────────────────────────
  // Same call the item create and update handlers make when they bound an
  // override, so the suggestion shown here is by construction the suggestion
  // the write path will validate against.
  const valuation = await valuate(category, condition)

  const label = categoryLabel(category)

  // ── The comparables the user is shown ────────────────────────────────────
  // Two rows at most, and each states its own basis. The category row is always
  // present so the fallback is visible even when real trade history won: a user
  // who can see both can tell which one the number came from.
  const rows: { label: string; sublabel: string; leaves: string }[] = []
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US")

  if (valuation.valuationSource === "comparables") {
    rows.push({
      label: `Recent ${label} swaps`,
      sublabel: `Baylo · ${label} · ${valuation.sampleSize} completed trade${valuation.sampleSize === 1 ? "" : "s"}, adjusted for condition`,
      leaves: `~${fmt(valuation.suggestedLeaves)} Leaves`,
    })
  }
  rows.push({
    label: `Typical ${label} value`,
    // The range shown IS condition-adjusted — it is the band scaled by this
    // item's multiplier, not the raw GOOD-condition band. Labelling it with the
    // reference condition would caption a New-condition range "Good condition".
    sublabel:
      condition === BAND_REFERENCE_CONDITION
        ? `Category band · ${conditionLabel(condition)} condition`
        : `Category band · adjusted for ${conditionLabel(condition).toLowerCase()} condition`,
    leaves: `${fmt(valuation.min)} – ${fmt(valuation.max)} Leaves`,
  })

  return ok(
    {
      suggestedLeaves: valuation.suggestedLeaves,
      min: valuation.min,
      max: valuation.max,
      /** The bounds the final value must fall inside. The slider's stops. */
      allowed: valuation.allowed,
      valuationSource: valuation.valuationSource,
      sampleSize: valuation.sampleSize,
      category,
      categoryLabel: label,
      condition,
      conditionLabel: conditionLabel(condition),
      comparables: rows,
      /**
       * The one-paragraph answer to "where did this number come from", rendered
       * as the tooltip. Built from the same constants the arithmetic used, so
       * it cannot describe a model other than the one that ran.
       */
      basis:
        valuation.valuationSource === "comparables"
          ? `Estimated from ${valuation.sampleSize} completed ${label} trade${valuation.sampleSize === 1 ? "" : "s"} on Baylo, adjusted for ${conditionLabel(condition).toLowerCase()} condition (×${CONDITION_MULTIPLIERS[condition as Condition].toFixed(2)}). You can set any value within ${Math.round(OVERRIDE_BAND_PCT * 100)}% of this.`
          : condition === BAND_REFERENCE_CONDITION
          ? `Fewer than ${MIN_COMPARABLES} completed ${label} trades on Baylo so far, so this uses the ${label} category band for a ${conditionLabel(condition).toLowerCase()}-condition item. You can set any value within ${Math.round(OVERRIDE_BAND_PCT * 100)}% of this.`
          : `Fewer than ${MIN_COMPARABLES} completed ${label} trades on Baylo so far, so this uses the ${label} category band for a ${conditionLabel(BAND_REFERENCE_CONDITION).toLowerCase()}-condition item, scaled for ${conditionLabel(condition).toLowerCase()} condition (×${CONDITION_MULTIPLIERS[condition as Condition].toFixed(2)}). You can set any value within ${Math.round(OVERRIDE_BAND_PCT * 100)}% of this.`,
    },
    {
      overrideBandPct: OVERRIDE_BAND_PCT,
      minComparables: MIN_COMPARABLES,
      maxRevaluations: MAX_REVALUATIONS,
      /** True when this call spent one of the listing's re-valuations. */
      revaluation: !!itemId,
    },
  )
}
