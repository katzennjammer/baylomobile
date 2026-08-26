import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { auth } from "@root/auth"
import prisma from "@/lib/prisma"
import { verifyAccessToken } from "@/lib/auth-tokens"
import { suspensionState } from "@/lib/moderation"

/**
 * The single authentication entry point for every authenticated API route.
 *
 * Two clients, two credentials, one resolver:
 *   - the native client sends `Authorization: Bearer <accessToken>`;
 *   - the web admin side sends its existing NextAuth session cookie.
 * Both come back as the same shape, so a route never knows or cares which one
 * it got. NextAuth is not being replaced — the cookie path below IS the web
 * app's login, unchanged.
 *
 * TWO ACCOUNT STATES ARE REFUSED HERE, both by returning null:
 *   deleted    (deletedAt)   -- the account is gone; see the note on the column.
 *   suspended  (suspendedAt) -- a moderator has stopped this account acting.
 *
 * Suspension is checked in this one place, and that is what makes it real. The
 * alternative -- a gate each write route opts into -- is a gate the next route
 * somebody adds will not have, and the whole point of a suspension is that it
 * covers everything at once. Cost of putting it here: a suspended user's client
 * sees 401s, which reads as "signed out" rather than "suspended". The auth
 * endpoints say the actual reason (see /api/auth/token), so the user finds out
 * the moment they try to sign in again rather than being left guessing.
 *
 * Precedence rule, and it is a security decision rather than a stylistic one:
 * a Bearer header that is PRESENT but invalid returns null. It does NOT fall
 * through to the cookie. Falling through would mean a native client whose
 * access token had expired silently kept working off a stale cookie, and an
 * expired token would be indistinguishable from a live one — the 15-minute
 * expiry would stop meaning anything. Absence of the header is what selects the
 * cookie path; a failed Bearer is a failed request.
 */

export interface AuthUser {
  id: string
  name: string | null
  email: string | null
  /** The user's avatar. Named `image` to match NextAuth's session shape. */
  image: string | null
}

export interface AuthSession {
  user: AuthUser
}

/** Extracts the token from `Authorization: Bearer <token>`, if present. */
async function bearerToken(): Promise<string | null> {
  const header = (await headers()).get("authorization")
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

/**
 * Resolves the caller to a user, or null if unauthenticated.
 *
 * Drop-in for `await auth()`: the returned object exposes `user.id`,
 * `user.name`, `user.email` and `user.image` exactly as a NextAuth session
 * does, so existing `session?.user?.id` guards keep working verbatim.
 */
export async function resolveSession(): Promise<AuthSession | null> {
  const token = await bearerToken()

  if (token !== null) {
    // Bearer path. Presented-and-invalid stops here — see the note above.
    const userId = await verifyAccessToken(token)
    if (!userId) return null

    // The token proves who signed in; it does not prove the account still
    // exists. A deleted user must not stay authenticated for the remaining
    // life of an already-issued token.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, email: true, avatar: true,
        deletedAt: true, suspendedAt: true, suspendedUntil: true,
      },
    })
    // A deleted account is not merely absent from listings — it must stop
    // authenticating immediately. Without this check, an access token minted
    // before deletion keeps working for the rest of its 15 minutes.
    if (!user || user.deletedAt) return null
    // Same rule for a suspension, and the same 15-minute window is the reason:
    // a moderator who suspends an account at 10:00 must not have to wait until
    // 10:15 for it to take effect. suspensionState() rather than a raw column
    // test, so a suspension that has lapsed lets the user straight back in.
    if (suspensionState(user).suspended) return null

    return { user: { id: user.id, name: user.name, email: user.email, image: user.avatar } }
  }

  // Cookie path — the web admin side.
  const session = await auth()
  if (!session?.user?.id) return null

  // Same rule for the cookie session: a 30-day JWT outlives a deletion by a
  // long way, and the token itself carries no deletion state.
  const cookieUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { deletedAt: true, suspendedAt: true, suspendedUntil: true },
  })
  if (!cookieUser || cookieUser.deletedAt) return null
  // A 30-day NextAuth cookie outlives a suspension decision by a very long way,
  // and the JWT carries no suspension state. Checked here for the same reason
  // deletion is.
  if (suspensionState(cookieUser).suspended) return null

  return {
    user: {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email ?? null,
      image: session.user.image ?? null,
    },
  }
}

// ── Privilege ────────────────────────────────────────────────────────────────

export type Role = "USER" | "MODERATOR" | "ADMIN"

/**
 * Rank, for comparison. Higher wins; a route asks for a MINIMUM.
 *
 * A numeric ladder rather than a set membership test, so requireRole("MODERATOR")
 * admits an ADMIN without every call site having to remember to list both. The
 * failure mode of the set version is an admin locked out of a moderator route,
 * discovered by an admin at 2am.
 */
const ROLE_RANK: Record<Role, number> = { USER: 0, MODERATOR: 1, ADMIN: 2 }

export interface AdminActor {
  id: string
  name: string | null
  email: string | null
  role: Role
}

/**
 * The gate on every /api/admin route. Lives here, beside resolveSession(),
 * because it is the same kind of thing: who is this caller and may they act.
 *
 * Same shape as enforceInitiateTrade() in @/lib/reputation-gate -- a `response`
 * that is either a ready-to-return NextResponse or null, and on the null branch
 * the thing the handler needs next. Here that is the actor, because every admin
 * action writes an audit row naming who did it:
 *
 *   const gate = await requireRole("MODERATOR")
 *   if (gate.response) return gate.response
 *   // gate.actor.id
 *
 * WHY 403 AND NOT 404. Everywhere else in this codebase "you may not see this"
 * answers 404, deliberately, because a 403 confirms the row exists -- see the
 * note on notFound() in @/lib/v1/envelope. The /api/admin tree is the one place
 * that rule is inverted, and for a reason: there is no row here whose existence
 * is a secret. /api/admin/reports is a fixed URL that anyone can read out of the
 * app bundle, so hiding it protects nothing, while a 403 tells an honest
 * signed-in user the truth ("this is staff-only") instead of a lie.
 *
 * THE ROLE IS RE-READ FROM THE DATABASE ON EVERY CALL, never taken from the
 * session token. A NextAuth JWT here lives 30 days; a role revoked on Tuesday
 * must stop working on Tuesday, not whenever the token happens to expire.
 *
 * There is deliberately no counterpart that WRITES `role`. See the note on the
 * column: promotion is a manual SQL statement, because an endpoint that grants
 * ADMIN is a privilege-escalation target and there is no reason for one to exist.
 */
export async function requireRole(
  minimum: Role = "MODERATOR",
): Promise<{ response: NextResponse } | { response: null; actor: AdminActor }> {
  const session = await resolveSession()
  if (!session?.user?.id) {
    return {
      response: NextResponse.json(
        { error: "Sign in to continue", code: "UNAUTHENTICATED" },
        { status: 401 },
      ),
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true, deletedAt: true },
  })

  // resolveSession() already refuses deleted and suspended accounts; the
  // deletedAt re-check costs nothing on a path that runs a few times a day and
  // closes the gap if that rule ever moves.
  if (!user || user.deletedAt || ROLE_RANK[user.role as Role] < ROLE_RANK[minimum]) {
    return {
      response: NextResponse.json(
        { error: "Staff access required", code: "FORBIDDEN" },
        { status: 403 },
      ),
    }
  }

  return {
    response: null,
    actor: { id: user.id, name: user.name, email: user.email, role: user.role as Role },
  }
}
