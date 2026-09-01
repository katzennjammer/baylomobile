import type { PrismaClient } from "@/generated/prisma/client"

/**
 * Safe-Zone Hubs — curated public meetup locations.
 *
 * WHY THIS EXISTS AT ALL, stated once here so no route has to restate it: the
 * obvious way to answer "where would we meet?" is to plot Item.pickupLat /
 * pickupLng on a map, and that publishes an approximate home address for every
 * seller who offers local pickup. Coarsening the pin does not fix it — a ~1 km
 * circle around a listing re-posted weekly from the same house resolves to that
 * house after a few observations. resolvePickup() in @/lib/item-visibility
 * already treats those columns as the seller's front door; a map would hand
 * them to everyone.
 *
 * A hub is a different kind of object. Nobody lives at a mall information desk.
 *
 * WHICH IS WHY HUB COORDINATES ARE PUBLIC AND PRECISE, and the single rule this
 * module enforces by convention is that they stay that way:
 *
 *   NEVER pass a hub latitude/longitude through coarsen().
 *
 * That function is a rule about sellers' homes. Applied to a hub it produces a
 * point somewhere in the general vicinity of the mall — useless to two people
 * trying to find each other, and protecting nobody. If you reach for it here,
 * the reach is the bug.
 *
 * The other half of the rule runs the other way and is enforced by code rather
 * than convention: NOTHING in the hub endpoints touches the pickup columns.
 * v1Hub() is constructed field by field from SAFE_ZONE_HUB_SELECT, and the item
 * shapes those endpoints emit go through the same v1Item() every other route
 * uses, so the hub coordinate is the only location that reaches a map.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export const SAFE_ZONE_TYPE_VALUES = [
  "MALL",
  "BARANGAY_HALL",
  "POLICE_STATION",
  "PUBLIC_PLAZA",
  "TRANSPORT_HUB",
] as const

export type SafeZoneTypeValue = (typeof SAFE_ZONE_TYPE_VALUES)[number]

/**
 * Database enum → wire value. An explicit closed map, not `.toLowerCase()`.
 *
 * The same call Item.valuationSource and ReportCategory document: a wire value
 * DERIVED from a database enum name changes the day somebody renames the enum,
 * and a shipped mobile client has already parsed the old spelling. Renaming
 * SafeZoneType.MALL now breaks this file's compilation, which is where you want
 * to find out.
 */
export const SAFE_ZONE_TYPE_WIRE: Record<SafeZoneTypeValue, string> = {
  MALL:           "mall",
  BARANGAY_HALL:  "barangay_hall",
  POLICE_STATION: "police_station",
  PUBLIC_PLAZA:   "public_plaza",
  TRANSPORT_HUB:  "transport_hub",
}

/** Display labels, resolved server-side so every surface reads the same words. */
export const SAFE_ZONE_TYPE_LABELS: Record<SafeZoneTypeValue, string> = {
  MALL:           "Mall",
  BARANGAY_HALL:  "Barangay hall",
  POLICE_STATION: "Police station",
  PUBLIC_PLAZA:   "Public plaza",
  TRANSPORT_HUB:  "Transport hub",
}

export const safeZoneTypeLabel = (t: string): string =>
  SAFE_ZONE_TYPE_LABELS[t as SafeZoneTypeValue] ?? t

export const safeZoneTypeWire = (t: string): string =>
  SAFE_ZONE_TYPE_WIRE[t as SafeZoneTypeValue] ?? t.toLowerCase()

// ── Limits ───────────────────────────────────────────────────────────────────

/**
 * The most hubs one listing may be offered at.
 *
 * Five, and the number is a product decision rather than a technical ceiling: a
 * listing offered at every hub in the city is not offering a meeting place, it
 * is opting out of the question while still appearing on every hub page. The
 * cap is what keeps GET /api/v1/hubs/[id]/items meaning something.
 */
export const MAX_ITEM_HUBS = 5

// ── The wire shape ───────────────────────────────────────────────────────────

/**
 * Exactly the columns v1Hub() needs. Explicit, never `true` — the same rule
 * ITEM_PUBLIC_SELECT states: a column added to this table tomorrow reaches no
 * client through this function until somebody puts it here on purpose.
 */
