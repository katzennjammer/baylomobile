import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { hashRefreshToken, revokeTokenFamily } from "@/lib/auth-tokens"

/**
 * POST /api/auth/revoke — logout.
 *
 * Revokes the presented token's entire family, not just that one token. A
 * family is one login on one device, and its later tokens are rotations of the
 * same session; revoking only the token in hand would leave any un-rotated
 * sibling alive and the "logout" would not have logged anything out.
 *
 * Always answers 200, including for a token that does not exist or is already
 * revoked. Logout is idempotent, and reporting which tokens are real would make
 * this endpoint a free validity oracle for anyone holding a stolen string.
 */
export async function POST(req: NextRequest) {
  let body: { refreshToken?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const raw = typeof body.refreshToken === "string" ? body.refreshToken.trim() : ""
  if (!raw) return NextResponse.json({ error: "refreshToken is required" }, { status: 400 })

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(raw) },
    select: { familyId: true },
  })

  const revoked = stored ? await revokeTokenFamily(stored.familyId) : 0
  return NextResponse.json({ ok: true, revoked })
}
