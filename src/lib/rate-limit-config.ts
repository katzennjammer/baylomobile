import { NextResponse } from "next/server"
import { rateLimit, clientIp } from "@/lib/rate-limit"

/**
 * Every rate limit in the application, in one table.
 *
 * They live together because the interesting failure is not a limit being
 * wrong, it is a limit being absent — /api/auth/token was rate limited while
 * the NextAuth credentials provider, checking the same bcrypt hash, was not.
 * A single table is something you can read top to bottom and notice a gap in.
 *
 * Scope inherited from @/lib/rate-limit: per process, in memory, and keyed in
 * part on client-controlled forwarding headers. That makes these a speed bump
 * on automated abuse, not an access control. Anything that must hold under a
 * determined attacker — ownership, participation, balance — is enforced in the
 * route, not here.
 */

const HOUR = 60 * 60 * 1000
const FIFTEEN_MIN = 15 * 60 * 1000

export interface RateRule {
  limit: number
  windowMs: number
}

export const RATE_LIMITS = {
  /** Email + password, native client. */
  login: { limit: 10, windowMs: FIFTEEN_MIN },
  /** The same credentials against the NextAuth provider. Same budget. */
  loginWeb: { limit: 10, windowMs: FIFTEEN_MIN },
  /** Free unlimited account creation is the precondition for every other abuse. */
  register: { limit: 3, windowMs: HOUR },
  /** Sends mail to an address the caller names. */
  forgotPassword: { limit: 3, windowMs: HOUR },
  /**
   * Re-sends the verification email. Authenticated, so the scope is the user
   * id rather than an IP: the budget being protected is our SMTP quota and the
   * recipient's patience, and both belong to the account, not the network path.
   */
  resendVerification: { limit: 3, windowMs: HOUR },
  /** One Anthropic vision call per request, billed to us. */
  aiIdentify: { limit: 20, windowMs: HOUR },
  /** TWO vision calls per request, plus a full-catalogue scan. */
  aiPhash: { limit: 20, windowMs: HOUR },
  /** Cloudinary bandwidth and storage, billed to us. */
  upload: { limit: 30, windowMs: HOUR },
  /** Guessing a partner's 6-digit swap code. Also capped per code in the DB. */
  confirmSubmit: { limit: 20, windowMs: HOUR },
  /**
   * Filing a report. Keyed on the reporter's user id, not their IP.
   *
   * AN UNLIMITED REPORT ENDPOINT IS A HARASSMENT TOOL. The abuse is not
   * hypothetical and not subtle: one account, a loop, and every listing a rival
   * owns is in the moderation queue by morning — which both drowns the real
   * reports and, on any platform where reports auto-hide content, is a takedown
   * button. The per-target constraint (one live report per reporter per target,
   * enforced by a unique index) stops the same target being hit twice; this
   * stops MANY targets being hit at once, and the two together are what make
   * the endpoint safe to expose.
   *
   * 20 an hour is far above what a real person reports and far below what a
   * script wants. On the user id rather than the IP because the budget being
   * protected is the moderators' attention, which is spent per reporter — and
   * because an IP-keyed limit punishes everyone behind one campus NAT for one
   * bad actor.
   */
  report: { limit: 20, windowMs: HOUR },
  /**
   * Blocking. Generous on purpose: blocking is a SAFETY action and a limit that
   * bites is a limit that leaves somebody unable to shut out a harasser who is
   * cycling through accounts. This is here to stop a script writing rows
   * forever, nothing more.
   */
  block: { limit: 60, windowMs: HOUR },
} as const satisfies Record<string, RateRule>

export type RateLimitName = keyof typeof RATE_LIMITS

/**
 * Applies a rule and returns a ready-to-return 429, or null to proceed.
 *
 * `scope` is whatever the limit is per: a user id, an IP, an email. Callers that
 * need to limit on two axes at once call this twice with different scopes — see
 * forgot-password, which is limited per email AND per IP so that neither a
 * single address flooding many mailboxes nor many addresses flooding one gets
 * through.
 */
export function enforceRateLimit(
  name: RateLimitName,
  scope: string,
): NextResponse | null {
  const rule = RATE_LIMITS[name]
  const result = rateLimit(`${name}:${scope}`, rule.limit, rule.windowMs)
  if (result.ok) return null

  return NextResponse.json(
    { error: "Too many requests. Try again later." },
    { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
  )
}

/** Re-exported so routes need only this module. */
export { clientIp }
