import { resolvePickup, type PublicPickup } from "@/lib/item-visibility"
import { getLeafRank } from "@/lib/task-constants"
import type { TrustTier } from "@/lib/reputation"
import {
  SAFE_ZONE_HUB_SELECT,
  v1Hub,
  type SafeZoneHubRow,
  type V1Hub,
} from "@/lib/safe-zones"
import { categoryLabel, conditionLabel } from "./taxonomy"

/**
 * The one Item shape, rendered by /home, /browse, /items/[id] and both profile
 * screens.
 *
 * Defined once so those screens cannot drift apart the way the current web
 * pages have — tradeplace and listings/[id] already map their own rows their own
 * ways and disagree about which owner fields exist.
 *
 * Two deliberate differences from the web's shapeItem():
 *
 *   - The object is CONSTRUCTED FIELD BY FIELD, never spread from the row.
 *     shapeItem() spreads and then deletes the three pickup columns, which is
 *     safe only for the columns someone remembered to delete: it is why
 *     `wantedItems` still ships alongside its own replacement, and it is the
 *     same pattern that leaked pickup coordinates in the first place. A column
 *     added to Item tomorrow reaches no client through this function.
 *
 *   - `wantedItems` is gone (D3). The free text survives as `wanted`; the raw
 *     column name does not appear. The live /api/items contract is untouched —
 *     removing it there is its own change.
 *
 * Pickup still goes through resolvePickup(), the shared rule, so precise
 * coordinates reach only the owner and an accepted counterparty.
 */

/** Exactly the Item columns this shape needs. Explicit, never `true`. */
export const V1_ITEM_SELECT = {
  id: true,
  title: true,
  description: true,
  images: true,
  category: true,
  condition: true,
  valueLeaves: true,
  suggestedLeaves: true,
  valuationSource: true,
  status: true,
  wantedItems: true, // read only to produce `wanted`; never emitted under this name
  imageHash: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
  // Needed by resolvePickup(). The route resolves them; they never reach a body.
  pickupLat: true,
  pickupLng: true,
  pickupAddress: true,
} as const

/**
 * The owner block. Wider than ITEM_PUBLIC_USER_SELECT by one field — `location`
 * — which is what lets the detail screen render from the same object as the
 * feed instead of issuing a second request for it.
 */
export const V1_ITEM_OWNER_SELECT = {
  id: true,
  name: true,
  avatar: true,
  location: true,
  rating: true,
  totalTrades: true,
  lifetimeLeaves: true,
} as const

/**
 * The Safe-Zone hubs this listing is offered at.
 *
 * A SEPARATE, OPT-IN SELECT rather than part of V1_ITEM_SELECT. Every feed row
 * would otherwise carry a join it does not render: /home and /browse show a
 * card, and a card has no room for five meetup points. Detail screens spread
 * this in; lists do not, and the cost stays where the value is.
 *
 * INACTIVE HUBS ARE INCLUDED. That is the whole point of the flag — a listing
 * offered at a hub that has since closed keeps saying so, and the client
 * renders it struck through rather than the listing silently losing the only
 * answer it had to "where would we meet?". Filtering them out here would undo
 * the guarantee the deactivation path is built around.
 */
export const V1_ITEM_SAFEZONE_SELECT = {
  safeZones: { select: { hub: { select: SAFE_ZONE_HUB_SELECT } } },
} as const

/**
 * Hub rows to wire objects: active first, then alphabetical.
 *
 * Sorted here rather than in SQL because the set is capped at MAX_ITEM_HUBS and
 * ordering five items in memory is free, while `orderBy` across a join is one
 * more thing each call site has to remember to spell the same way.
 */
export function v1ItemHubs(
  rows: { hub: SafeZoneHubRow }[] | undefined,
): V1Hub[] | null {
  if (!rows) return null
  return rows
    .map((r) => v1Hub(r.hub))
    .sort((a, b) =>
      a.isActive === b.isActive ? a.name.localeCompare(b.name) : a.isActive ? -1 : 1,
    )
}

/** Like/comment counts, plus whether THIS viewer has liked it. */
export function v1ItemStatsSelect(viewerId: string) {
  return {
    _count: { select: { likes: true, comments: true } },
    likes: { where: { userId: viewerId }, select: { id: true }, take: 1 },
  } as const
}