export const SAFE_ZONE_HUB_SELECT = {
  id: true,
  name: true,
  type: true,
  address: true,
  latitude: true,
  longitude: true,
  city: true,
  landmark: true,
  isActive: true,
} as const

export interface V1Hub {
  id: string
  name: string
  /** Wire form: "mall", "barangay_hall", … See SAFE_ZONE_TYPE_WIRE. */
  type: string
  typeLabel: string
  address: string
  /** PUBLIC AND PRECISE. Never coarsened. See the module note. */
  latitude: number
  longitude: number
  city: string
  /** The "where exactly" note — "ground floor, near the information desk". */
  landmark: string
  /**
   * FALSE MEANS "STILL LISTED HERE, BUT THIS PLACE IS NO LONGER A SAFE ZONE".
   *
   * A deactivated hub does not vanish from a listing already offered at it —
   * the association survives and is served with this flag false, so a client
   * renders it struck through instead of silently dropping the only answer that
   * listing had to "where would we meet?". GET /api/v1/hubs never returns one
   * of these; item detail can, and that asymmetry is the feature.
   */
  isActive: boolean
}

export interface SafeZoneHubRow {
  id: string
  name: string
  type: string
  address: string
  latitude: number
  longitude: number
  city: string
  landmark: string
  isActive: boolean
}

/** One row to one wire object. Constructed field by field, never spread. */
export function v1Hub(row: SafeZoneHubRow): V1Hub {
  return {
    id: row.id,
    name: row.name,
    type: safeZoneTypeWire(row.type),
    typeLabel: safeZoneTypeLabel(row.type),
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    city: row.city,
    landmark: row.landmark,
    isActive: row.isActive,
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

type HubDb = Pick<PrismaClient, "safeZoneHub">

export type HubResolution =
  | { ok: true; hubIds: string[] }
  | { ok: false; message: string }

/**
 * Turns a client-supplied array of hub ids into a validated list, or an error.
 *
 * THE IDS ARE CHECKED AGAINST THE TABLE, NEVER TRUSTED. A hub id is a foreign
 * key the client picks, so an unchecked one either 500s on the constraint or —
 * if that constraint were ever relaxed — writes a row pointing at nothing, and
 * the listing then claims a meeting place that does not exist. One SELECT
 * settles the whole array.
 *
 * THE ACTIVE RULE IS ASYMMETRIC, and this is the part worth reading:
 *
 *   A hub ALREADY associated with this listing may be kept even after it has
 *   been deactivated. A hub NOT already associated must be active to be added.
 *
 * The symmetric version — "only active hubs, full stop" — looks tidier and is
 * wrong. Clients round-trip the whole hub array on every edit, so the moment a
 * hub is deactivated every listing offered at it becomes uneditable: changing
 * the title 400s because the array still contains the closed mall, and the
 * owner's only way out is to notice and drop it. That is deactivation breaking
 * existing associations through the back door, which is the one thing this
 * feature is not allowed to do.
 *
 * `currentHubIds` is what makes the distinction available. Omitting it — the
 * create path, where there is nothing to retain — means every id must be
 * active, which is the fail-safe direction and matches how a forgotten
 * `tradeAccessIds` is treated as "no access" rather than "all access".
 */
export async function resolveHubIds(
  db: HubDb,
  requested: string[],
  currentHubIds: readonly string[] = [],
): Promise<HubResolution> {
  // De-duplicate first. The same hub sent twice is a client bug, not a request
  // for two associations, and the composite primary key would reject the second
  // write anyway — dedupe here so it never gets that far.
  const ids = [...new Set(requested)]

  if (ids.length > MAX_ITEM_HUBS) {
    return {
      ok: false,
      message: `A listing can be offered at at most ${MAX_ITEM_HUBS} Safe-Zone hubs`,
    }
  }
  if (ids.length === 0) return { ok: true, hubIds: [] }

  const rows = await db.safeZoneHub.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, isActive: true },
  })

  // Unknown ids are reported before inactive ones: "that hub does not exist" is
  // a different bug from "that hub has closed", and collapsing the two sends a
  // client author looking in the wrong place.
  const found = new Map(rows.map((r) => [r.id, r]))
  const missing = ids.filter((id) => !found.has(id))
  if (missing.length > 0) {
    return { ok: false, message: `Unknown Safe-Zone hub: ${missing.join(", ")}` }
  }

  const retained = new Set(currentHubIds)
  const newlyInactive = rows.filter((r) => !r.isActive && !retained.has(r.id))
  if (newlyInactive.length > 0) {
    return {
      ok: false,
      message: `That Safe-Zone hub is no longer available: ${newlyInactive
        .map((r) => r.name)
        .join(", ")}`,
    }
  }

  return { ok: true, hubIds: ids }
}

