import { NextResponse } from "next/server";
import { resolveSession } from "@/lib/api-auth";
import prisma from "@/lib/prisma";
import { availableLeaves } from "@/lib/leaves";

export async function GET() {
  const session = await resolveSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const [user, transactions, available] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { leaves: true },
    }),
    prisma.leafTransaction.findMany({
      where: { userId },
      // eventAt, not createdAt: this list shows the user when things HAPPENED,
      // and createdAt is when the row was written. For the backfilled rows those
      // differ by over two months, so ordering on write time shuffles a user's
      // history into the order the backfill happened to process it in.
      orderBy: { eventAt: "desc" },
      take: 50,
    }),
    availableLeaves(prisma, userId),
  ]);

  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json({ total: user.leaves, available, transactions });
}
