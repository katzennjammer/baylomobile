import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { commentId } = await params
    const userId = session.user.id

    const existing = await prisma.commentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
    })

    if (existing) {
      await prisma.commentLike.delete({ where: { commentId_userId: { commentId, userId } } })
    } else {
      await prisma.commentLike.create({ data: { commentId, userId } })
    }

    const count = await prisma.commentLike.count({ where: { commentId } })
    return NextResponse.json({ liked: !existing, count })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
