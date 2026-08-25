import crypto from "crypto"
import prisma from "@/lib/prisma"
import { sendVerificationEmail } from "@/lib/mailer"
import { markVerified, type VerificationResult } from "@/lib/verification"

/**
 * Email verification for credentials signup.
 *
 * Until this existed, `markVerified()` had exactly two callers, both Google, so
 * an account created with an email and a password could never become verified —
 * and the 50-Leaf signup grant, which is gated on verification, was unreachable
 * for it. This module is the third caller, and it deliberately adds nothing to
 * what verification *means*: it proves control of the mailbox and then hands off
 * to the same function Google sign-in uses. The award, the grant, the ledger
 * rows and the idempotency all come from there, unchanged.
 *
 * The token follows the RefreshToken rules rather than PasswordResetToken's:
 *   - 32 CSPRNG bytes, hex-encoded;
 *   - stored only as a SHA-256 digest, so the table holds nothing usable;
 *   - 24-hour expiry, checked on redemption;
 *   - single use, enforced by a conditional DELETE (see consumeVerificationToken);
 *   - one live token per user — issuing purges the previous one.
 */

/** 24 hours. Long enough for a mailbox checked once a day; short enough to matter. */
export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Digest used for storage and lookup.
 *
 * SHA-256 and not bcrypt on purpose: the input is 256 bits of CSPRNG output,
 * not a human-chosen secret, so there is nothing for a work factor to defend
 * against — and a fast digest is what lets the lookup be a unique-index hit
 * rather than a scan-and-compare over every pending row.
 */
function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

/**
 * Issues a fresh verification token and emails the link.
 *
 * Returns false if the mail could not be sent. Callers on the registration path
 * treat that as non-fatal — see the note in the register route: an SMTP outage
 * must not cost the user their account, and /api/auth/resend-verification
 * exists precisely so this is recoverable.
 *
 * Already-verified accounts are a no-op that reports success. There is nothing
 * to prove and no reason to hand out a live token for an account that is
 * already past the gate.
 */
export async function issueVerificationToken(user: {
  id: string
  email: string
  name?: string | null
  isVerified?: boolean
}): Promise<boolean> {
  if (user.isVerified) return true

  const raw = crypto.randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS)

  // Purge first. Without this a resend leaves every previously mailed link
  // live, so "I lost the email, send another" quietly widens the window instead
  // of moving it.
  await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } })
  await prisma.emailVerificationToken.create({
    data: { userId: user.id, tokenHash: hashToken(raw), expiresAt },
  })

  // The raw token exists only here and in the email. Nothing writes it to a log.
  const verifyUrl = `${process.env.NEXTAUTH_URL ?? ""}/api/auth/verify-email?token=${raw}`

  try {
    await sendVerificationEmail(user.email, verifyUrl, user.name)
    return true
  } catch (err) {
    console.error(
      "verification email send failed:",
      err instanceof Error ? err.message : "unknown error",
    )
    return false
  }
}

export type ConsumeResult =
  | { ok: false; reason: "invalid" | "expired" }
  | { ok: true; userId: string; verification: VerificationResult }

/**
 * Redeems a raw verification token.
 *
 * Single use is enforced by the DELETE, not by a read-then-write: the row is
 * removed conditionally and only the caller whose delete reported count === 1
 * goes on to verify. Two requests racing the same link therefore cannot both
 * reach markVerified() — and even if they did, markVerified() credits nothing
 * the second time, so this is belt as well as braces.
 *
 * An expired token is deleted too. It is spent either way; leaving it would
 * only accumulate dead rows.
 */
export async function consumeVerificationToken(raw: string): Promise<ConsumeResult> {
  const tokenHash = hashToken(raw)

  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    select: { userId: true, expiresAt: true },
  })
  if (!record) return { ok: false, reason: "invalid" }

  if (record.expiresAt < new Date()) {
    await prisma.emailVerificationToken.deleteMany({ where: { tokenHash } })
    return { ok: false, reason: "expired" }
  }

  const claimed = await prisma.emailVerificationToken.deleteMany({ where: { tokenHash } })
  if (claimed.count !== 1) return { ok: false, reason: "invalid" }

  // Same entry point as both Google paths. Idempotent: verifying an account
  // that is already verified flips nothing and credits nothing.
  const verification = await markVerified(record.userId)

  return { ok: true, userId: record.userId, verification }
}
