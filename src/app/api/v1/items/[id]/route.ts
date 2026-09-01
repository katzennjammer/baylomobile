import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { preciseAccessItemIds } from "@/lib/item-visibility"
import { visibleItemWhere } from "@/lib/blocking"
import { loadEffectiveTiers } from "@/lib/contracts"
import { ok, unauthenticated, notFound } from "@/lib/v1/envelope"
import { parseQuery } from "@/lib/v1/query"
import { V1_ITEM_SELECT, V1_ITEM_OWNER_SELECT, V1_ITEM_SAFEZONE_SELECT, v1ItemStatsSelect, v1Item, type V1ItemRow } from "@/lib/v1/item"

export const dynamic = "force-dynamic"

/**
 * GET /api/v1/items/[id] — item detail, plus everything the viewer needs to
 * make an offer without a second request.
 *
 * FIVE queries, not the three the shapes proposed. The proposal counted "pickup
 * access plus any existing offer" as one step — they are two different tables —
 * and it did not account for the viewer's Leaf balance, which the offer sheet
 * needs. Four of the five run concurrently, so it costs two round trips of
 * latency, but it is five queries and this comment is not going to call it three.
 *
 *   1  item with owner
 *   2  pickup access
 *   3  any existing pending offer from this viewer
 *   4  the viewer's tradeable items, for the offer sheet's picker
 *   5  the viewer's Leaf balance
 *   6  the owner's trust tier (three aggregates, inside loadEffectiveTiers)
 *
 * ON (6), ADDED FOR THE ITEM DETAIL SCREEN. This route used to send
 * `owner.trustTier: null` — the field existed and was never populated, because
 * resolving it costs three aggregates and no screen drew the badge. The mobile
 * detail screen does, and this is the one screen where the badge earns those
 * queries: it is where somebody decides whether to go and meet a stranger.
 *
 * DELIBERATELY NOT THE CLIENT-SIDE FALLBACK. `resolveTier()` in the app can
 * derive a tier from `totalTrades` and `rating` without a round trip, and its
 * own comment says it reads high — it works off a denormalised counter that has
 * drifted above the real completed count, and it cannot see DPA defaults at
 * all. An inflated trust badge is worse than no badge on this screen, so the
 * server answers or nobody does.
 *
 * One owner, so the aggregates are over a single id and this is cheap. It runs
 * in the same Promise.all as 2-5 and costs no extra round trip of latency.
 *
 * 404 rather than 403 for a REMOVED item or one the viewer may not read. A 403
 * confirms the row exists, and a hidden listing should not confirm it exists —
 * this matches what the current /api/items/[id] already does.
 */

const querySchema = z.strictObject({})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const viewerId = session.user.id
  const { id } = await params

  // No query parameters are accepted here; anything sent is a mistake worth
  // surfacing rather than ignoring.
  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response

  // ── 1 ──
  //
  // findFirst with visibleItemWhere(), not findUnique by id. The block and the
  // takedown are part of the WHERE, so a listing the viewer may not see simply
  // does not come back and the 404 below covers it — rather than being fetched
  // and then rejected by a second `if`, which is the shape that eventually
  // grows a path around it.
  const item = await prisma.item.findFirst({
    where: { id, ...visibleItemWhere(viewerId) },
    select: {
      ...V1_ITEM_SELECT,
      imageHash: true,
      updatedAt: true,
      user: { select: V1_ITEM_OWNER_SELECT },
      ...v1ItemStatsSelect(viewerId),
      // Detail only, never the feed. Still one query -- a nested select, not a
      // second round trip -- so the count in the header above holds.
      //
      // The hub coordinate that comes back through here is PRECISE, and that is
      // correct: it is a mall entrance, not a seller's house. The seller's own
      // pickup point in this same response is still filtered by resolvePickup()
      // exactly as it is everywhere else. Two location fields, two different
      // rules, and the difference is whether anybody lives there.
      ...V1_ITEM_SAFEZONE_SELECT,
    },
  })

  // 404 for absent, REMOVED, moderator-hidden, and blocked-either-way alike.
  // Deliberately one answer for all four: a 403 on the blocked case would tell
  // the blocked party that the listing exists and therefore that they have been
  // blocked, which hands a harasser a signal to switch accounts.
  if (!item || item.status === "REMOVED") return notFound("Item not found")

  const isOwner = item.userId === viewerId

  // ── 2, 3, 4, 5, 6 ── concurrent: none depends on another.
  const [access, existingOffer, tradeable, viewerRow, tiers] = await Promise.all([
    preciseAccessItemIds(viewerId, [item.id]),
    isOwner
      ? Promise.resolve(null)
      : prisma.offer.findFirst({
          where: { postId: item.id, senderId: viewerId, status: "PENDING" },
          select: { id: true },
          orderBy: { createdAt: "desc" },
        }),
    isOwner
      ? Promise.resolve([])
      : prisma.item.findMany({
          where: { userId: viewerId, status: "AVAILABLE", moderationHiddenAt: null },
          select: { id: true, title: true, images: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 50,
        }),
    prisma.user.findUnique({ where: { id: viewerId }, select: { leaves: true } }),
    // The same function the contract gates enforce with, so the badge on this
    // screen can never promise something the server would then refuse.
    loadEffectiveTiers(prisma, [{ id: item.userId, rating: item.user.rating }]),
  ])

  const shaped = v1Item(item as unknown as V1ItemRow, viewerId, access, tiers)

  const firstImage = (raw: string): string | null => {
    try {
      const parsedImages: unknown = JSON.parse(raw)
      return Array.isArray(parsedImages) && typeof parsedImages[0] === "string"
        ? parsedImages[0]
        : null
    } catch {
      return null
    }
  }

  return ok({
    item: { ...shaped, imageHash: item.imageHash, updatedAt: item.updatedAt },
    viewer: {
      isOwner,
      // An owner cannot offer on their own listing, and neither can anyone once
      // it has left AVAILABLE.
      canOffer: !isOwner && item.status === "AVAILABLE",
      leaves: viewerRow?.leaves ?? 0,
      tradeableItems: tradeable.map((t) => ({
        id: t.id,
        title: t.title,
        image: firstImage(t.images),
      })),
      existingOfferId: existingOffer?.id ?? null,
    },
  })
}
