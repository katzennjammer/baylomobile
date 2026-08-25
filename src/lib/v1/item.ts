import { resolvePickup, type PublicPickup } from "@/lib/item-visibility"
import { getLeafRank } from "@/lib/task-constants"
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
  totalTrades: number
  lifetimeLeaves: number
  rank: string
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
  status: string
  wanted: string | null
  pickup: PublicPickup | null
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
}

/**
 * One row to one wire object.
 *
 * `tradeAccessIds` comes from preciseAccessItemIds(). Omitting it is treated as
 * "no trade access", so a caller that forgets it under-shares rather than
 * over-shares — the same fail-safe direction resolvePickup() takes.
 */
export function v1Item(
  row: V1ItemRow,
  viewerId: string | null,
  tradeAccessIds?: Set<string>,
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
    status: row.status,
    wanted: row.wantedItems ?? null,
    pickup: resolvePickup(row, viewerId, tradeAccessIds),
    owner: {
      id: row.user.id,
      name: row.user.name,
      avatar: row.user.avatar,
      location: row.user.location,
      rating: row.user.rating,
      totalTrades: row.user.totalTrades,
      lifetimeLeaves: row.user.lifetimeLeaves,
      rank: getLeafRank(row.user.lifetimeLeaves).label,
    },
    stats: {
      likes: row._count?.likes ?? 0,
      liked: (row.likes?.length ?? 0) > 0,
      comments: row._count?.comments ?? 0,
    },
    createdAt: row.createdAt,
  }
}
