import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { awardTaskAsync } from "@/lib/tasks"
import { createItemSchema, parseBody, categorySchema } from "@/lib/validation"
import { decideItemValue } from "@/lib/valuation-server"
import { visibleItemWhere } from "@/lib/blocking"
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

    // The web's browse AND search path. visibleItemWhere() goes in beside the
    // status filter rather than after the fetch, so a blocked owner's listing is
    // excluded by the SQL on both — searching for it by title finds nothing,
    // which is the whole point.
    //
    // The `mine` branch above deliberately does NOT get this: those are the
    // caller's own items, nobody can block themselves, and a moderator takedown
    // must stay visible to its owner or the listing silently vanishes with no
    // explanation.
    const items = await prisma.item.findMany({
      where: {
        status: "AVAILABLE",
        ...visibleItemWhere(viewerId),
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

    // ── Valuation ───────────────────────────────────────────────────────────
    // The value is not simply whatever the client sent. The server recomputes
    // the suggestion for this (category, condition) from the same deterministic
    // model the listing wizard was shown, and the submitted number has to fall
    // inside OVERRIDE_BAND_PCT of it. The client is not trusted to report the
    // suggestion it was given — it does not need to be, because the model
    // returns the same number to anyone who asks with the same two labels.
    //
    // A listing with no value takes the suggestion, so `suggestedLeaves` and
    // `valueLeaves` are both populated on every listing created from here and
    // the divergence between them is measurable.
    const valued = await decideItemValue(body.category, body.condition, body.valueLeaves)
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
        ...valued.data,
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
