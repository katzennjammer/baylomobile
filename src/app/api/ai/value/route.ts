import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import { categoryLabel, conditionLabel } from "@/lib/v1/taxonomy"
import { categorySchema, conditionSchema } from "@/lib/validation"
import { valuate } from "@/lib/valuation-server"
import { valueItem, BAND_REFERENCE_CONDITION } from "@/lib/valuation"

/**
 * DEPRECATED. Use GET /api/v1/valuation.
 *
 * This path is a lie about what the code does and it is kept only so that
 * anything already pointed at it keeps working. There is no AI here and there
 * never was: the handler that used to live at this path imported Prisma and a
 * number formatter, and every valuation the product ever advertised as an AI
 * scan was this — a category lookup with a spinner in front of it.
 *
 * The model now lives in @/lib/valuation and the endpoint that owns it is
 * /api/v1/valuation, outside /api/ai/ where it belongs. What remains here is a
 * translation layer: same library, same numbers, old response shape. It holds
 * no tables and makes no decisions, so it cannot drift from the real endpoint
 * the way the old duplicated band tables did.
 *
 * Two differences from the real endpoint, both consequences of the old shape:
 *
 *   - `condition` is optional. Callers written against the old contract do not
 *     send it, and 400-ing them would be breaking the compatibility this file
 *     exists to provide. Omitted, it is treated as GOOD — the condition the
 *     category bands are expressed in, so the result is the un-adjusted band
 *     figure the old handler returned.
 *   - `source` keeps its old vocabulary ("baylo_trades" / "category_average")
 *     rather than the stored valuationSource values. A shipped client may be
 *     branching on those strings.
 *
 * When the web client is the only caller left and it is on v1, delete this file.
 */

/** Old-vocabulary source strings. Not what is stored on the Item. */
const LEGACY_SOURCE = {
  comparables: "baylo_trades",
  category_band: "category_average",
} as const

export async function GET(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const params = new URL(req.url).searchParams

  // An unknown category resolves to OTHER rather than 400-ing, which is what
  // the old handler did (`?? "OTHER"` on a missing param, and an unchecked
  // lookup with a fallback band on a bogus one). v1 rejects both; this does not.
  const categoryParsed = categorySchema.safeParse(params.get("category"))
  const category = categoryParsed.success ? categoryParsed.data : "OTHER"

  const conditionParsed = conditionSchema.safeParse(params.get("condition"))
  const condition = conditionParsed.success ? conditionParsed.data : BAND_REFERENCE_CONDITION

  const label = categoryLabel(category)
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US")

  // The range this endpoint reports is condition-adjusted, so the caption has
  // to name the item's condition and not the band's reference one.
  const bandSublabel = (c: string) =>
    c === BAND_REFERENCE_CONDITION
      ? `Category band · ${conditionLabel(c)} condition`
      : `Category band · adjusted for ${conditionLabel(c).toLowerCase()} condition`

  try {
    const v = await valuate(category, condition)

    const comparables: { label: string; sublabel: string; leaves: string }[] = []
    if (v.valuationSource === "comparables") {
      comparables.push({
        label: `Recent ${label} swaps`,
        sublabel: `Baylo · ${label} · ${v.sampleSize} completed trade${v.sampleSize === 1 ? "" : "s"}, adjusted for condition`,
        leaves: `~${fmt(v.suggestedLeaves)} Leaves`,
      })
    }
    comparables.push({
      label: `Typical ${label} value`,
      sublabel: bandSublabel(condition),
      leaves: `${fmt(v.min)} – ${fmt(v.max)} Leaves`,
    })

    return NextResponse.json({
      min: v.min,
      max: v.max,
      // The old field name. It always meant "the number to pre-fill", which is
      // the suggestion; it was the band's arithmetic midpoint only because
      // nothing adjusted it. Both are sent so a caller can move over without a
      // flag day.
      midpoint: v.suggestedLeaves,
      suggestedLeaves: v.suggestedLeaves,
      allowed: v.allowed,
      valuationSource: v.valuationSource,
      comparables,
      source: LEGACY_SOURCE[v.valuationSource],
      deprecated: "Use GET /api/v1/valuation",
    })
  } catch {
    // The old handler swallowed a DB failure into a band-only response. That
    // behaviour is kept: the band path needs no database, so a valuation is
    // still correct and still labelled with the path that produced it.
    const v = valueItem({ category, condition, comparables: [] })
    return NextResponse.json({
      min: v.min,
      max: v.max,
      midpoint: v.suggestedLeaves,
      suggestedLeaves: v.suggestedLeaves,
      allowed: v.allowed,
      valuationSource: v.valuationSource,
      comparables: [{
        label: `Typical ${label} value`,
        sublabel: bandSublabel(condition),
        leaves: `${fmt(v.min)} – ${fmt(v.max)} Leaves`,
      }],
      source: LEGACY_SOURCE[v.valuationSource],
      deprecated: "Use GET /api/v1/valuation",
    })
  }
}
