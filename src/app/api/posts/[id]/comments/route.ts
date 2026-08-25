import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { createCommentSchema, parseBody } from "@/lib/validation"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: postId } = await params
    const { searchParams } = new URL(req.url)
    const cursor = searchParams.get("cursor")
    const take = 20

    const comments = await prisma.postComment.findMany({
      where: { postId, parentId: null },
      include: {
        user: { select: { id: true, name: true, avatar: true } },
        likes: { select: { userId: true } },
        replies: {
          include: {
            user: { select: { id: true, name: true, avatar: true } },
            likes: { select: { userId: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const hasMore = comments.length > take
    const page = hasMore ? comments.slice(0, take) : comments
    const myId = session.user.id

    const shaped = page.map((c) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt.toISOString(),
      user: c.user,
      likeCount: c.likes.length,
      liked: c.likes.some((l) => l.userId === myId),
      replies: c.replies.map((r) => ({
        id: r.id,
        content: r.content,
        createdAt: r.createdAt.toISOString(),
        user: r.user,
        likeCount: r.likes.length,
        liked: r.likes.some((l) => l.userId === myId),
      })),
    }))

    return NextResponse.json({ comments: shaped, hasMore, nextCursor: hasMore ? page[page.length - 1].id : null })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await resolveSession()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: postId } = await params
    const parsed = await parseBody(req, createCommentSchema)
    if (!parsed.ok) return parsed.response
    const { content, parentId } = parsed.data

    const comment = await prisma.postComment.create({
      data: {
        postId,
        userId: session.user.id,
        content,
        parentId: parentId || null,
      },
      include: {
        user: { select: { id: true, name: true, avatar: true } },
        likes: { select: { userId: true } },
        replies: {
          include: {
            user: { select: { id: true, name: true, avatar: true } },
            likes: { select: { userId: true } },
          },
        },
      },
    })

    return NextResponse.json({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt.toISOString(),
      user: comment.user,
      likeCount: 0,
      liked: false,
      replies: comment.replies.map((r) => ({
        id: r.id,
        content: r.content,
        createdAt: r.createdAt.toISOString(),
        user: r.user,
        likeCount: 0,
        liked: false,
      })),
    }, { status: 201 })
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