/**
 * Replaces a listing's hub associations with exactly `hubIds`.
 *
 * DELETE-THEN-INSERT inside the caller's transaction, rather than a diff. The
 * set is capped at MAX_ITEM_HUBS, so the diff would save at most four rows of
 * write and cost a comparison that can be got wrong; the crude version cannot
 * leave a stale row behind.
 *
 * `createdAt` on the surviving rows is reset by that, which is a real and
 * accepted loss: nothing reads it, and it is there for forensics rather than
 * for display. If something ever does read it, this becomes a diff.
 */
export async function setItemHubs(
  db: Pick<PrismaClient, "itemSafeZone">,
  itemId: string,
  hubIds: readonly string[],
): Promise<void> {
  await db.itemSafeZone.deleteMany({ where: { itemId } })
  if (hubIds.length === 0) return
  await db.itemSafeZone.createMany({
    data: hubIds.map((hubId) => ({ itemId, hubId })),
  })
}

// ── Meetup claims ────────────────────────────────────────────────────────────

export type MeetupClaim =
  | { ok: true; hubId: string }
  | { ok: false; message: string }

/**
 * Validates a claimed meetup hub against the two listings in a trade.
 *
 * THE RULE: the hub must be one that BOTH traded listings were already offered
 * at. Not either — both.
 *
 * THIS IS PRE-COMMITTED SELF-ATTESTATION, AND IT IS NOT VERIFICATION. Saying so
 * here, next to the code, because a foreign key and a validation function
 * together look like proof and are not:
 *
 *   NOT established — that these two people were at this place. Nothing in this
 *   system observes the physical world. A participant who wants the Leaves
 *   without making the trip sends byte-for-byte the same request as one who
 *   made it. No amount of checking on this side of the wire changes that.
 *
 *   Established — the claim is PRE-COMMITTED and MUTUAL. Both owners had to
 *   name this hub on their listing publicly and independently, before this
 *   trade existed, and the counterparty could see it when they made the offer.
 *   A false claim therefore has to be arranged in advance, by two people, in
 *   public, instead of ticked at the end by one of them. That is a real
 *   increase in the cost and the visibility of the lie. It is not proof, and
 *   the reward's honest description is "you both said in advance you would meet
 *   here, and afterwards you both said you did".
 *
 * The alternative that WOULD be verification — a GPS fix near the hub at
 * confirmation time — was considered and rejected: a client coordinate is
 * spoofable from a developer-options toggle, so without device attestation it
 * is a more elaborate checkbox, and every seeded landmark is indoors or under a
 * roof where GPS drifts 50-200 m. An honest-user-safe radius in a dense
 * commercial strip would cover several other hubs. A check that fails honest
 * users without stopping dishonest ones is worse than no check and a truthful
 * comment.
 *
 * ON isActive: a hub deactivated AFTER both listings named it still satisfies
 * this. The pre-commitment was made while it was open, the parties have already
 * met, and refusing the award afterwards would penalise them for an
 * administrative decision taken in between. Same asymmetry resolveHubIds()
 * applies, for the same reason.
 */
export async function resolveMeetupHub(
  db: Pick<PrismaClient, "itemSafeZone">,
  hubId: string,
  offeredItemId: string,
  requestedItemId: string,
): Promise<MeetupClaim> {
  // One query for both listings. The pair is at most MAX_ITEM_HUBS * 2 rows.
  const rows = await db.itemSafeZone.findMany({
    where: { hubId, itemId: { in: [offeredItemId, requestedItemId] } },
    select: { itemId: true },
  })

  const named = new Set(rows.map((r) => r.itemId))
  const bothNamed = named.has(offeredItemId) && named.has(requestedItemId)

  if (!bothNamed) {
    return {
      ok: false,
      message:
        "That Safe-Zone hub was not offered on both listings in this trade. " +
        "The meetup reward only applies to a hub both listings named in advance.",
    }
  }

  return { ok: true, hubId }
}
