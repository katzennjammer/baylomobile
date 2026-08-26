import { NextRequest } from "next/server"
import { z } from "zod"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import { ok, unauthenticated, notFound } from "@/lib/v1/envelope"
import { parseQuery } from "@/lib/v1/query"

export const dynamic = "force-dynamic"

/**
 * DELETE /api/v1/blocks/[id] — unblock. `[id]` is the BLOCKED USER's id.
 *
 * Only the blocker can undo their own block; there is no route by which the
 * blocked party can remove one, and there never should be.
 *
 * 404 rather than 204 when no such block exists, because the two cases mean
 * different things to a client: "you were never blocking them" is worth showing
 * as a stale-UI refresh, whereas a silent success teaches the client its list
 * is right when it is not.
 */

const querySchema = z.strictObject({})

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await resolveSession()
  if (!session?.user?.id) return unauthenticated()
  const blockerId = session.user.id
  const { id: blockedId } = await params

  const parsed = parseQuery(req, querySchema)
  if (!parsed.ok) return parsed.response

  // deleteMany, not delete: `delete` throws P2025 when the row is absent, which
  // would surface as a 500 for the ordinary case of a double tap on unblock.
  const result = await prisma.block.deleteMany({
    where: { blockerId, blockedId },
  })

  if (result.count === 0) return notFound("You are not blocking that person")

  return ok({ unblocked: blockedId })
}
