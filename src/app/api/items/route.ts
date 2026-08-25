import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { awardTaskAsync } from "@/lib/tasks"
import { createItemSchema, parseBody, categorySchema } from "@/lib/validation"
import {
  ITEM_PUBLIC_SELECT,
  ITEM_PUBLIC_USER_SELECT,
  preciseAccessItemIds,
  shapeItem,
} from "@/lib/item-visibility"

export async function GET(req: NextRequest) {
  try {
    // Authentication is required for the whole route, not only the `mine`
    // branch. The session used to be resolved here and then consulted only
    // inside `if (mine)`, so every other request fell through unauthenticated —
    // and the response carried each item's pickup coordinates.
    const session = await resolveSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const viewerId = session.user.id

    const { searchParams } = new URL(req.url)
    const categoryParam = searchParams.get("category")
    const q = searchParams.get("q")
    const mine = searchParams.get("mine") === "true"

    // An unknown category is ignored rather than passed through as an enum.
    const categoryFilter =
      categoryParam && categoryParam !== "ALL"
        ? categorySchema.safeParse(categoryParam)
        : null
    if (categoryFilter && !categoryFilter.success) {
      return NextResponse.json({ error: "Unknown category" }, { status: 400 })
    }

    if (mine) {
      const items = await prisma.item.findMany({
        where: { userId: viewerId, status: "AVAILABLE" },
        select: ITEM_PUBLIC_SELECT,
        orderBy: { createdAt: "desc" },
      })
      // Own items: the owner always sees their own exact pickup point.
      return NextResponse.json(items.map((i) => shapeItem(i, viewerId)))
    }

    const items = await prisma.item.findMany({
      where: {
        status: "AVAILABLE",
        ...(categoryFilter?.success ? { category: categoryFilter.data } : {}),
        ...(q ? { OR: [{ title: { contains: q } }, { description: { contains: q } }] } : {}),
      },
      select: { ...ITEM_PUBLIC_SELECT, user: { select: ITEM_PUBLIC_USER_SELECT } },
      orderBy: { createdAt: "desc" },
    })

    // One query for the whole page rather than one per item.
    const access = await preciseAccessItemIds(viewerId, items.map((i) => i.id))

    return NextResponse.json(items.map((i) => shapeItem(i, viewerId, access)))
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const parsed = await parseBody(req, createItemSchema)
    if (!parsed.ok) return parsed.response
    const body = parsed.data

    const resolvedTitle = body.title ?? body.wantedItem!

    // Pickup goes to its own columns. It is no longer folded into wantedItems,
    // which is now the free text it was always named for.
    const hasPickup =
      body.localPickup === true && body.pickupLat != null && body.pickupLng != null

    const item = await prisma.item.create({
      data: {
        title: resolvedTitle,
        description: body.description || resolvedTitle,
        category: body.category,
        condition: body.condition,
        valueLeaves: body.valueLeaves ?? null,
        wantedItems: body.wantedItems ?? null,
        images: JSON.stringify(body.images ?? []),
        userId: session.user.id,
        ...(hasPickup
          ? {
              pickupLat: body.pickupLat!,
              pickupLng: body.pickupLng!,
              pickupAddress: body.pickupAddress ?? null,
            }
          : {}),
        ...(body.imageHash ? { imageHash: body.imageHash } : {}),
      },
      select: { ...ITEM_PUBLIC_SELECT, user: { select: ITEM_PUBLIC_USER_SELECT } },
    })

    // FIRST_LISTING is one-time — the @@unique([userId, task, refId]) constraint
    // on TaskCompletion makes every later listing a no-op. There is deliberately
    // NO per-listing reward: posting must never be a faucet.
    awardTaskAsync(session.user.id, "FIRST_LISTING", "", {
      description: "Task reward: listed your first item",
    })

    // The creator is the owner, so this response carries the exact point back.
    return NextResponse.json(shapeItem(item, session.user.id), { status: 201 })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
