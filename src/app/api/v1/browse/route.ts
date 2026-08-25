import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { preciseAccessItemIds } from "@/lib/item-visibility"
import { categorySchema } from "@/lib/validation"
import { ok, unauthenticated, invalid } from "@/lib/v1/envelope"
import { parseQuery, paginationShape } from "@/lib/v1/query"
import { decodeCursor, encodeCursor, olderThan, paginate } from "@/lib/v1/cursor"
import { V1_ITEM_SELECT, V1_ITEM_OWNER_SELECT, v1ItemStatsSelect, v1Item, type V1ItemRow } from "@/lib/v1/item"
import { categoryLabel } from "@/lib/v1/taxonomy"

export const dynamic = "force-dynamic"

/**
 * GET /api/v1/browse — the browse tab.
 *
 * THREE queries: items page (1), pickup access (2), category facets (3).
 *
 * Filters are optional and compose. `sort=nearest` REQUIRES lat/lng and 400s
 * without them rather than falling back to recent — a silent fallback returns a
 * plausible-looking list in the wrong order, which is worse than an error.
 *
 * On radius filtering and the pickup leak: this route READS pickupLat/pickupLng
 * to filter, and still returns them coarsened through v1Item(). Filtering
 * precision and display precision are separate concerns and only the second one
 * is a disclosure. Nothing here puts a precise coordinate on the wire for
 * someone who is not the owner or an accepted counterparty.
 */

const MAX_RADIUS_KM = 200
/** Ceiling on rows pulled for an in-memory distance sort. See sortNearest(). */
const NEAREST_SCAN_CAP = 500

const querySchema = z
  .strictObject({
    ...paginationShape,
    category: categorySchema.optional(),
    q: z.string().trim().min(1).max(100).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().positive().max(MAX_RADIUS_KM).optional(),
    sort: z.enum(["recent", "nearest"]).optional().default("recent"),
  })
  .refine((v) => v.sort !== "nearest" || (v.lat !== undefined && v.lng !== undefined), {
    message: "sort=nearest requires lat and lng",
  })
  .refine((v) => v.radiusKm === undefined || (v.lat !== undefined && v.lng !== undefined), {
    message: "radiusKm requires lat and lng",
  })

/** Great-circle distance in km. */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

export async function GET(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const viewerId = session.user.id

  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response
  const { limit, category, q, lat, lng, radiusKm, sort } = parsed.data
  const cursor = decodeCursor(parsed.data.cursor)
  if (parsed.data.cursor && !cursor) return invalid("Malformed cursor")

  // A bounding box first: cheap in SQL, and it turns a whole-table distance
  // computation into one over a small candidate set. The circle is applied
  // afterwards, so corners of the box do not leak into the result.
  const box =
    lat !== undefined && lng !== undefined && radiusKm !== undefined
      ? (() => {
          const dLat = radiusKm / 111.32
          const dLng = radiusKm / (111.32 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)))
          return {
            pickupLat: { gte: lat - dLat, lte: lat + dLat },
            pickupLng: { gte: lng - dLng, lte: lng + dLng },
          }
        })()
      : undefined

  const baseWhere = {
    status: "AVAILABLE" as const,
    ...(category ? { category } : {}),
    ...(q ? { OR: [{ title: { contains: q } }, { description: { contains: q } }] } : {}),
    ...(box ?? {}),
  }

  const selection = {
    ...V1_ITEM_SELECT,
    user: { select: V1_ITEM_OWNER_SELECT },
    ...v1ItemStatsSelect(viewerId),
  }

  let page: unknown[]
  let nextCursor: string | null

  if (sort === "nearest") {
    // ── 1 (nearest) ──
    // Keyset pagination on a computed distance cannot be expressed in Prisma,
    // so the candidate set is bounded instead: the bounding box plus a hard cap,
    // sorted and cursored in memory. The cursor is still a real keyset —
    // (distance, id) — so ties never drop or duplicate a row.
    const rows = await prisma.item.findMany({
      where: { ...baseWhere, pickupLat: { not: null }, pickupLng: { not: null } },
      select: selection,
      take: NEAREST_SCAN_CAP,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    })

    const withDistance = rows
      .map((r) => ({
        row: r,
        d: haversineKm(lat!, lng!, r.pickupLat as number, r.pickupLng as number),
      }))
      .filter((x) => radiusKm === undefined || x.d <= radiusKm)
      .sort((a, b) => (a.d === b.d ? (a.row.id < b.row.id ? 1 : -1) : a.d - b.d))

    const afterDistance = cursor && typeof cursor.k === "number" ? cursor.k : null
    const after =
      afterDistance !== null && cursor
        ? withDistance.filter(
            (x) => x.d > afterDistance || (x.d === afterDistance && x.row.id < cursor.id),
          )
        : withDistance

    const sliced = paginate(after, limit, (x) => encodeCursor(x.d, x.row.id))
    page = sliced.page.map((x) => x.row)
    nextCursor = sliced.nextCursor
  } else {
    // ── 1 (recent) ── plain keyset on createdAt.
    const rows = await prisma.item.findMany({
      where: { ...baseWhere, ...(olderThan(cursor) ?? {}) },
      select: selection,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    })
    const sliced = paginate(rows, limit, (r) => encodeCursor(r.createdAt, r.id))
    page = sliced.page
    nextCursor = sliced.nextCursor
  }

  const rowsOut = page as V1ItemRow[]

  // ── 2 ── pickup access for this page only.
  const access = await preciseAccessItemIds(viewerId, rowsOut.map((r) => r.id))

  // ── 3 ── facets for the filter chips.
  //
  // Deliberately NOT filtered by the current category: chips that vanish as soon
  // as you pick one are a worse control than chips that stay put. The text and
  // radius filters are not applied either, for the same reason.
  const facetRows = await prisma.item.groupBy({
    by: ["category"],
    where: { status: "AVAILABLE" },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
  })

  return ok(
    {
      items: rowsOut.map((r) => v1Item(r, viewerId, access)),
      facets: {
        categories: facetRows.map((f) => ({
          category: f.category,
          label: categoryLabel(f.category),
          count: f._count.id,
        })),
      },
    },
    {
      nextCursor,
      // The filters the server actually honoured, echoed back. Cheap, and it
      // makes a client/server disagreement visible instead of mysterious.
      applied: {
        category: category ?? null,
        q: q ?? null,
        sort,
        radiusKm: radiusKm ?? null,
      },
    },
  )
}
