import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { leafBalances } from "@/lib/leaves"
import { ok, unauthenticated, invalid } from "@/lib/v1/envelope"
import { parseQuery, paginationShape, MAX_LIMIT } from "@/lib/v1/query"
import { decodeCursor, encodeCursor, paginate, cursorDate } from "@/lib/v1/cursor"
import { SAFE_ZONE_HUB_SELECT, v1Hub, type SafeZoneHubRow } from "@/lib/safe-zones"

export const dynamic = "force-dynamic"

/**
 * GET /api/v1/trades?tab=active|history — the trades screen.
 *
 * FIVE Prisma calls, not the four the shapes proposed. The proposal counted
 * "viewer balance plus pending-offer sum" as one step; it is two calls
 * (user.findUnique + offer.aggregate), and they live behind leafBalances() so
 * the over-commit clamp stays in one place rather than being inlined here.
 * Reported honestly rather than rounded down:
 *
 *   1,2  viewer balance and committed-leaves sum (leafBalances)
 *   3    trades page
 *   4    offers
 *   5    pending incoming count
 *
 * `kind` is the whole point of D2. The client is never told that
 * offeredItemId === requestedItemId means anything, because here it does not
 * mean anything — `offeredLeaves` is a real column now and `kind` is derived
 * from it, not from an id-equality trick.
 */

const ACTIVE_STATES = ["PENDING", "ACCEPTED", "CONFIRMING"] as const
const HISTORY_STATES = ["COMPLETED", "REJECTED", "CANCELLED"] as const

const querySchema = z.strictObject({
  ...paginationShape,
  tab: z.enum(["active", "history"]).optional().default("active"),
})

/** First image of an item, or null. Stored as a JSON string. */
function firstImage(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : null
  } catch {
    return null
  }
}

const ITEM_BRIEF = { id: true, title: true, images: true, status: true } as const
const USER_BRIEF = { id: true, name: true, avatar: true } as const

