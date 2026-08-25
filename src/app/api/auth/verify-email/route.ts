import { NextRequest, NextResponse } from "next/server"
import { consumeVerificationToken, type ConsumeResult } from "@/lib/email-verification"
import { parseBody, verifyEmailSchema } from "@/lib/validation"

/**
 * Redeems an email verification token.
 *
 * This is a REAL static segment, not something the NextAuth catch-all handles.
 * `src/app/api/auth/[...nextauth]/route.ts` matches every /api/auth/* path and
 * answers 400 for any action it does not recognise, so a verification route
 * that lived only inside it would look like a working endpoint returning a
 * confusing error. Next's router gives a static segment precedence over a
 * catch-all at the same level, which is why this file — and register,
 * forgot-password, token, refresh and revoke before it — resolve here instead.
 * The GET/POST exports below are what prove it: the catch-all's handlers are
 * never invoked for this path.
 *
 * Two transports, one code path:
 *   GET  ?token=…  the link in the email, opened in a browser.
 *   POST { token } the native client, which cannot follow a web link cleanly —
 *                  it captures the token from a deep link or a paste and sends
 *                  it as JSON.
 * Both call consumeVerificationToken(), so there is exactly one place where a
 * token is validated and spent.
 */

const REASON_STATUS: Record<"invalid" | "expired", number> = {
  // Both are 400 rather than 404/410: the token is a credential, and the caller
  // learns only that this one is not usable. Distinguishing "never existed"
  // from "already spent" would tell a scanner which guesses were close.
  invalid: 400,
  expired: 400,
}

const REASON_MESSAGE: Record<"invalid" | "expired", string> = {
  invalid: "This verification link is invalid or has already been used",
  expired: "This verification link has expired. Request a new one.",
}

function jsonResult(result: ConsumeResult): NextResponse {
  if (!result.ok) {
    return NextResponse.json(
      {
        error: REASON_MESSAGE[result.reason],
        code: result.reason === "expired" ? "EXPIRED_TOKEN" : "INVALID_TOKEN",
      },
      { status: REASON_STATUS[result.reason] },
    )
  }

  const { flipped, grantAwarded, taskAwarded } = result.verification
  return NextResponse.json({
    ok: true,
    verified: true,
    /**
     * False on the call that actually verified, true if the account was
     * already verified when the token was redeemed. The client uses this to
     * decide whether to celebrate; `leavesAwarded` is 0 in the latter case
     * because markVerified() credits nothing on a repeat.
     */
    alreadyVerified: !flipped,
    leavesAwarded: grantAwarded + taskAwarded,
  })
}

/** The link in the email. */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? ""
  const parsed = verifyEmailSchema.safeParse({ token })

  const result: ConsumeResult = parsed.success
    ? await consumeVerificationToken(parsed.data.token)
    : { ok: false, reason: "invalid" }

  // A browser followed a link and expects a page, not a JSON blob. Anything
  // else — curl, the native client, a health check — gets the JSON. The Accept
  // header is what distinguishes them, and getting it wrong is cosmetic in
  // both directions: the token is already spent by this point either way.
  const wantsHtml = (req.headers.get("accept") ?? "").includes("text/html")
  if (wantsHtml) {
    const base = process.env.NEXTAUTH_URL ?? req.nextUrl.origin
    const target = result.ok
      ? new URL("/dashboard?verified=1", base)
      : new URL(`/dashboard?verifyError=${result.reason}`, base)
    return NextResponse.redirect(target)
  }

  return jsonResult(result)
}

/** The native client's transport for the same token. */
export async function POST(req: NextRequest) {
  const parsed = await parseBody(req, verifyEmailSchema)
  if (!parsed.ok) return parsed.response

  return jsonResult(await consumeVerificationToken(parsed.data.token))
}
