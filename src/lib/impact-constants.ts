// All environmental impact multipliers — single source of truth.
// Units: CO₂ in kg, water in litres, waste in kg.

export const ECO_FACTORS: Record<string, { co2Kg: number; waterL: number; wasteKg: number }> = {
  ELECTRONICS: { co2Kg: 15,  waterL: 200,  wasteKg: 0.5 },
  CLOTHING:    { co2Kg: 5,   waterL: 2700, wasteKg: 0.8 },
  FURNITURE:   { co2Kg: 20,  waterL: 150,  wasteKg: 5   },
  BOOKS:       { co2Kg: 1,   waterL: 50,   wasteKg: 0.3 },
  SPORTS:      { co2Kg: 3,   waterL: 100,  wasteKg: 1.5 },
  TOYS:        { co2Kg: 2,   waterL: 80,   wasteKg: 0.4 },
  TOOLS:       { co2Kg: 4,   waterL: 120,  wasteKg: 2   },
  FOOD:        { co2Kg: 0.5, waterL: 500,  wasteKg: 1   },
  SERVICES:    { co2Kg: 0,   waterL: 0,    wasteKg: 0   },
  OTHER:       { co2Kg: 2,   waterL: 100,  wasteKg: 1   },
}

export const DEFAULT_ECO_FACTOR: { co2Kg: number; waterL: number; wasteKg: number } = {
  co2Kg: 2, waterL: 100, wasteKg: 1,
}

export function factorForCategory(category: string): { co2Kg: number; waterL: number; wasteKg: number } {
  return ECO_FACTORS[category] ?? DEFAULT_ECO_FACTOR
}

// Derived flat lookups kept for backward compatibility with impact/trades pages.
export const CO2_PER_CATEGORY: Record<string, number> =
  Object.fromEntries(Object.entries(ECO_FACTORS).map(([k, v]) => [k, v.co2Kg]))
export const WATER_PER_CATEGORY: Record<string, number> =
  Object.fromEntries(Object.entries(ECO_FACTORS).map(([k, v]) => [k, v.waterL]))
export const WEIGHT_PER_CATEGORY: Record<string, number> =
  Object.fromEntries(Object.entries(ECO_FACTORS).map(([k, v]) => [k, v.wasteKg]))

// 1 tree absorbs ≈21 kg CO₂ per year
export const KG_CO2_PER_TREE = 21

// Default weekly CO₂ goal for the sidebar progress widget
export const WEEKLY_CO2_GOAL_KG = 3

// Green score: sum of capped sub-scores, max 100
export const GREEN_SCORE_WEIGHTS = {
  co2MaxPts:     40,
  waterMaxPts:   20,
  rehomeMaxPts:  20,
  wasteMaxPts:   20,
  co2PtsPerKg:   1,
  waterPtsPerKL: 1,
  rehomedPts:    2,
  wastePtsPerKg: 2,
}

// Tier thresholds — descending, first match wins
export const GREEN_TIERS = [
  { min: 80, label: "Forest"   },
  { min: 60, label: "Canopy"   },
  { min: 40, label: "Sapling"  },
  { min: 20, label: "Sprout"   },
  { min:  0, label: "Seedling" },
]

export function computeGreenScore(
  co2Avoided: number,
  waterSaved: number,
  itemsRehomed: number,
  wasteDiverted: number,
): number {
  const w = GREEN_SCORE_WEIGHTS
  const co2Score    = Math.min(w.co2MaxPts,    co2Avoided * w.co2PtsPerKg)
  const waterScore  = Math.min(w.waterMaxPts,  (waterSaved / 1000) * w.waterPtsPerKL)
  const rehomeScore = Math.min(w.rehomeMaxPts, itemsRehomed * w.rehomedPts)
  const wasteScore  = Math.min(w.wasteMaxPts,  wasteDiverted * w.wastePtsPerKg)
  return Math.round(co2Score + waterScore + rehomeScore + wasteScore)
}

export function computeTier(score: number): string {
  return GREEN_TIERS.find((t) => score >= t.min)?.label ?? "Seedling"
}

export interface ImpactData {
  co2Avoided:    number
  waterSaved:    number
  itemsRehomed:  number
  wasteDiverted: number
  treesEquiv:    number
  co2Given:      number
  co2Received:   number
  weeklyCO2:     number
}

interface TradeWithCategories {
  senderId: string
  offeredItem:   { category: string }
  requestedItem: { category: string }
}

export function computeImpactData(
  userId: string,
  trades: TradeWithCategories[],
): Omit<ImpactData, "treesEquiv" | "weeklyCO2"> {
  let co2Avoided = 0, waterSaved = 0, wasteDiverted = 0
  let co2Given = 0, co2Received = 0

  for (const t of trades) {
    const isSender  = t.senderId === userId
    const myCat     = isSender ? t.offeredItem.category   : t.requestedItem.category
    const theirCat  = isSender ? t.requestedItem.category : t.offeredItem.category
    const myF       = factorForCategory(myCat)
    const theirF    = factorForCategory(theirCat)

    co2Avoided    += myF.co2Kg
    waterSaved    += myF.waterL
    wasteDiverted += myF.wasteKg
    co2Given      += myF.co2Kg
    co2Received   += theirF.co2Kg
  }

  return { co2Avoided, waterSaved, itemsRehomed: trades.length, wasteDiverted, co2Given, co2Received }
}
