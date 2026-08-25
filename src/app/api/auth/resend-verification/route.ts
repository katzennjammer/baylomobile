import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { resolveSession } from "@/lib/api-auth"
import { enforceRateLimit } from "@/lib/rate-limit-config"
import { issueVerificationToken } from "@/lib/email-verification"

/**
 * Re-sends the verification email for the signed-in account.
 *
 * Authenticated on purpose, and it costs nothing to be: registration does not
 * block login, so a user who never received the first email is signed in and
 * can simply ask again. Taking an email address in the body instead would make
 * this an open relay for mailing arbitrary addresses and an account-existence
 * oracle on top; requiring a session removes both without asking anything extra
 * of the client.
 *
 * A real static segment, not the NextAuth catch-all — see the note in
 * ../verify-email/route.ts.
 */
export async function POST() {
  const session = await resolveSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Scoped to the user, which is what the spec asks for and also the right
  // axis: this endpoint spends our SMTP quota on one fixed mailbox — the one on
  // the account — so the account is the thing to budget. Registration is
  // already limited per IP, which is what bounds the mass-account variant.
  const limited = enforceRateLimit("resendVerification", session.user.id)
  if (limited) return limited

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, isVerified: true },
  })
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (user.isVerified) {
    // Not an error. The client asked for something that has already happened,
    // and there is no reason to mint a live token for an account past the gate.
    return NextResponse.json({ ok: true, alreadyVerified: true, sent: false })
  }

  const sent = await issueVerificationToken(user)

  // A send failure is reported honestly rather than swallowed — unlike the
  // registration path, the caller here is a user who explicitly asked for the
  // mail and needs to know it did not go.
  if (!sent) {
    return NextResponse.json(
      { error: "Could not send the verification email", code: "MAIL_FAILED" },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, alreadyVerified: false, sent: true })
}
