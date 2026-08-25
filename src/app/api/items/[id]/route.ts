import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { parseBody, updateItemSchema } from "@/lib/validation"
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
    const item = await prisma.item.findUnique({ where: { id }, select: { userId: true } })
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (item.userId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const parsed = await parseBody(req, updateItemSchema)
    if (!parsed.ok) return parsed.response
    const body = parsed.data

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
        ...(body.valueLeaves !== undefined && { valueLeaves: body.valueLeaves ?? null }),
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
