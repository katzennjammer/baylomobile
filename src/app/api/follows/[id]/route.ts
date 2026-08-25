import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { followActionSchema, parseBody } from "@/lib/validation"

// PATCH /api/follows/[id] — accept or decline a follow request
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await resolveSession()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const parsed = await parseBody(req, followActionSchema)
  if (!parsed.ok) return parsed.response
  const { action } = parsed.data

  const follow = await prisma.follow.findUnique({ where: { id } })
  if (!follow) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (follow.followeeId !== session.user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (follow.status !== "PENDING") return NextResponse.json({ error: "Already resolved" }, { status: 409 })

  if (action === "decline") {
    await prisma.follow.delete({ where: { id } })
    return NextResponse.json({ status: "declined" })
  }

  const [updated, followee] = await Promise.all([
    prisma.follow.update({ where: { id }, data: { status: "ACCEPTED" } }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } }),
  ])

  await prisma.notification.create({
    data: {
      userId: follow.followerId,
      type: "FOLLOW_ACCEPTED",
      message: "accepted your follow request",
      link: "/dashboard/friends",
      actorId: session.user.id,
    },
  })

  return NextResponse.json(updated)
}
