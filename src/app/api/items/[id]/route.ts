import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { parseBody, updateItemSchema } from "@/lib/validation"
import { decideItemValue } from "@/lib/valuation-server"
import {
  ITEM_PUBLIC_SELECT,
  ITEM_PUBLIC_USER_SELECT,
  preciseAccessItemIds,
  shapeItem,
} from "@/lib/item-visibility"

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
      select: { ...ITEM_PUBLIC_SELECT, user: { select: ITEM_PUBLIC_USER_SELECT } },
    })
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Status filter. The owner still sees their own item in any state — they
    // need it for the shelf and the relist flow — and a trade counterparty needs
    // to see an item that has moved to TRADED/OWNED through their own trade.
    const isOwner = item.userId === viewerId
    const access = await preciseAccessItemIds(viewerId, [item.id])
    const readable =
      isOwner ||
      access.has(item.id) ||
      (READABLE_BY_OTHERS as readonly string[]).includes(item.status)

    // 404 rather than 403: a hidden listing should not confirm its own existence.
    if (!readable) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json(shapeItem(item, viewerId, access))
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
      select: { userId: true, category: true, condition: true, valueLeaves: true },
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

    // Pickup is only rewritten when the request actually says something about
    // it. `localPickup: false` clears it; omitting the field leaves it alone.
    const pickupTouched = body.localPickup !== undefined
    const hasPickup =
      body.localPickup === true && body.pickupLat != null && body.pickupLng != null

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
        ...(body.imageHash !== undefined && { imageHash: body.imageHash ?? null }),
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
      select: { ...ITEM_PUBLIC_SELECT, user: { select: ITEM_PUBLIC_USER_SELECT } },
    })

    return NextResponse.json(shapeItem(updated, session.user.id))
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
