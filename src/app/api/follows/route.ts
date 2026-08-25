import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { followSchema, parseBody } from "@/lib/validation"

// GET /api/follows — incoming pending follow requests for current user
export async function GET() {
  const session = await resolveSession()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const requests = await prisma.follow.findMany({
    where: { followeeId: session.user.id, status: "PENDING" },
    include: { follower: { select: { id: true, name: true, avatar: true, location: true } } },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(requests)
}

// POST /api/follows — send a follow request
export async function POST(req: NextRequest) {
  const session = await resolveSession()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsed = await parseBody(req, followSchema)
  if (!parsed.ok) return parsed.response
  const { followeeId } = parsed.data
  if (followeeId === session.user.id) return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 })

  const existing = await prisma.follow.findUnique({
    where: { followerId_followeeId: { followerId: session.user.id, followeeId } },
  })
  if (existing) return NextResponse.json(existing)

  const [follow, follower] = await Promise.all([
    prisma.follow.create({
      data: { followerId: session.user.id, followeeId, status: "PENDING" },
    }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } }),
  ])

  await prisma.notification.create({
    data: {
      userId: followeeId,
      type: "FOLLOW_REQUEST",
      message: "requested to follow you",
      link: "/dashboard/friends",
      actorId: session.user.id,
    },
  })

  return NextResponse.json(follow, { status: 201 })
}
