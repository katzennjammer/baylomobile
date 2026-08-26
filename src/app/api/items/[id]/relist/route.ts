import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params

    const item = await prisma.item.findUnique({
      where: { id },
      select: { userId: true, status: true, moderationHiddenAt: true },
    })

    if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 })
    if (item.userId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    // THE REASON Item.moderationHiddenAt IS ITS OWN COLUMN. This route lets an
    // owner move their item back to AVAILABLE, so a takedown expressed as a
    // status would be a takedown the person it was aimed at could undo with one
    // request. The takedown is a separate flag and only an admin route clears it.
    if (item.moderationHiddenAt) {
      return NextResponse.json(
        {
          error: "This listing was removed by a moderator and cannot be re-listed.",
          code: "MODERATION_HIDDEN",
        },
        { status: 403 },
      )
    }
    if (item.status !== "OWNED") {
      return NextResponse.json({ error: "Only items in your inventory can be re-listed" }, { status: 400 })
    }

    await prisma.item.update({
      where: { id },
      data: { status: "AVAILABLE" },
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
