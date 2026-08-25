import prisma from "@/lib/prisma"

/**
 * Who is allowed to see an item's exact pickup point, and what everyone else
 * gets instead.
 *
 * The rule, stated once here so no route has to restate it: full-precision
 * coordinates and the reverse-geocoded postal address are the seller's home. A
 * marketplace listing is public; the seller's front door is not. Precise pickup
 * therefore goes to exactly two kinds of viewer —
 *
 *   - the item's owner, and
 *   - a counterparty who has been ACCEPTED into a trade for that item,
 *
 * and to nobody else. Everyone else sees `lat`/`lng` rounded to 2 decimal
 * places and no address at all.
 *
 * 2 dp is ~1.1 km of latitude, which is enough to answer "is this near me?" —
 * the only question a browsing user needs answered — and not enough to pick a
 * building. Rounding is done here, on the server, before the number reaches a
 * response body. Sending exact coordinates with a "display coarsely" flag would
 * put the real value on the wire, where a client is free to ignore the flag.
 */

/** Trade states in which a counterparty has legitimately been let in. */
const ACCEPTED_TRADE_STATES = ["ACCEPTED", "CONFIRMING", "COMPLETED"] as const

/** ~1.1 km. See the note above on why this happens server-side. */
export function coarsen(n: number): number {
  return Math.round(n * 100) / 100
}

/** The pickup shape that goes on the wire. `address` is null unless precise. */
export interface PublicPickup {
  lat: number
  lng: number
  address: string | null
  /** False means lat/lng are the ~1 km rounding, not the real point. */
  precise: boolean
}

/** The subset of Item columns resolvePickup() needs. */
export interface PickupSource {
  id: string
  userId: string
  pickupLat: number | null
  pickupLng: number | null
  pickupAddress: string | null
}

/**
 * Item ids, out of `itemIds`, for which `viewerId` has been accepted into a
 * trade. One query for the whole page — a per-item check would be an N+1 on the
 * feed, and a slow authorisation check is one that eventually gets skipped.
 *
 * Returns an empty set for an anonymous viewer, which is the safe default: no
 * viewer id, no precise coordinates.
 */
export async function preciseAccessItemIds(
  viewerId: string | null | undefined,
  itemIds: string[],
): Promise<Set<string>> {
  if (!viewerId || itemIds.length === 0) return new Set()

  const trades = await prisma.tradeRequest.findMany({
    where: {
      status: { in: [...ACCEPTED_TRADE_STATES] },
      OR: [{ senderId: viewerId }, { receiverId: viewerId }],
      AND: [{ OR: [{ offeredItemId: { in: itemIds } }, { requestedItemId: { in: itemIds } }] }],
    },
    select: { offeredItemId: true, requestedItemId: true },
  })

  const allowed = new Set<string>()
  const requested = new Set(itemIds)
  for (const t of trades) {
    if (requested.has(t.offeredItemId)) allowed.add(t.offeredItemId)
    if (requested.has(t.requestedItemId)) allowed.add(t.requestedItemId)
  }
  return allowed
}

/**
 * The pickup object for one item as `viewerId` is allowed to see it, or null
 * when the item has no pickup location.
 *
 * `tradeAccessIds` comes from preciseAccessItemIds(). Omitting it is treated as
 * "no trade access", so a caller that forgets to pass it under-shares rather
 * than over-shares.
 */
export function resolvePickup(
  item: PickupSource,
  viewerId: string | null | undefined,
  tradeAccessIds?: Set<string>,
): PublicPickup | null {
  if (item.pickupLat == null || item.pickupLng == null) return null

  const isOwner = !!viewerId && item.userId === viewerId
  const inTrade = !!viewerId && !!tradeAccessIds?.has(item.id)

  if (isOwner || inTrade) {
    return {
      lat: item.pickupLat,
      lng: item.pickupLng,
      address: item.pickupAddress ?? null,
      precise: true,
    }
  }

  return {
    lat: coarsen(item.pickupLat),
    lng: coarsen(item.pickupLng),
    address: null,
    precise: false,
  }
}

/**
 * The Item columns every public read path selects.
 *
 * Explicit, and deliberately not `true`. `findMany` without a select returns
 * whatever columns the schema happens to have, so a column added later ships to
 * clients the day it is added — which is exactly how pickup coordinates became
 * public. Note the three pickup columns ARE selected: resolvePickup() needs
 * them, and the route drops them from the response.
 */
export const ITEM_PUBLIC_SELECT = {
  id: true,
  title: true,
  description: true,
  images: true,
  category: true,
  condition: true,
  valueLeaves: true,
  // The valuation provenance travels with the value. A client that renders a
  // number the model produced and a number the owner typed identically, with no
  // way to tell them apart, is the interface that made the old AI attribution
  // sound true in the first place.
  suggestedLeaves: true,
  valuationSource: true,
  status: true,
  wantedItems: true,
  imageHash: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
  pickupLat: true,
  pickupLng: true,
  pickupAddress: true,
} as const

export const ITEM_PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  avatar: true,
  rating: true,
  totalTrades: true,
  lifetimeLeaves: true,
} as const

type ItemRow = PickupSource & Record<string, unknown>

/**
 * Strips the raw pickup columns off an item row and replaces them with the
 * filtered `pickup` object. The three source columns are deleted rather than
 * overwritten, so a response can never carry both.
 */
export function shapeItem<T extends ItemRow>(
  item: T,
  viewerId: string | null | undefined,
  tradeAccessIds?: Set<string>,
) {
  const pickup = resolvePickup(item, viewerId, tradeAccessIds)
  const rest = { ...item } as Record<string, unknown>
  delete rest.pickupLat
  delete rest.pickupLng
  delete rest.pickupAddress
  return { ...rest, wanted: item.wantedItems ?? null, pickup }
}
