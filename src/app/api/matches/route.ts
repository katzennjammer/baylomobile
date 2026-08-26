import { NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { userNotBlocked } from "@/lib/blocking"
import { notSuspendedWhere } from "@/lib/moderation"

export const dynamic = "force-dynamic"

const CATEGORY_LABEL: Record<string, string> = {
  ELECTRONICS: "Electronics", CLOTHING: "Fashion", FURNITURE: "Home & Garden",
  BOOKS: "Books & Media", SPORTS: "Sports", TOYS: "Kids & Toys",
  TOOLS: "Tools & DIY", FOOD: "Food", SERVICES: "Services", OTHER: "Other",
}

export async function GET() {
  const session = await resolveSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const [myItemCats, candidates] = await Promise.all([
    prisma.item.findMany({
      where: { userId, status: "AVAILABLE" },
      select: { category: true },
    }),
    prisma.user.findMany({
      where: {
        id: { not: userId },
        deletedAt: null,
        items: { some: { status: "AVAILABLE", moderationHiddenAt: null } },
        // Never suggest someone you blocked, or who blocked you, as a match.
        ...userNotBlocked(userId),
        ...notSuspendedWhere(),
      },
      select: {
        name: true,
        totalTrades: true,
        items: {
          where: { status: "AVAILABLE", moderationHiddenAt: null },
          select: { category: true },
          take: 5,
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
  ])

  const myCategories = new Set(myItemCats.map((i) => i.category))

  const matches = candidates.map((u) => {
    const cats = [...new Set(u.items.map((i) => i.category))]
    const overlapCat = cats.find((c) => myCategories.has(c))
    const topCat = cats[0] ? (CATEGORY_LABEL[cats[0]] ?? cats[0]) : "items"
    const green = Math.min(100, Math.round(20 + u.totalTrades * 8))
    return {
      name: u.name,
      reason: overlapCat
        ? `Both trading ${CATEGORY_LABEL[overlapCat] ?? overlapCat}`
        : `Has ${topCat} you might like`,
      mutual: overlapCat ? "Mutual category match" : `Active in ${topCat}`,
      green,
    }
  })

  return NextResponse.json(matches)
}
