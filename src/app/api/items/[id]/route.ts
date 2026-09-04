import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { parseBody, updateItemSchema } from "@/lib/validation"
import { imageHashRows, leadImageHash } from "@/lib/image-hashes"
import { decideItemValue } from "@/lib/valuation-server"
import { isBlockedEitherWay } from "@/lib/blocking"
import {
  ITEM_PUBLIC_SELECT,
  ITEM_PUBLIC_USER_SELECT,
  preciseAccessItemIds,
  shapeItem,
} from "@/lib/item-visibility"
import {
  SAFE_ZONE_HUB_SELECT,
  resolveHubIds,
  setItemHubs,
  v1Hub,
  type SafeZoneHubRow,
} from "@/lib/safe-zones"

/**
 * The item plus its hub associations, shaped for the wire.
 *
 * `safeZones` is peeled off and rebuilt rather than left to shapeItem()'s
 * spread, which would ship the raw `{ hub: { … } }` join shape straight to a
 * client. Same discipline as that function's explicit deletion of the pickup
 * columns: what goes on the wire is constructed, never inherited.
 *
 * INACTIVE HUBS STAY IN. A listing offered at a hub that has since closed keeps
 * saying so, carrying `isActive: false`, and the client strikes it through.
 * Filtering here would make deactivation silently rewrite other people's
 * listings, which is the one thing it is not allowed to do.
 */
function shapeItemWithHubs<T extends { safeZones: { hub: unknown }[] }>(
  row: T,
  viewerId: string | null | undefined,
  tradeAccessIds?: Set<string>,
) {
  const { safeZones, ...rest } = row
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...shapeItem(rest as any, viewerId, tradeAccessIds),
    safeZones: safeZones.map((s) => v1Hub(s.hub as SafeZoneHubRow)),
  }
}

/** The select every handler here uses: the public columns plus the hub join. */
const ITEM_WITH_HUBS_SELECT = {
  ...ITEM_PUBLIC_SELECT,
  user: { select: ITEM_PUBLIC_USER_SELECT },
  safeZones: { select: { hub: { select: SAFE_ZONE_HUB_SELECT } } },
} as const

