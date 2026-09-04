import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { resolveSession } from "@/lib/api-auth"
import { parseDateOfBirth, toStoredDate } from "@/lib/age"
import {
  clearsAgeGate,
  dateOfBirthBodySchema,
  parseBody,
  underAgeResponse,
} from "@/lib/validation"

/**
 * POST /api/auth/date-of-birth — the second step of Google sign-in.
 *
 * The Google exchange hands this backend an email, a name and a picture. It
 * cannot hand it an age, and Baylo is 18+, so an account created that way owes
 * exactly one more fact before it is usable. The native client holds the token
 * pair WITHOUT installing it, asks, and posts here; only then does it adopt the
 * session. `/api/auth/google/token` reports `needsDateOfBirth` so the client
 * knows whether there is anything to ask.
 *
 * ── A REAL STATIC SEGMENT, NOT THE NEXTAUTH CATCH-ALL ───────────────────────
 *
 * `src/app/api/auth/[...nextauth]/route.ts` matches every /api/auth/* path and
 * answers 400 for any action it does not recognise. Next gives a static segment
 * precedence over a catch-all at the same level, which is what makes this file
 * — and register, token, refresh, revoke and verify-email before it — resolve
 * here instead of looking like a working endpoint returning a confusing error.
 *
 * ── WRITE-ONCE, AND THAT IS THE SECURITY PROPERTY ───────────────────────────
 *
 * An account that already has a date of birth is refused. Without that, this is
 * an endpoint any authenticated user can call to rewrite their own age — which
 * would make the 18+ gate a formality that anybody who passed it once could
 * edit afterwards, and would let a suspended-for-age account launder itself. A
 * correction is a support action against the database, not an API call.
 *
 * The rule is enforced with a CONDITIONAL UPDATE rather than a read followed by
 * a write. Two concurrent requests both pass a `findUnique` check and both
 * write; `updateMany` with `dateOfBirth: null` in the where clause makes the
 * second one match zero rows, because the database is the only thing here that
 * can hold the two apart.
 */
export async function POST(req: NextRequest) {
  const session = await resolveSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const parsed = await parseBody(req, dateOfBirthBodySchema)
  if (!parsed.ok) return parsed.response
  const { dateOfBirth } = parsed.data

  // Same gate, same code, same status as registration. The client branches on
  // `code`, and a second spelling of this answer would be a second screen.
  if (!clearsAgeGate(dateOfBirth)) return underAgeResponse()

  // Non-null: the schema already refused anything parseDateOfBirth rejects.
  const dob = parseDateOfBirth(dateOfBirth)!

  const written = await prisma.user.updateMany({
    where: { id: session.user.id, dateOfBirth: null },
    data: { dateOfBirth: toStoredDate(dob) },
  })

  if (written.count === 0) {
    // Either the row already had a date of birth, or it went away between
    // resolveSession() and here. Both are 409: the caller's request was fine
    // and the state it assumed is not the state that exists.
    return NextResponse.json(
      {
        error: "This account already has a date of birth on file",
        code: "DATE_OF_BIRTH_SET",
      },
      { status: 409 },
    )
  }

  return NextResponse.json({ ok: true })
}
