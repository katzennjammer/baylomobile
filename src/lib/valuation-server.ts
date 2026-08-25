import prisma from "@/lib/prisma"
import {
  valueItem,
  comparablesWhere,
  COMPARABLE_SELECT,
  MAX_COMPARABLES,
  isWithinOverrideBand,
  overrideBounds,
  OVERRIDE_BAND_PCT,
  type Valuation,
} from "@/lib/valuation"

/**
 * The database half of the valuation model.
 *
 * @/lib/valuation is deliberately pure — constants and arithmetic, no imports
 * that touch I/O — so that the model can be exercised without a database and so
 * that "same inputs, same output" is a property of a function rather than a
 * property of a request. This file is the thin layer that fetches the one input
 * the model cannot compute for itself: the settled comparables for a category.
 *
 * Everything that needs a valuation goes through here — the /api/v1/valuation
 * endpoint, its deprecated /api/ai/value shim, and the item create and update
 * handlers that enforce the override band. That matters more than it sounds: if
 * the endpoint that shows the user a suggestion and the handler that validates
 * their override were to compute the suggestion differently, the server would
 * reject values its own slider allowed the user to pick.
 */

/** Comparables for a category, in a stable order. See the orderBy note. */
async function fetchComparables(category: string) {
  const rows = await prisma.item.findMany({
    where: comparablesWhere(category),
    select: COMPARABLE_SELECT,
    // A TOTAL order. `createdAt` alone is not one: two items created in the
    // same millisecond tie, and the tiebreak would be whatever the optimiser
    // returns first — which is the non-determinism this whole module claims not
    // to have. `id` is unique, so (createdAt, id) never ties.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_COMPARABLES,
  })
  return rows.map((r) => ({ valueLeaves: r.valueLeaves!, condition: r.condition }))
}

/** Value a (category, condition) pair against current trade history. */
export async function valuate(category: string, condition: string): Promise<Valuation> {
  return valueItem({ category, condition, comparables: await fetchComparables(category) })
}

// ── The write-path guard ─────────────────────────────────────────────────────

export interface ValuationDecision {
  /** Columns to merge into the Prisma create/update `data`. */
  data: { valueLeaves: number; suggestedLeaves: number; valuationSource: string }
  /** The valuation that produced them, for the caller's response or logging. */
  valuation: Valuation
}

export interface ValuationRejection {
  ok: false
  message: string
  suggestedLeaves: number
  allowed: { min: number; max: number }
}

export type ValuationOutcome = ({ ok: true } & ValuationDecision) | ValuationRejection

/**
 * Decide what value a listing gets, and whether the user's number is allowed.
 *
 * THE SERVER RECOMPUTES THE SUGGESTION. It does not accept one from the client
 * and check the override against that — a client that supplies both the
 * suggestion and the "override" of it has not been bounded by anything. Because
 * the model is deterministic, the server can derive the same suggestion the
 * client was shown from the same two labels, so there is nothing the client
 * needs to be trusted about. This is a property the previous design could not
 * have had at any price: a stochastic model cannot re-derive its own earlier
 * answer, so an LLM-priced listing could only ever be validated against a
 * number the client asserted.
 *
 * `requestedValue` null or 0 means "no value given" — that is what every
 * shipped client sends for an unset price. Those listings take the suggestion
 * as their value rather than storing NULL, so that a listing always carries a
 * value and the override band always has something to be measured against.
 */
export async function decideItemValue(
  category: string,
  condition: string,
  requestedValue: number | null | undefined,
): Promise<ValuationOutcome> {
  const valuation = await valuate(category, condition)
  const { suggestedLeaves, valuationSource } = valuation

  // No number from the user: the suggestion stands as the value. Not an
  // override, so nothing to bound.
  if (requestedValue == null || requestedValue <= 0) {
    return {
      ok: true,
      valuation,
      data: { valueLeaves: suggestedLeaves, suggestedLeaves, valuationSource },
    }
  }

  if (!isWithinOverrideBand(requestedValue, suggestedLeaves)) {
    const allowed = overrideBounds(suggestedLeaves)
    return {
      ok: false,
      suggestedLeaves,
      allowed,
      // Names the suggestion and the bounds. An error that says only "out of
      // range" leaves the caller to guess at the range, and the guess is a
      // retry loop.
      message:
        `Value must be within ${Math.round(OVERRIDE_BAND_PCT * 100)}% of the suggested ` +
        `${suggestedLeaves.toLocaleString("en-US")} Leaves for a ${condition.replace("_", " ").toLowerCase()} ` +
        `${category.toLowerCase()} item — that is ${allowed.min.toLocaleString("en-US")} to ` +
        `${allowed.max.toLocaleString("en-US")} Leaves. You sent ${requestedValue.toLocaleString("en-US")}.`,
    }
  }

  return {
    ok: true,
    valuation,
    data: { valueLeaves: requestedValue, suggestedLeaves, valuationSource },
  }
}