/** Statuses a non-owner may read. REMOVED and TRADED listings are not public. */
const READABLE_BY_OTHERS = ["AVAILABLE", "IN_TRADE"] as const

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    // Authentication required. This route previously served any item by id to
    // anyone, at any status, with the raw pickup blob attached.
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const viewerId = session.user.id

    const { id } = await ctx.params
    const item = await prisma.item.findUnique({
      where: { id },
      select: ITEM_WITH_HUBS_SELECT,
    })
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Status filter. The owner still sees their own item in any state — they
    // need it for the shelf and the relist flow — and a trade counterparty needs
    // to see an item that has moved to TRADED/OWNED through their own trade.
    const isOwner = item.userId === viewerId
    const access = await preciseAccessItemIds(viewerId, [item.id])

    // The block and the moderator takedown both fold into `readable`, so all
    // four reasons for hiding a listing produce the same 404 below. The owner
    // is exempt from the takedown check: a listing that vanishes from its own
    // owner's view with no explanation is a support ticket, and the shelf needs
    // to render it in order to say "removed by a moderator".
    const blocked = isOwner ? false : await isBlockedEitherWay(viewerId, item.userId)
    const readable =
      isOwner ||
      (!blocked &&
        item.moderationHiddenAt === null &&
        (access.has(item.id) ||
          (READABLE_BY_OTHERS as readonly string[]).includes(item.status)))

    // 404 rather than 403: a hidden listing should not confirm its own existence.
    if (!readable) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json(shapeItemWithHubs(item, viewerId, access))
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await ctx.params
    // category, condition and valueLeaves are read back because the valuation
    // guard below needs the EFFECTIVE values, and a PATCH may name any subset
    // of the three. Validating a new value against a category the request did
    // not send would bound it by the wrong band.
    const item = await prisma.item.findUnique({
      where: { id },
      select: {
        userId: true, category: true, condition: true, valueLeaves: true,
        // Compared against the incoming array to tell a real photo change from
        // the web wizard restating the images it already had. See the hash
        // block below.
        images: true,
        // The hubs this listing ALREADY has. Needed by resolveHubIds() below,
        // which permits a deactivated hub to be RETAINED but not newly added --
        // see the long note on that function for why the symmetric rule makes
        // every affected listing uneditable.
        safeZones: { select: { hubId: true } },
      },
    })
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (item.userId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const parsed = await parseBody(req, updateItemSchema)
    if (!parsed.ok) return parsed.response
    const body = parsed.data

    // ── Valuation ───────────────────────────────────────────────────────────
    // Re-run whenever anything the model reads changes: the value itself, or
    // either of the two labels it is derived from. Editing a listing from GOOD
    // to POOR has to move the suggestion, or condition is decorative again on
    // the edit path even though it is enforced on create.
    //
    // Untouched by this request, all three keep their stored values and no
    // valuation runs — a PATCH that only changes the title must not re-price
    // the listing against a comparables set that has moved since it was posted.
    const valuationTouched =
      body.category !== undefined || body.condition !== undefined || body.valueLeaves !== undefined

    let valuationData: Record<string, unknown> = {}
    if (valuationTouched) {
      const category = body.category ?? item.category
      const condition = body.condition ?? item.condition
      // `valueLeaves` omitted while the category or condition moved means the
      // owner did not restate a price, so the stored one is what is being
      // re-checked against the new suggestion. If it no longer fits the new
      // band the request is rejected rather than silently re-priced: the owner
      // asked for a condition change, and being told the price no longer fits
      // is more useful than having the price changed without being told.
      const requested = body.valueLeaves !== undefined ? body.valueLeaves : item.valueLeaves

      const valued = await decideItemValue(category, condition, requested)
      if (!valued.ok) {
        return NextResponse.json(
          {
            error: valued.message,
            suggestedLeaves: valued.suggestedLeaves,
            allowed: valued.allowed,
          },
          { status: 400 },
        )
      }
      valuationData = valued.data
    }

    // ── Safe-Zone hubs ──────────────────────────────────────────────────────
    // Omitted leaves the associations alone; `[]` clears them. Same convention
    // as `localPickup` below, and it matters here for a specific reason: a
    // client PATCHing only the title must not have its listing silently
    // stripped of every meetup point it had.
    const hubsTouched = body.hubIds !== undefined
    const currentHubIds = item.safeZones.map((s) => s.hubId)
    const hubs = hubsTouched
      ? await resolveHubIds(prisma, body.hubIds!, currentHubIds)
      : null
    if (hubs && !hubs.ok) {
      return NextResponse.json({ error: hubs.message }, { status: 400 })
    }

    // Pickup is only rewritten when the request actually says something about
    // it. `localPickup: false` clears it; omitting the field leaves it alone.
    const pickupTouched = body.localPickup !== undefined
    const hasPickup =
      body.localPickup === true && body.pickupLat != null && body.pickupLng != null

    // ── Which requests restate the photo hashes ─────────────────────────────
    //
    // Same convention as the hubs above — omitting leaves them alone — but the
    // test cannot simply be "was a hash field sent", because the WEB wizard
    // sends `imageHash` and `images` on every edit whether or not the photos
    // moved. Taking that as a restatement would delete a mobile listing's five
    // per-photo rows and write back the single lead hash the web client knows,
    // so editing a title in the browser would quietly drop four photos out of
    // the duplicate pool. That is the same bug as the AVAILABLE filter wearing
    // a different hat, and it would be even harder to notice.
    //
    // So:
    //   - `imageHashes` sent  -> the client knows every photo. Authoritative.
    //   - photos actually changed -> the stored rows describe images that are
    //     gone, so they must go too; the lead hash is all this client knows.
    //   - otherwise -> leave the rows alone.
    const imagesChanged =
      body.images !== undefined &&
      JSON.stringify(body.images) !== item.images
    const hashesTouched = body.imageHashes !== undefined || imagesChanged
    const hashRows = imageHashRows(body)

    const updated = await prisma.item.update({
      where: { id },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.condition !== undefined && { condition: body.condition }),
        // valueLeaves comes from the guard, never straight from the body — it
        // arrives with suggestedLeaves and valuationSource so the three columns
        // are always written together and cannot describe different valuations.
        ...valuationData,
        ...(body.images !== undefined && { images: JSON.stringify(body.images) }),
        ...(body.wantedItems !== undefined && { wantedItems: body.wantedItems }),
        ...(hashesTouched && { imageHash: leadImageHash(hashRows) }),
        ...(pickupTouched
          ? hasPickup
            ? {
                pickupLat: body.pickupLat!,
                pickupLng: body.pickupLng!,
                pickupAddress: body.pickupAddress ?? null,
              }
            : { pickupLat: null, pickupLng: null, pickupAddress: null }
          : {}),
      },
      select: ITEM_WITH_HUBS_SELECT,
    })

    // The hub rewrite is a separate statement because it is a delete-then-
    // insert over a join table, which `update` cannot express in one `data`.
    // In a TRANSACTION with nothing else, on purpose: this is not atomic with
    // the column update above, and it does not need to be. The two failure
    // modes are "the title changed but the hubs did not" and "vice versa", both
    // of which the owner can see and fix from the edit screen. Wrapping the
    // whole PATCH in a transaction to buy that would put a valuation query --
    // which reads comparables across the whole Item table -- inside a write
    // transaction on the hottest table here, and a slow write transaction is a
    // lock-wait timeout waiting for a busy evening.
    if (hubs?.ok) {
      await prisma.$transaction((tx) => setItemHubs(tx, id, hubs.hubIds))
    }

    // ── The per-photo hashes ────────────────────────────────────────────────
    //
    // Delete-then-insert, like the hubs above and for the same reason: `update`
    // cannot express a positional rewrite of a child table in one `data`.
    //
    // ONLY WHEN THE CLIENT ACTUALLY SENT HASHES. A PATCH that changes the title
    // and nothing else must not empty this listing's rows and silently drop it
    // out of the duplicate pool — which is the same class of bug as the
    // AVAILABLE filter, arriving by a different door.
    //
    // Not in a transaction with the column update, on the same reasoning the
    // hub comment gives. The window between the delete and the insert is one
    // statement wide, and the worst a concurrent check sees is this listing's
    // own photos missing from the pool for that moment. Its owner is not the
    // person that pool is defending against.
    if (hashesTouched) {
      await prisma.$transaction(async (tx) => {
        await tx.itemImageHash.deleteMany({ where: { itemId: id } })
        if (hashRows.length > 0) {
          await tx.itemImageHash.createMany({
            data: hashRows.map((r) => ({ itemId: id, ...r })),
          })
        }
      })
    }

    // Re-read only when the hubs actually moved: the `updated` row above was
    // selected before the join was rewritten, so its safeZones are stale in
    // exactly that case and correct in every other.
    const finalRow = hubs?.ok
      ? await prisma.item.findUniqueOrThrow({ where: { id }, select: ITEM_WITH_HUBS_SELECT })
      : updated

    return NextResponse.json(shapeItemWithHubs(finalRow, session.user.id))
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await ctx.params
    const item = await prisma.item.findUnique({ where: { id }, select: { userId: true } })
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (item.userId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // Soft delete, and the pickup point goes with it — a delisted item has no
    // reason to keep the owner's coordinates on file.
    await prisma.item.update({
      where: { id },
      data: { status: "REMOVED", pickupLat: null, pickupLng: null, pickupAddress: null },
    })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