export interface V1Owner {
  id: string
  name: string
  avatar: string | null
  location: string | null
  rating: number
  /**
   * The denormalised counter. STILL SENT, because clients render it as a plain
   * "N trades" statistic — but it is NOT what `trustTier` is computed from, and
   * nothing should derive a tier from it. It has drifted above the real
   * COMPLETED count on live rows. See `loadEffectiveTiers`.
   */
  totalTrades: number
  lifetimeLeaves: number
  /** The LEAF ladder — Seedling / Sprout / Grower / Guardian, from earnings. */
  rank: string
  /**
   * The TRUST ladder — New / Rising / Trusted / Top Trader, from completed
   * trades and rating, after DPA defaults are charged against it. This is the
   * "safe to trade with" signal and it is the same value the contract gates
   * enforce with, so a badge rendered from it can never promise something the
   * server will then refuse.
   *
   * NULL WHERE THE ENDPOINT DID NOT RESOLVE IT. Deriving it costs three
   * aggregate queries per page, so a route opts in by passing `tiers` to
   * v1Item(); /home does. Null means "not computed here", never "New Trader" —
   * a client must not collapse the two, because the quietest badge on the
   * ladder is a claim about someone and absence is not.
   */
  trustTier: TrustTier | null
}

export interface V1Item {
  id: string
  title: string
  description: string
  images: string[]
  category: string
  categoryLabel: string
  condition: string
  conditionLabel: string
  valueLeaves: number | null
  /** The model's number before the owner adjusted it. NULL predates the model. */
  suggestedLeaves: number | null
  /** "comparables" | "category_band" | null for pre-model listings. */
  valuationSource: string | null
  status: string
  wanted: string | null
  pickup: PublicPickup | null
  /**
   * The public meetup points this listing is offered at.
   *
   * NULL MEANS "THIS ENDPOINT DID NOT LOAD THEM", never "none" — the same rule
   * `trustTier` follows, and for the same reason. An empty ARRAY is the real
   * answer for a delivery-only or chat-arranged listing, and a client that
   * collapses the two would render "no meetup points" on every feed card, which
   * is a claim about the listing that the feed never actually checked.
   *
   * Populated only where V1_ITEM_SAFEZONE_SELECT was spread into the query.
   */
  safeZones: V1Hub[] | null
  owner: V1Owner
  stats: { likes: number; liked: boolean; comments: number }
  createdAt: Date
}

/**
 * `images` is stored as a JSON string. A malformed value yields an empty array
 * rather than throwing: one bad row should not take down a whole feed page.
 */
function parseImages(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((u): u is string => typeof u === "string")
  } catch {
    return []
  }
}

/** The row shape v1Item() consumes — what V1_ITEM_SELECT plus the joins yield. */
export interface V1ItemRow {
  id: string
  title: string
  description: string
  images: string
  category: string
  condition: string
  valueLeaves: number | null
  suggestedLeaves: number | null
  valuationSource: string | null
  status: string
  wantedItems: string | null
  createdAt: Date
  userId: string
  pickupLat: number | null
  pickupLng: number | null
  pickupAddress: string | null
  user: {
    id: string
    name: string
    avatar: string | null
    location: string | null
    rating: number
    totalTrades: number
    lifetimeLeaves: number
  }
  _count?: { likes: number; comments: number }
  likes?: { id: string }[]
  /** Present only when V1_ITEM_SAFEZONE_SELECT was spread into the select. */
  safeZones?: { hub: SafeZoneHubRow }[]
}

/**
 * One row to one wire object.
 *
 * `tradeAccessIds` comes from preciseAccessItemIds(). Omitting it is treated as
 * "no trade access", so a caller that forgets it under-shares rather than
 * over-shares — the same fail-safe direction resolvePickup() takes.
 *
 * `tiers` comes from loadEffectiveTiers() and follows the same rule: omitting
 * it yields a null tier rather than a guessed one.
 */
export function v1Item(
  row: V1ItemRow,
  viewerId: string | null,
  tradeAccessIds?: Set<string>,
  tiers?: ReadonlyMap<string, TrustTier>,
): V1Item {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    images: parseImages(row.images),
    category: row.category,
    categoryLabel: categoryLabel(row.category),
    condition: row.condition,
    conditionLabel: conditionLabel(row.condition),
    valueLeaves: row.valueLeaves,
    suggestedLeaves: row.suggestedLeaves,
    valuationSource: row.valuationSource,
    status: row.status,
    wanted: row.wantedItems ?? null,
    pickup: resolvePickup(row, viewerId, tradeAccessIds),
    // null when the caller did not select them. See the note on the field: a
    // caller that forgot under-claims rather than asserting "none".
    safeZones: v1ItemHubs(row.safeZones),
    owner: {
      id: row.user.id,
      name: row.user.name,
      avatar: row.user.avatar,
      location: row.user.location,
      rating: row.user.rating,
      totalTrades: row.user.totalTrades,
      lifetimeLeaves: row.user.lifetimeLeaves,
      rank: getLeafRank(row.user.lifetimeLeaves).label,
      // ?? null, not ?? a default tier. A caller that forgot the map
      // under-claims rather than inventing a rung for someone.
      trustTier: tiers?.get(row.user.id) ?? null,
    },
    stats: {
      likes: row._count?.likes ?? 0,
      liked: (row.likes?.length ?? 0) > 0,
      comments: row._count?.comments ?? 0,
    },
    createdAt: row.createdAt,
  }
}
