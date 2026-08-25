import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import prisma from "@/lib/prisma"
import { sendPasswordResetEmail } from "@/lib/mailer"
import { clientIp, enforceRateLimit } from "@/lib/rate-limit-config"
import { forgotPasswordSchema, parseBody } from "@/lib/validation"

export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, forgotPasswordSchema)
  if (!parsed.ok) return parsed.response
  const { email } = parsed.data

  // Limited on BOTH axes. Per-email alone lets one caller flood many different
  // mailboxes from one machine; per-IP alone lets a distributed caller flood a
  // single victim. Each sends mail on our SMTP quota, so both are capped.
  const byEmail = enforceRateLimit("forgotPassword", `email:${email}`)
  if (byEmail) return byEmail
  const byIp = enforceRateLimit("forgotPassword", `ip:${clientIp(req)}`)
  if (byIp) return byIp

  try {
    const user = await prisma.user.findUnique({ where: { email } })

    if (user) {
      // Delete any existing token for this email
      await prisma.passwordResetToken.deleteMany({ where: { email } })

      const token = crypto.randomBytes(32).toString("hex")
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000) // 30 min

      await prisma.passwordResetToken.create({ data: { email, token, expiresAt } })

      const resetUrl = `${process.env.NEXTAUTH_URL}/auth/reset-password?token=${token}`
      await sendPasswordResetEmail(email, resetUrl, user.name)
    }

    // Always return 200 — don't reveal whether account exists
    return NextResponse.json({ ok: true })
  } catch (err) {
    // The exception stays server-side. Returning err.message handed the caller
    // SMTP host details and internal failure text.
    console.error("forgot-password error:", err instanceof Error ? err.message : "unknown error")
    return NextResponse.json({ error: "Could not send the reset email" }, { status: 500 })
  }
}