export async function GET(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const viewerId = session.user.id

  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response
  const { limit, tab } = parsed.data
  const cursor = decodeCursor(parsed.data.cursor)
  if (parsed.data.cursor && !cursor) return invalid("Malformed cursor")

  const states = tab === "active" ? ACTIVE_STATES : HISTORY_STATES

  // ── 1, 2 ── balances.
  const balances = await leafBalances(prisma, viewerId)

  // ── 3 ── the trades page.
  //
  // Sorted on updatedAt, not createdAt: this list is "what moved recently", and
  // a trade that just advanced to CONFIRMING belongs at the top. The keyset is
  // therefore (updatedAt, id) and is spelled out here rather than reusing
  // olderThan(), which is createdAt-specific.
  const cDate = cursorDate(cursor)
  const keyset =
    cDate && cursor
      ? {
          OR: [
            { updatedAt: { lt: cDate } },
            { AND: [{ updatedAt: cDate }, { id: { lt: cursor.id } }] },
          ],
        }
      : undefined

  const tradeRows = await prisma.tradeRequest.findMany({
    where: {
      status: { in: [...states] },
      OR: [
        { senderId: viewerId, hiddenBySender: false },
        { receiverId: viewerId, hiddenByReceiver: false },
      ],
      ...(keyset ?? {}),
    },
    select: {
      id: true,
      status: true,
      offeredLeaves: true,
      // The hub is selected; the legacy `safeZoneMeetup` boolean on the wire is
      // DERIVED from it below. One source of truth, two field names -- a stored
      // boolean beside the key is a second source of truth that can disagree
      // with the first, which is exactly how the offeredLeaves bug happened.
      safeZoneHubId: true,
      safeZoneHub: { select: SAFE_ZONE_HUB_SELECT },
      createdAt: true,
      updatedAt: true,
      senderId: true,
      receiverId: true,
      sender: { select: USER_BRIEF },
      receiver: { select: USER_BRIEF },
      offeredItem: { select: ITEM_BRIEF },
      requestedItem: { select: ITEM_BRIEF },
      // Code state, so canConfirm is a real answer rather than a guess from
      // status alone. At most two rows per trade.
      swapConfirmationCodes: { select: { userId: true, used: true, expiresAt: true } },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  })
  const { page, nextCursor } = paginate(tradeRows, limit, (r) =>
    encodeCursor(r.updatedAt, r.id),
  )

  // ── 4 ── offers in both directions. Capped, not paginated: the shapes put the
  // cursor on `trades`, and a screen showing more than 50 live offers has a
  // different problem than pagination.
  const offerRows = await prisma.offer.findMany({
    where: { OR: [{ senderId: viewerId }, { receiverId: viewerId }], status: "PENDING" },
    select: {
      id: true, status: true, offeredItems: true, offeredLeaves: true,
      message: true, createdAt: true, senderId: true, receiverId: true,
      post: { select: ITEM_BRIEF },
      sender: { select: USER_BRIEF },
      receiver: { select: USER_BRIEF },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_LIMIT,
  })

  // ── 5 ── incoming still awaiting this viewer.
  const pendingIncoming = await prisma.tradeRequest.count({
    where: { receiverId: viewerId, status: "PENDING", hiddenByReceiver: false },
  })

  const now = Date.now()

  const trades = page.map((t) => {
    const isSender = t.senderId === viewerId
    const partnerId = isSender ? t.receiverId : t.senderId
    const counterparty = isSender ? t.receiver : t.sender
    // D2: kind comes from the column, never from offeredItemId === requestedItemId.
    const kind = (t.offeredLeaves ?? 0) > 0 ? "leaves" : "items"

    // The viewer submits their PARTNER's code, so it is the partner's row that
    // records whether this viewer has already confirmed.
    const partnerCode = t.swapConfirmationCodes.find((c) => c.userId === partnerId)
    const partnerCodeLive = !!partnerCode && partnerCode.expiresAt.getTime() > now
    const canConfirm =
      t.status === "ACCEPTED" ||
      (t.status === "CONFIRMING" && (!partnerCodeLive || !partnerCode.used))

    return {
      id: t.id,
      status: t.status,
      direction: isSender ? "sent" : "received",
      kind,
      offeredLeaves: t.offeredLeaves,
      counterparty,
      // On a leaves trade the "offered item" column holds the listing itself as
      // a placeholder. It is not a real offered item, so it is not sent.
      offeredItem:
        kind === "leaves"
          ? null
          : { ...t.offeredItem, image: firstImage(t.offeredItem.images), images: undefined },
      requestedItem: {
        ...t.requestedItem,
        image: firstImage(t.requestedItem.images),
        images: undefined,
      },
      // Kept on the wire under its original name so a shipped client that reads
      // it keeps working, but computed rather than stored. See the select above.
      safeZoneMeetup: t.safeZoneHubId !== null,
      /** Which hub, when one was claimed. NULL for every trade that named none. */
      safeZoneHub: t.safeZoneHub ? v1Hub(t.safeZoneHub as SafeZoneHubRow) : null,
      canConfirm,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }
  })

  const offers = offerRows.map((o) => {
    const isSender = o.senderId === viewerId
    let offeredItems: { id: string; title: string; image: string | null }[] = []
    try {
      const parsedItems: unknown = JSON.parse(o.offeredItems)
      if (Array.isArray(parsedItems)) {
        offeredItems = parsedItems
          .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
          .map((x) => ({
            id: String(x.id ?? ""),
            title: typeof x.title === "string" ? x.title : "Item",
            image: typeof x.image === "string" ? x.image : null,
          }))
      }
    } catch {
      offeredItems = []
    }
    return {
      id: o.id,
      direction: isSender ? "sent" : "received",
      status: o.status,
      post: { ...o.post, image: firstImage(o.post.images), images: undefined },
      offeredItems,
      offeredLeaves: o.offeredLeaves,
      message: o.message,
      counterparty: isSender ? o.receiver : o.sender,
      createdAt: o.createdAt,
    }
  })

  return ok(
    {
      viewer: { leaves: balances.leaves, availableLeaves: balances.available },
      pendingIncoming,
      trades,
      offers,
    },
    { nextCursor },
  )
}
