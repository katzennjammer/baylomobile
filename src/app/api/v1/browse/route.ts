import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { preciseAccessItemIds } from "@/lib/item-visibility"
import { visibleItemWhere } from "@/lib/blocking"
import { CATEGORY_VALUES, conditionSchema } from "@/lib/validation"
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

/** MySQL signed INT upper bound — the real ceiling on Item.valueLeaves. */
const INT_MAX = 2147483647

/**
 * How many categories one request may name.
 *
 * Browsing two or three at once is the normal thing to want; browsing all
 * twenty is not a filter, it is the unfiltered feed with a longer URL. The cap
 * also bounds the `IN (...)` list, so a caller cannot hand the planner an
 * arbitrarily long disjunction.
 */
const MAX_CATEGORIES = 5

/**
 * `category` accepts one value or a COMMA-SEPARATED list: `?category=BOOKS` and
 * `?category=BOOKS,GAMING` are both valid.
 *
 * COMMA-SEPARATED AND NOT A REPEATED PARAMETER, and that is forced rather than
 * chosen: parseQuery() rejects `?category=A&category=B` outright — a repeated
 * parameter is refused before zod ever sees it, because resolving one by a
 * first-or-last rule is a guess about what the caller meant. So the list has to
 * arrive inside a single value.
 *
 * Parsed with superRefine rather than a bare `.transform` so that a bad member
 * names ITSELF in the error. "Unknown category: BOOSK" is actionable;
 * "invalid category" sends a client author looking through all five.
 */
const categoryListSchema = z
  .string()
  .trim()
  .min(1)
  // 20 enum names plus separators cannot exceed this; a longer string is not a
  // category list and is refused before it is split.
  .max(400)
  .transform((raw) => [...new Set(raw.split(",").map((c) => c.trim()).filter(Boolean))])
  .superRefine((list, ctx) => {
    if (list.length === 0) {
      ctx.addIssue({ code: "custom", message: "category cannot be empty" })
      return
    }
    if (list.length > MAX_CATEGORIES) {
      ctx.addIssue({
        code: "custom",
        message: `at most ${MAX_CATEGORIES} categories (got ${list.length})`,
      })
    }
    for (const c of list) {
      if (!(CATEGORY_VALUES as readonly string[]).includes(c)) {
        ctx.addIssue({ code: "custom", message: `Unknown category: ${c}` })
      }
    }
  })
  .transform((list) => list as (typeof CATEGORY_VALUES)[number][])

/** A Leaf bound: a non-negative integer inside the column's range. */
const leafBound = z.coerce
  .number()
  .int("must be a whole number")
  .min(0, "cannot be negative")
  .max(INT_MAX)

const querySchema = z
  .strictObject({
    ...paginationShape,
    category: categoryListSchema.optional(),
    condition: conditionSchema.optional(),
    minLeaves: leafBound.optional(),
    maxLeaves: leafBound.optional(),
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
  // An inverted range returns nothing, silently and forever. Refusing it says
  // so once instead of leaving a client to wonder why the list is empty.
  .refine(
    (v) => v.minLeaves === undefined || v.maxLeaves === undefined || v.minLeaves <= v.maxLeaves,
    { message: "minLeaves cannot be greater than maxLeaves" },
  )

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
  const { limit, category, condition, minLeaves, maxLeaves, q, lat, lng, radiusKm, sort } =
    parsed.data
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

  // visibleItemWhere() rides in the base, so BOTH sort branches and the search
  // filter inherit it. That placement is the point: `q` is the search path, and
  // a blocked user's listing being findable by title while being absent from
  // the feed is the same leak wearing a different hat.
  //
  // ON THE LEAF RANGE: `valueLeaves` is nullable, and a bound EXCLUDES the nulls
  // rather than treating them as zero. An unpriced listing has no value, which
  // is a different fact from having a value of nought — folding the two would
  // dump every unpriced item into the bottom of every range filter, where it
  // would look like a 0-Leaf listing to anyone reading the results.
  const leafRange =
    minLeaves !== undefined || maxLeaves !== undefined
      ? {
          valueLeaves: {
            ...(minLeaves !== undefined ? { gte: minLeaves } : {}),
            ...(maxLeaves !== undefined ? { lte: maxLeaves } : {}),
            not: null,
          },
        }
      : {}

  const baseWhere = {
    status: "AVAILABLE" as const,
    ...visibleItemWhere(viewerId),
    // `in` for one category as well as several: Prisma emits `= ?` for a
    // single-element IN, so the one-category case costs nothing and there is
    // no second code path that could disagree with this one.
    ...(category ? { category: { in: category } } : {}),
    ...(condition ? { condition } : {}),
    ...leafRange,
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
  //
  // The block and takedown filters DO apply here, unlike the category/text/
  // radius filters above. Those are omitted so the chips stay put as you use
  // them; a blocked user's listings are not a filter the viewer is toggling,
  // they are content that does not exist for this viewer, and a chip counting
  // them sends the user to an empty result.
  const facetRows = await prisma.item.groupBy({
    by: ["category"],
    where: { status: "AVAILABLE", ...visibleItemWhere(viewerId) },
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
      // NOTE: `category` (a single string or null) became `categories` (always
      // an array, empty when unfiltered) when the multi-select landed. A field
      // whose TYPE changes between requests is worse than a renamed one, and
      // nothing consumed this echo — it is diagnostic, not data.
      applied: {
        categories: category ?? [],
        condition: condition ?? null,
        minLeaves: minLeaves ?? null,
        maxLeaves: maxLeaves ?? null,
        q: q ?? null,
        sort,
        radiusKm: radiusKm ?? null,
      },
    },
  )
}
