import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import prisma from "@/lib/prisma"
import { clientIp, enforceRateLimit } from "@/lib/rate-limit-config"
import { clearsAgeGate, parseBody, registerSchema, underAgeResponse } from "@/lib/validation"
import { parseDateOfBirth, toStoredDate } from "@/lib/age"
import { issueVerificationToken } from "@/lib/email-verification"

export async function POST(req: NextRequest) {
  try {
    // Unlimited free account creation is the precondition for every other abuse
    // in this API — the AI spend, the upload spend, the messaging spam. Limited
    // per IP before any work is done.
    const limited = enforceRateLimit("register", clientIp(req))
    if (limited) return limited

    // registerSchema normalises the email to lowercase, the same way
    // /api/auth/token and the Google exchange do. Storing it verbatim meant an
    // account created as `Bob@x.com` could never be found by either of them.
    // It also enforces the 8-character minimum against a value that is
    // guaranteed to be a string: `password.length` on a JSON number threw here
    // and became a 500.
    const parsed = await parseBody(req, registerSchema)
    if (!parsed.ok) return parsed.response
    const { name, email, password, dateOfBirth } = parsed.data

    // THE AGE GATE, SERVER-SIDE, BEFORE THE ACCOUNT EXISTS.
    //
    // The native and web clients both check this first so the refusal is
    // instant and explicable, and neither check counts: a client-side gate is
    // one that anybody skips by POSTing here directly, which is the only way it
    // would ever actually be attacked. Refusing before `user.create` is what
    // makes it true that no under-age account is ever written — a check after
    // the insert would leave a row behind on every attempt.
    //
    // Answered with UNDER_18 rather than as a field validation issue. It is not
    // a malformed request; it is a well-formed one whose answer is no, and the
    // clients render a whole screen for it.
    if (!clearsAgeGate(dateOfBirth)) return underAgeResponse()

    // Non-null: registerSchema already refused anything parseDateOfBirth
    // rejects, and clearsAgeGate re-parsed it a second time above.
    const dob = parseDateOfBirth(dateOfBirth)!

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 })
    }

    const hashed = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: { name, email, password: hashed, dateOfBirth: toStoredDate(dob) },
    })

    // Send the verification email, and do NOT let it decide whether the account
    // exists. Login is not gated on verification, so an SMTP outage here costs
    // the user a signup grant they can still claim later via
    // /api/auth/resend-verification — whereas failing the registration would
    // cost them the account and leave a row behind that blocks retrying the
    // same address with a 409. issueVerificationToken() already swallows send
    // failures and reports them; the await is what makes `emailSent` truthful.
    const emailSent = await issueVerificationToken(user)

    return NextResponse.json(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        // Additive fields. The native client uses them to decide whether to
        // show "check your inbox" or offer a resend straight away.
        isVerified: user.isVerified,
        verificationEmailSent: emailSent,
      },
      { status: 201 },
    )
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
