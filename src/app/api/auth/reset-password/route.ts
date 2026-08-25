import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import prisma from "@/lib/prisma"
import { parseBody, resetPasswordSchema } from "@/lib/validation"

export async function POST(req: NextRequest) {
  // resetPasswordSchema applies the same 8-character minimum as registration.
  // This route previously checked only that a password was present, so the one
  // flow that exists specifically to replace a compromised password was also
  // the one flow that would accept a single character.
  const parsed = await parseBody(req, resetPasswordSchema)
  if (!parsed.ok) return parsed.response
  const { token, password } = parsed.data

  const record = await prisma.passwordResetToken.findUnique({ where: { token } })

  if (!record || record.expiresAt < new Date()) {
    return NextResponse.json({ error: "Reset link is invalid or has expired" }, { status: 400 })
  }

  const hashed = await bcrypt.hash(password, 12)

  await prisma.user.update({
    where: { email: record.email },
    data: { password: hashed },
  })

  await prisma.passwordResetToken.delete({ where: { token } })

  return NextResponse.json({ ok: true })
}
