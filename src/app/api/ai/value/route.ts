import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"

// Typical second-hand value bands, expressed in Pasa Leaves.
// Leaves are a non-monetary trade unit — these are relative worth, not prices.
// This table is the SINGLE source of truth for value bands; clients read it
// through this endpoint and must not keep their own copy.
const VALUE_BANDS: Record<string, [number, number]> = {
  ELECTRONICS:  [100, 4000],  CLOTHING:   [30, 600],   BAGS:     [40, 1600],
  BEAUTY:       [20, 1000],   ACCESSORIES:[40, 2000],  FURNITURE:[100, 3000],
  BOOKS:        [15, 200],    GAMING:     [100, 4000], SPORTS:   [60, 3000],
  BIKES:        [200, 6000],  TOYS:       [20, 600],   TOOLS:    [40, 2000],
  MUSIC:        [100, 6000],  ART:        [40, 1000],  COLLECTIBLES:[20, 2000],
  PETS:         [20, 600],    PLANTS:     [20, 400],   FOOD:     [10, 100],
  SERVICES:     [100, 2000],  OTHER:      [20, 1000],
}

const FALLBACK_BAND: [number, number] = [1, 40]

const CATEGORY_LABELS: Record<string, string> = {
  ELECTRONICS: "Electronics",  CLOTHING: "Clothing",      BAGS: "Bags",
  BEAUTY: "Beauty",            ACCESSORIES: "Accessories", FURNITURE: "Furniture",
  BOOKS: "Books & Media",      GAMING: "Gaming",           SPORTS: "Sports",
  BIKES: "Bikes",              TOYS: "Toys & Kids",        TOOLS: "Tools",
  MUSIC: "Music",              ART: "Art & Crafts",        COLLECTIBLES: "Collectibles",
  PETS: "Pets",                PLANTS: "Plants",           FOOD: "Food",
  SERVICES: "Services",        OTHER: "Other",
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US")

export async function GET(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const category = new URL(req.url).searchParams.get("category") ?? "OTHER"
  const label = CATEGORY_LABELS[category] ?? category
  const band = VALUE_BANDS[category] ?? FALLBACK_BAND

  const categoryComparable = {
    label:    `Typical ${label} value`,
    sublabel: "Category average",
    leaves:   `${fmt(band[0])} – ${fmt(band[1])} Leaves`,
  }

  try {
    // Comparables must come from items that actually changed hands. Settlement
    // reassigns Item.userId and sets status OWNED (see trades/[id]/confirm/submit),
    // so OWNED already means "acquired through a settled trade"; TRADED describes
    // a relationship the row no longer has. Filtering on TRADED alone therefore
    // matched almost nothing and every request fell through to the VALUE_BANDS
    // category estimate below.
    //
    // TRADED is included as LEGACY ONLY. No code path writes it any more — the
    // two rows that still carry it ("Coco", OTHER, 20 Leaves and "Bike", SPORTS,
    // 32 Leaves) were settled on 2026-07-04, before the OWNED convention. They
    // are genuinely settled items and this dataset is far too small to discard
    // real comparables. Nothing new will ever enter this branch through TRADED.
    // (Note: dashboard/trades/TradesClient.tsx does set "TRADED" optimistically
    // in local UI state, but never persists it.)
    //
    // Switched from TRADED-only to OWNED + TRADED on 2026-08-25. That date is the
    // boundary: before it this endpoint always returned category bands; from it,
    // any category with >= 3 settled priced items returns real Baylo comparables
    // instead. As of that date no category has reached 3 yet, so the statistical
    // branch is armed rather than active. If the valuation numbers move, this is
    // when and why.
    const settled = await prisma.item.findMany({
      where: {
        category: category as never,
        status: { in: ["OWNED", "TRADED"] },
        valueLeaves: { not: null },
      },
      select: { valueLeaves: true },
      take: 100,
    })

    const values = settled.map(i => i.valueLeaves!).filter(v => v > 0)
    const comparables: { label: string; sublabel: string; leaves: string }[] = []

    let min: number, max: number, midpoint: number
    let source: string

    if (values.length >= 3) {
      min      = Math.min(...values)
      max      = Math.max(...values)
      midpoint = values.reduce((a, b) => a + b, 0) / values.length
      source   = "baylo_trades"
      comparables.push({
        label:    `Recent ${label} swaps`,
        sublabel: `Baylo · ${label} · ${values.length} completed trade${values.length !== 1 ? "s" : ""}`,
        leaves:   `~${fmt(midpoint)} Leaves avg`,
      })
    } else {
      min      = band[0]
      max      = band[1]
      midpoint = (band[0] + band[1]) / 2
      source   = "category_average"
    }

    comparables.push(categoryComparable)

    return NextResponse.json({
      min:      Math.round(min),
      max:      Math.round(max),
      midpoint: Math.round(midpoint),
      comparables,
      source,
    })
  } catch {
    return NextResponse.json({
      min:      band[0],
      max:      band[1],
      midpoint: Math.round((band[0] + band[1]) / 2),
      comparables: [categoryComparable],
      source: "category_average",
    })
  }
}
