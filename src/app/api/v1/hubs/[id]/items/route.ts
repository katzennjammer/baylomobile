import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { preciseAccessItemIds } from "@/lib/item-visibility"
import { visibleItemWhere } from "@/lib/blocking"
import { ok, unauthenticated, notFound, invalid } from "@/lib/v1/envelope"
import { parseQuery, paginationShape } from "@/lib/v1/query"
import { decodeCursor, encodeCursor, olderThan, paginate } from "@/lib/v1/cursor"
import {
  V1_ITEM_SELECT,
  V1_ITEM_OWNER_SELECT,
  v1ItemStatsSelect,
  v1Item,
  type V1ItemRow,
} from "@/lib/v1/item"
import { SAFE_ZONE_HUB_SELECT, v1Hub, type SafeZoneHubRow } from "@/lib/safe-zones"

export const dynamic = "force-dynamic"

/**
 * GET /api/v1/hubs/[id]/items — the listings offered at one hub.
 *
 * THREE queries: the hub (1), the page of items (2), pickup access (3). The
 * first two are concurrent; the third needs the ids the second returns.
 *
 * THE FILTER IS A RELATION TEST ON Item, NOT A QUERY OVER ItemSafeZone. Reading
 * the join table first and then fetching items by id would apply the block and
 * takedown rules AFTER pagination, so a page of 20 would silently come back
 * holding 14 — and the client would have no way to tell that from the end of
 * the list. Filtering on Item with `safeZones: { some: { hubId } }` keeps
 * visibleItemWhere() inside the same WHERE clause, so a page is a page.
 *
 * A DEACTIVATED HUB IS SERVED, NOT 404'd. It is dropped from GET /api/v1/hubs,
 * so nothing new can point at it, but the listings that already do still exist
 * and their owners still expect to see them. The hub object comes back with
 * `isActive: false` and the client renders the banner. 404 here would mean a
 * shared link to a hub page died the moment we closed the hub, taking the
 * listings with it.
 *
 * ON LOCATION, since this is the endpoint that most looks like a map: the only
 * coordinate in this response is the HUB's, and it is precise because a public
 * plaza has no privacy to lose. Every item goes through the same v1Item() the
 * feed uses, so seller pickup stays behind resolvePickup() exactly as it does
 * everywhere else — coarsened for a stranger, absent from the map entirely.
 */

const querySchema = z.strictObject({ ...paginationShape })

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const viewerId = session.user.id
  const { id } = await params

  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response
  const { limit } = parsed.data
  const cursor = decodeCursor(parsed.data.cursor)
  if (parsed.data.cursor && !cursor) return invalid("Malformed cursor")

  // ── 1, 2 ── concurrent: the item query does not need the hub row, only its
  // id, which came in on the URL. A hub that turns out not to exist costs one
  // wasted item query and saves a round trip on every request that succeeds.
  const [hub, rows] = await Promise.all([
    prisma.safeZoneHub.findUnique({ where: { id }, select: SAFE_ZONE_HUB_SELECT }),
    prisma.item.findMany({
      where: {
        status: "AVAILABLE",
        // Blocks and moderator takedowns, in the same WHERE clause as the hub
        // filter. See the note above on why this cannot happen after the fetch.
        ...visibleItemWhere(viewerId),
        safeZones: { some: { hubId: id } },
        ...(olderThan(cursor) ?? {}),
      },
      select: {
        ...V1_ITEM_SELECT,
        user: { select: V1_ITEM_OWNER_SELECT },
        ...v1ItemStatsSelect(viewerId),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    }),
  ])

  if (!hub) return notFound("Safe-Zone hub not found")

  const { page, nextCursor } = paginate(rows, limit, (r) =>
    encodeCursor(r.createdAt, r.id),
  )
  const rowsOut = page as unknown as V1ItemRow[]

  // ── 3 ── pickup access for this page only. One query, not one per item.
  const access = await preciseAccessItemIds(
    viewerId,
    rowsOut.map((r) => r.id),
  )

  return ok(
    {
      hub: v1Hub(hub as SafeZoneHubRow),
      items: rowsOut.map((r) => v1Item(r, viewerId, access)),
    },
    { nextCursor },
  )
}
