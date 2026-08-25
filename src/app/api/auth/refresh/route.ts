import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import {
  hashRefreshToken,
  issueTokenPair,
  revokeTokenFamily,
  toTokenUser,
} from "@/lib/auth-tokens"

/**
 * POST /api/auth/refresh — trades a refresh token for a fresh pair.
 *
 * Rotation is mandatory: the presented token is spent, and a new one takes its
 * place in the same family. That is what makes theft detectable. A stolen token
 * and the real one are identical strings, so the only signal available is that
 * a token got used twice — and with rotation, exactly one of the two holders
 * will trip that, whichever refreshes second.
 *
 * On that signal the whole family is revoked and both parties are logged out.
 * Logging out the victim is the correct outcome, not collateral damage: there
 * is no way to tell the thief from the victim, and leaving the family alive
 * would let the thief keep rotating indefinitely.
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
  })

  // Unknown token. Nothing to revoke — a hash we have never seen cannot tell us
  // which family, if any, it belonged to.
  if (!stored) return NextResponse.json({ error: "Invalid refresh token" }, { status: 401 })

  // Already revoked — typically the aftermath of an earlier replay, or a logout.
  if (stored.revokedAt) {
    return NextResponse.json({ error: "Invalid refresh token" }, { status: 401 })
  }

  // ── Replay ────────────────────────────────────────────────────────────────
  // A token that already has usedAt set is being presented a second time.
  if (stored.usedAt) {
    await revokeTokenFamily(stored.familyId)
    return NextResponse.json({ error: "Invalid refresh token" }, { status: 401 })
  }

  if (stored.expiresAt <= new Date()) {
    return NextResponse.json({ error: "Refresh token expired" }, { status: 401 })
  }

  // Spend it. Conditional on usedAt still being null, so two requests racing
  // with the same token cannot both succeed: the loser gets count === 0 and is
  // treated as the replay it is indistinguishable from.
  const spent = await prisma.refreshToken.updateMany({
    where: { id: stored.id, usedAt: null, revokedAt: null },
    data: { usedAt: new Date() },
  })
  if (spent.count !== 1) {
    await revokeTokenFamily(stored.familyId)
    return NextResponse.json({ error: "Invalid refresh token" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({ where: { id: stored.userId } })
  if (!user) return NextResponse.json({ error: "Invalid refresh token" }, { status: 401 })

  // Same family — the new token inherits the lineage, so a replay of any
  // ancestor still revokes everything descended from that one login.
  const pair = await issueTokenPair(user.id, stored.familyId)
  return NextResponse.json({ ...pair, user: toTokenUser(user) })
}
