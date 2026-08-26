import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import prisma from "@/lib/prisma"
import { issueTokenPair, toTokenUser } from "@/lib/auth-tokens"
import { clientIp, enforceRateLimit } from "@/lib/rate-limit-config"
import { suspensionState } from "@/lib/moderation"

/**
 * POST /api/auth/token — email + password, in exchange for a token pair.
 *
 * This is the native client's equivalent of the web Credentials provider, and
 * it checks the same bcrypt hash in the same User.password column. The web
 * login is unaffected and still goes through NextAuth.
 *
 * NOTE ON ROUTING: this file is a real static segment, so it takes precedence
 * over the `[...nextauth]` catch-all one level up. Were it not, every request
 * here would be swallowed by NextAuth and answered with 400 "Bad request." —
 * which looks exactly like a validation failure but means the route does not
 * exist. The distinguishing marker is the response body, not the status.
 */

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  const password = typeof body.password === "string" ? body.password : ""

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 })
  }

  // Keyed on IP *and* email: an IP budget alone lets one attacker spray many
  // accounts from one address, and an email budget alone lets a distributed
  // attacker lock a victim out of their own account.
  const limited = enforceRateLimit("login", `${clientIp(req)}:${email}`)
  if (limited) return limited

  const user = await prisma.user.findUnique({ where: { email } })

  // One message and one status for "no such user", "Google-only account with no
  // password", and "wrong password" alike. Distinguishing them would turn this
  // endpoint into an account-enumeration oracle.
  if (!user?.password || !(await bcrypt.compare(password, user.password))) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 })
  }

  // The credentials are right; the account still may not be usable.
  //
  // These two checks come AFTER the password comparison, and that ordering is
  // the whole reason they are not an enumeration oracle: a caller who reaches
  // this line has already proved they own the account, so telling them why they
  // cannot get in reveals nothing they did not already have. Answering
  // "suspended" before checking the password would let anyone enumerate which
  // accounts are suspended.
  //
  // Without this, resolveSession() would still refuse every subsequent request
  // — so a suspended user could log in "successfully" and then find every
  // screen 401-ing, with nothing anywhere telling them why. This is where the
  // reason gets said.
  if (user.deletedAt) {
    return NextResponse.json({ error: "That account has been deleted." }, { status: 403 })
  }
  const suspension = suspensionState(user)
  if (suspension.suspended) {
    return NextResponse.json(
      {
        error: suspension.indefinite
          ? "This account has been suspended. Contact support if you think that is a mistake."
          : `This account is suspended until ${suspension.until!.toLocaleDateString()}.`,
        code: "ACCOUNT_SUSPENDED",
        until: suspension.until,
      },
      { status: 403 },
    )
  }

  const pair = await issueTokenPair(user.id)
  return NextResponse.json({ ...pair, user: toTokenUser(user) })
}
