import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { ok, unauthenticated } from "@/lib/v1/envelope"
import { parseQuery } from "@/lib/v1/query"
import {
  SAFE_ZONE_HUB_SELECT,
  SAFE_ZONE_TYPE_VALUES,
  MAX_ITEM_HUBS,
  v1Hub,
  type SafeZoneHubRow,
} from "@/lib/safe-zones"

export const dynamic = "force-dynamic"

/**
 * GET /api/v1/hubs — every active Safe-Zone hub.
 *
 * ONE query, and DELIBERATELY NOT PAGINATED. This is a curated table, not user
 * content: it grows when we add a city, by an INSERT somebody ran on purpose,
 * and the picker this feeds has to render every option at once anyway. A cursor
 * here would be pagination over a list that fits on a screen — machinery the
 * client then has to drain before it can show a map.
 *
 * The `take` below is therefore not pagination, it is a blast radius. If this
 * table ever reaches it, the answer is a city filter on the client and a
 * conversation about what "curated" is supposed to mean, not a cursor.
 *
 * INACTIVE HUBS NEVER APPEAR HERE. That is what makes deactivation work as a
 * one-way valve: nothing can be newly selected once it is off this list, while
 * item detail keeps serving the ones already chosen, flagged. The two endpoints
 * disagreeing about which hubs exist is the point rather than a bug.
 *
 * Authenticated, like every other /api/v1 route. Not because a mall's address
 * is a secret — it is the opposite of one — but because there is no reason to
 * stand up an unauthenticated surface for a client that is signed in on every
 * screen that would call this.
 */

const querySchema = z.strictObject({
  /** Exact match on the stored string, e.g. "Mandaue City". */
  city: z.string().trim().min(1).max(80).optional(),
  type: z.enum(SAFE_ZONE_TYPE_VALUES).optional(),
})

/** See the note above — a ceiling, not a page size. */
const HARD_CAP = 500

export async function GET(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()

  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response
  const { city, type } = parsed.data

  const rows = await prisma.safeZoneHub.findMany({
    where: {
      isActive: true,
      ...(city ? { city } : {}),
      ...(type ? { type } : {}),
    },
    select: SAFE_ZONE_HUB_SELECT,
    // City then name: the picker groups by city, and alphabetical inside a
    // group is the only order a stranger can predict.
    orderBy: [{ city: "asc" }, { name: "asc" }],
    take: HARD_CAP,
  })

  // The distinct city list, derived from the rows already fetched rather than
  // a second groupBy. The filter chips need it and the whole table is in hand.
  const cities = [...new Set(rows.map((r) => r.city))].sort()

  return ok(
    {
      hubs: (rows as SafeZoneHubRow[]).map(v1Hub),
      cities,
    },
    {
      // Echoed back so a client/server disagreement about what was filtered is
      // visible rather than mysterious — same convention as /browse.
      applied: { city: city ?? null, type: type ?? null },
      // The cap a client must enforce in its own picker, sent rather than
      // hardcoded there, so the two cannot drift.
      maxHubsPerItem: MAX_ITEM_HUBS,
    },
  )
}
