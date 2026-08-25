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
      select: { userId: true, status: true },
    })

    if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 })
    if (item.userId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
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
