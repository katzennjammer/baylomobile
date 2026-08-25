import { createHash, randomBytes, randomUUID } from "crypto"
import { SignJWT, jwtVerify } from "jose"
import prisma from "@/lib/prisma"

/**
 * Token auth for the native (React Native) client.
 *
 * The web admin side is untouched: it keeps its NextAuth cookie session and
 * never issues or presents one of these. Both paths meet at resolveSession()
 * in `@/lib/api-auth`, which is what every authenticated route calls.
 *
 * Two different kinds of token, deliberately built differently:
 *
 *   ACCESS  — a short-lived (15 min) HS256 JWT. Stateless: no database row, no
 *             revocation list. That is the trade being made — a stolen access
 *             token stays valid until it expires, which is why it expires fast
 *             and why the payload carries a user id and nothing else.
 *
 *   REFRESH — a 30-day opaque random string. NOT a JWT: there is nothing to
 *             read in it, and it is worthless to anyone who reads the database,
 *             because only its SHA-256 is stored. It is single-use and rotates
 *             on every refresh, so a stolen one can be detected the moment
 *             either party tries to use a token the other already spent.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
export const REFRESH_TOKEN_TTL_DAYS = 30

const REFRESH_TOKEN_TTL_MS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000

// Bound to this app so a token minted here cannot be replayed against another
// service that happens to share the secret. These are registered JWT claims,
// not payload: the payload itself still carries only `userId`.
const ISSUER = "baylo"
const AUDIENCE = "baylo-native"

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET is not set")
  return new TextEncoder().encode(secret)
}

// ── Access tokens ────────────────────────────────────────────────────────────

/** Signs a 15-minute access token. The payload carries the user id only. */
export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secretKey())
}

/**
 * Returns the user id carried by a valid access token, or null.
 *
 * Null for every failure mode there is — bad signature, expired, wrong issuer
 * or audience, malformed — and the caller must not distinguish between them.
 * jose enforces `exp` itself, so an expired token lands here as null.
 */
export async function verifyAccessToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    })
    const userId = payload.userId
    return typeof userId === "string" && userId.length > 0 ? userId : null
  } catch {
    return null
  }
}

// ── Refresh tokens ───────────────────────────────────────────────────────────

/** 256 bits of CSPRNG output, base64url. Opaque — it encodes nothing. */
function newRefreshToken(): string {
  return randomBytes(32).toString("base64url")
}

/**
 * The only form of a refresh token that ever touches the database.
 *
 * Plain SHA-256 rather than bcrypt on purpose: this is a 256-bit random value,
 * not a human-chosen password, so there is no dictionary to attack and no work
 * factor worth paying. It also has to be a deterministic hash, because lookup
 * is by exact hash — a salted scheme would force a table scan.
 */
export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

/**
 * Mints an access/refresh pair and persists the refresh token's hash.
 *
 * `familyId` omitted starts a NEW family — a fresh login. A rotation passes the
 * existing family through, which is what lets a later replay revoke every token
 * descended from that one login.
 */
export async function issueTokenPair(userId: string, familyId?: string): Promise<TokenPair> {
  const raw = newRefreshToken()
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(raw),
      familyId: familyId ?? randomUUID(),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  })
  return { accessToken: await signAccessToken(userId), refreshToken: raw }
}

/**
 * Revokes every unrevoked token in a family.
 *
 * Called on a detected replay, and on logout. On a replay this logs out the
 * legitimate user too — that is the point, not a side effect: once a token has
 * demonstrably leaked, there is no way to tell which of the two holders is the
 * real one, so the only safe move is to end the whole lineage and make both
 * re-authenticate.
 */
export async function revokeTokenFamily(familyId: string): Promise<number> {
  const res = await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return res.count
}

/** The user shape every token endpoint returns, matching resolveSession(). */
export interface TokenUser {
  id: string
  name: string
  email: string
  image: string | null
}

export function toTokenUser(u: {
  id: string
  name: string
  email: string
  avatar: string | null
}): TokenUser {
  return { id: u.id, name: u.name, email: u.email, image: u.avatar }
}
