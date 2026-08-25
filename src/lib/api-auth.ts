import { headers } from "next/headers"
import { auth } from "@root/auth"
import prisma from "@/lib/prisma"
import { verifyAccessToken } from "@/lib/auth-tokens"

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
      select: { id: true, name: true, email: true, avatar: true, deletedAt: true },
    })
    // A deleted account is not merely absent from listings — it must stop
    // authenticating immediately. Without this check, an access token minted
    // before deletion keeps working for the rest of its 15 minutes.
    if (!user || user.deletedAt) return null

    return { user: { id: user.id, name: user.name, email: user.email, image: user.avatar } }
  }

  // Cookie path — the web admin side.
  const session = await auth()
  if (!session?.user?.id) return null

  // Same rule for the cookie session: a 30-day JWT outlives a deletion by a
  // long way, and the token itself carries no deletion state.
  const cookieUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { deletedAt: true },
  })
  if (!cookieUser || cookieUser.deletedAt) return null

  return {
    user: {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email ?? null,
      image: session.user.image ?? null,
    },
  }
}
