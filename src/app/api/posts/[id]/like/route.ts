import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: postId } = await params
    const userId = session.user.id

    const existing = await prisma.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
    })

    if (existing) {
      await prisma.postLike.delete({ where: { postId_userId: { postId, userId } } })
    } else {
      await prisma.postLike.create({ data: { postId, userId } })
    }

    const count = await prisma.postLike.count({ where: { postId } })
    return NextResponse.json({ liked: !existing, count })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
