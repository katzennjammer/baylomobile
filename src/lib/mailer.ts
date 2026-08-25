import nodemailer from "nodemailer"
import fs from "fs"
import path from "path"

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_SMTP_HOST,
  port: Number(process.env.EMAIL_SMTP_PORT ?? 587),
  secure: false,
  connectionTimeout: 8000,
  greetingTimeout:   8000,
  socketTimeout:     10000,
  auth: {
    user: process.env.EMAIL_SMTP_USER,
    pass: process.env.EMAIL_SMTP_PASS,
  },
})

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

const CATEGORIES: { label: string; count: string; key: string }[] = [
  { label: "Apparel", count: "2,400+ items", key: "CLOTHING" },
  { label: "Books", count: "1,100+ items", key: "BOOKS" },
  { label: "Tech", count: "860+ items", key: "ELECTRONICS" },
  { label: "Home", count: "1,500+ items", key: "FURNITURE" },
  { label: "Kids &amp; Baby", count: "640+ items", key: "TOYS" },
  { label: "Sports", count: "720+ items", key: "SPORTS" },
]

/** Builds the branded password-reset email HTML. */
function buildResetHtml(resetUrl: string, name?: string | null): string {
  const base = process.env.NEXTAUTH_URL ?? "https://baylo.ph"
  let logoUrl = process.env.EMAIL_LOGO_URL ?? ""
  if (!logoUrl) {
    try {
      const logoPath = path.join(process.cwd(), "public", "logo.png")
      const logoData = fs.readFileSync(logoPath)
      logoUrl = `data:image/png;base64,${logoData.toString("base64")}`
    } catch {
      logoUrl = `${base}/logo.png`
    }
  }
  const browse = `${base}/listings`
  const safeUrl = escapeHtml(resetUrl)
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi there,"
  const exp = "30 minutes"

  const tile = (c: { label: string; count: string; key: string }, padLeft: number, padRight: number) =>
    `<td width="33%" style="padding:0 ${padRight}px 10px ${padLeft}px;">
      <a href="${browse}?category=${c.key}" style="text-decoration:none;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e6dd; border-radius:10px;">
          <tr><td style="padding:13px 14px;">
            <div style="font-family:'Arial Black',Arial,sans-serif; font-size:12.5px; text-transform:uppercase; letter-spacing:0.3px; color:#161a12;">${c.label}</div>
            <div style="font-family:Arial,sans-serif; font-size:11px; color:#9a9d92; margin-top:3px;">${c.count}</div>
          </td></tr>
        </table>
      </a>
    </td>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>Reset your Baylo password</title>
</head>
<body style="margin:0; padding:0; background-color:#e7e5dd; -webkit-font-smoothing:antialiased;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; font-size:1px; line-height:1px; color:#e7e5dd;">Set a new password for your Baylo account. This secure link expires in ${exp}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#e7e5dd;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px; max-width:100%; background-color:#ffffff; border-radius:20px; overflow:hidden; box-shadow:0 18px 50px rgba(20,24,15,0.10);">

          <tr>
            <td style="background-color:#161a12; padding:30px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                      <td style="vertical-align:middle;"><span style="display:inline-block; width:42px; height:42px; background-color:#ffffff; border-radius:10px; text-align:center;"><img src="${logoUrl}" alt="Baylo" width="23" height="37" style="display:inline-block; width:23px; height:37px; object-fit:contain; vertical-align:middle; margin-top:2px;" /></span></td>
                      <td style="vertical-align:middle; padding-left:13px;"><span style="font-family:Arial,Helvetica,sans-serif; font-weight:800; font-size:23px; letter-spacing:0.5px; color:#ffffff;">BAYLO</span></td>
                    </tr></table>
                  </td>
                  <td style="vertical-align:middle; text-align:right; font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#6f7d68;">Account&nbsp;Security</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:48px 48px 0 48px;">
              <p style="margin:0 0 14px 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#1e9e63;">Password reset</p>
              <h1 style="margin:0 0 22px 0; font-family:'Arial Black',Arial,Helvetica,sans-serif; font-size:38px; line-height:1.02; letter-spacing:-0.8px; text-transform:uppercase; color:#161a12;">Let&rsquo;s get you<br />back in.</h1>
              <p style="margin:0 0 14px 0; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:1.65; color:#4a4e44;">${greeting}</p>
              <p style="margin:0 0 32px 0; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:1.65; color:#4a4e44;">Someone asked to reset the password for your Baylo account. Choose a new one with the button below — it only takes a moment.</p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 48px 6px 48px;">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td align="center" style="border-radius:12px; background-color:#1e9e63; box-shadow:0 8px 20px rgba(30,158,99,0.30);">
                  <a href="${safeUrl}" target="_blank" style="display:inline-block; padding:17px 44px; font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:700; letter-spacing:0.4px; color:#ffffff; text-decoration:none; border-radius:12px;">Choose a new password&nbsp;&nbsp;&rarr;</a>
                </td>
              </tr></table>
              <p style="margin:14px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:1.6; color:#9a9d92;"><span style="display:inline-block; width:7px; height:7px; border-radius:50%; background-color:#1e9e63; vertical-align:middle; margin-right:7px;"></span>This secure link expires in <strong style="color:#4a4e44;">${exp}</strong>.</p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 48px 0 48px;">
              <p style="margin:0 0 6px 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.6; color:#9a9d92;">Button not working? Paste this into your browser:</p>
              <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.5; word-break:break-all;"><a href="${safeUrl}" style="color:#1e9e63; text-decoration:underline;">${safeUrl}</a></p>
            </td>
          </tr>

          <tr>
            <td style="padding:30px 48px 0 48px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f5ef; border:1px solid #e8e6dd; border-radius:14px;"><tr>
                <td style="padding:18px 22px;">
                  <p style="margin:0 0 5px 0; font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:#161a12;">If this wasn&rsquo;t you</p>
                  <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:13.5px; line-height:1.6; color:#6f7368;">No action needed — your password stays exactly as it is unless you open the link above and set a new one. For peace of mind, you can review activity any time in your account settings.</p>
                </td>
              </tr></table>
            </td>
          </tr>

          <tr>
            <td style="padding:40px 48px 0 48px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #eceae2; font-size:0; line-height:0;">&nbsp;</td></tr></table>
              <p style="margin:30px 0 6px 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#1e9e63;">One marketplace · every category</p>
              <p style="margin:0 0 22px 0; font-family:'Arial Black',Arial,Helvetica,sans-serif; font-size:22px; line-height:1.12; letter-spacing:-0.4px; text-transform:uppercase; color:#161a12;">Nothing wasted. Everything traded.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 48px 8px 48px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>${tile(CATEGORIES[0], 0, 5)}${tile(CATEGORIES[1], 5, 5)}${tile(CATEGORIES[2], 5, 0)}</tr>
                <tr>${tile(CATEGORIES[3], 0, 5)}${tile(CATEGORIES[4], 5, 5)}${tile(CATEGORIES[5], 5, 0)}</tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:34px 48px 40px 48px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #eceae2; font-size:0; line-height:0;">&nbsp;</td></tr></table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>
                <td style="vertical-align:middle;"><img src="${logoUrl}" alt="Baylo" width="15" height="24" style="display:inline-block; width:15px; height:24px; object-fit:contain; vertical-align:middle;" /><span style="font-family:Arial,Helvetica,sans-serif; font-weight:800; font-size:14px; letter-spacing:0.5px; color:#161a12; vertical-align:middle; padding-left:8px;">BAYLO</span></td>
                <td style="vertical-align:middle; text-align:right;"><a href="${base}/help" style="font-family:Arial,Helvetica,sans-serif; font-size:12px; font-weight:700; color:#1e9e63; text-decoration:none; letter-spacing:0.3px;">Need help?</a></td>
              </tr></table>
              <p style="margin:18px 0 4px 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.6; color:#a4a79c;">Baylo Labs · Cebu IT Park, Apas · Cebu City 6000, Philippines</p>
              <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.6; color:#a4a79c;">You received this because a reset was requested for this email · <a href="${base}" style="color:#a4a79c; text-decoration:underline;">baylo.ph</a></p>
            </td>
          </tr>

        </table>
        <p style="margin:22px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#b3b6ab;">© 2026 Baylo Labs · Toward a local circular economy</p>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** Plain-text fallback (deliverability + non-HTML clients). */
function buildResetText(resetUrl: string, name?: string | null): string {
  return [
    "Let's get you back in.",
    "",
    name ? `Hi ${name},` : "Hi there,",
    "",
    "Someone asked to reset the password for your Baylo account. Open the link below to choose a new one. This secure link expires in 30 minutes.",
    "",
    resetUrl,
    "",
    "If this wasn't you, no action is needed — your password stays as it is unless you open the link and set a new one.",
    "",
    "Baylo Labs · Cebu IT Park, Apas · Cebu City 6000, Philippines",
  ].join("\n")
}

export async function sendPasswordResetEmail(to: string, resetUrl: string, name?: string | null) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? "Baylo <no-reply@baylo.ph>",
    to,
    subject: "Reset your Baylo password",
    html: buildResetHtml(resetUrl, name),
    text: buildResetText(resetUrl, name),
  })
}

// ── Swap confirmation code email ──────────────────────────────────────────────

function buildSwapCodeHtml(
  code: string,
  recipientName: string | null | undefined,
  otherUserName: string,
  items: { yours: string; theirs: string },
): string {
  const base = process.env.NEXTAUTH_URL ?? "https://baylo.ph"
  let logoUrl = process.env.EMAIL_LOGO_URL ?? ""
  if (!logoUrl) {
    try {
      const logoPath = path.join(process.cwd(), "public", "logo.png")
      const logoData = fs.readFileSync(logoPath)
      logoUrl = `data:image/png;base64,${logoData.toString("base64")}`
    } catch {
      logoUrl = `${base}/logo.png`
    }
  }
  const greeting   = recipientName ? `Hi ${escapeHtml(recipientName)},` : "Hi there,"
  const safeOther  = escapeHtml(otherUserName)
  const safeYours  = escapeHtml(items.yours)
  const safeTheirs = escapeHtml(items.theirs)
  const digits = code.split("").map((d) =>
    `<td style="padding:0 4px;"><div style="width:44px;height:56px;border:2px solid #4CAF50;border-radius:10px;background:#f1f8e9;display:flex;align-items:center;justify-content:center;font-family:'Arial Black',Arial,sans-serif;font-size:28px;font-weight:900;color:#161a12;text-align:center;line-height:56px;">${d}</div></td>`
  ).join("")

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Swap confirmation code</title>
</head>
<body style="margin:0;padding:0;background-color:#e7e5dd;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#e7e5dd;">Your Baylo swap confirmation code — give this to ${safeOther} when you meet.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#e7e5dd;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background-color:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 18px 50px rgba(20,24,15,0.10);">

          <tr>
            <td style="background-color:#161a12;padding:30px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                      <td style="vertical-align:middle;"><span style="display:inline-block;width:42px;height:42px;background-color:#ffffff;border-radius:10px;text-align:center;"><img src="${logoUrl}" alt="Baylo" width="23" height="37" style="display:inline-block;width:23px;height:37px;object-fit:contain;vertical-align:middle;margin-top:2px;" /></span></td>
                      <td style="vertical-align:middle;padding-left:13px;"><span style="font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:23px;letter-spacing:0.5px;color:#ffffff;">BAYLO</span></td>
                    </tr></table>
                  </td>
                  <td style="vertical-align:middle;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#4CAF50;">Swap Confirmation</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:48px 48px 0 48px;">
              <p style="margin:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#4CAF50;">In-person swap</p>
              <h1 style="margin:0 0 22px 0;font-family:'Arial Black',Arial,Helvetica,sans-serif;font-size:34px;line-height:1.05;letter-spacing:-0.8px;text-transform:uppercase;color:#161a12;">Your confirmation code</h1>
              <p style="margin:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;color:#4a4e44;">${greeting}</p>
              <p style="margin:0 0 28px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;color:#4a4e44;">You&rsquo;re meeting <strong>${safeOther}</strong> to complete your swap. <strong>Read your code to them</strong> — they&rsquo;ll enter it in the app to confirm you&rsquo;ve met in person.</p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 48px 0 48px;">
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
                <tr>${digits}</tr>
              </table>
              <p style="margin:10px 0 28px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#9a9d92;"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background-color:#4CAF50;vertical-align:middle;margin-right:7px;"></span>Expires in <strong style="color:#4a4e44;">15 minutes</strong> &middot; single use &middot; keep it visible until ${safeOther} enters it</p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 48px 28px 48px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8f7ff;border:1px solid #e0dbff;border-radius:14px;"><tr>
                <td style="padding:18px 22px;">
                  <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#4CAF50;">Swap details</p>
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#4a4e44;"><strong>${safeYours}</strong> &harr; <strong>${safeTheirs}</strong></p>
                </td>
              </tr></table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 48px 28px 48px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f5ef;border:1px solid #e8e6dd;border-radius:14px;"><tr>
                <td style="padding:18px 22px;">
                  <p style="margin:0 0 5px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#161a12;">How it works</p>
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.6;color:#6f7368;">Each of you has a different code in your email. Read yours to ${safeOther} — they type it into the app. Then they read theirs to you — you type it in. Both correct = swap confirmed!</p>
                </td>
              </tr></table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 48px 40px 48px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #eceae2;font-size:0;line-height:0;">&nbsp;</td></tr></table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>
                <td style="vertical-align:middle;"><img src="${logoUrl}" alt="Baylo" width="15" height="24" style="display:inline-block;width:15px;height:24px;object-fit:contain;vertical-align:middle;" /><span style="font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:14px;letter-spacing:0.5px;color:#161a12;vertical-align:middle;padding-left:8px;">BAYLO</span></td>
                <td style="vertical-align:middle;text-align:right;"><a href="${base}/help" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;color:#4CAF50;text-decoration:none;letter-spacing:0.3px;">Need help?</a></td>
              </tr></table>
              <p style="margin:18px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#a4a79c;">Baylo Labs &middot; Cebu IT Park, Apas &middot; Cebu City 6000, Philippines</p>
            </td>
          </tr>

        </table>
        <p style="margin:22px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#b3b6ab;">&copy; 2026 Baylo Labs &middot; Toward a local circular economy</p>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function buildSwapCodeText(
  code: string,
  recipientName: string | null | undefined,
  otherUserName: string,
  items: { yours: string; theirs: string },
): string {
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi there,"
  return [
    "Baylo — Swap Confirmation Code",
    "",
    greeting,
    "",
    `You're meeting ${otherUserName} to complete your swap of: ${items.yours} ↔ ${items.theirs}`,
    "",
    `Your code: ${code}`,
    "",
    `READ this code to ${otherUserName} — they enter it in the app.`,
    `Then they read THEIR code to you — you enter it in the app.`,
    "Both correct = swap confirmed!",
    "",
    "This code expires in 15 minutes.",
    "",
    "Baylo Labs · Cebu IT Park, Apas · Cebu City 6000, Philippines",
  ].join("\n")
}

export async function sendSwapConfirmationCode(
  to: string,
  name: string | null | undefined,
  code: string,
  otherUserName: string,
  items: { yours: string; theirs: string },
) {
  await transporter.sendMail({
    from:    process.env.EMAIL_FROM ?? "Baylo <no-reply@baylo.ph>",
    to,
    subject: `Your Baylo swap code: ${code}`,
    html:    buildSwapCodeHtml(code, name, otherUserName, items),
    text:    buildSwapCodeText(code, name, otherUserName, items),
  })
}

// ── Email verification ────────────────────────────────────────────────────────

/**
 * Resolves the logo the same way the other two templates do: an explicit
 * EMAIL_LOGO_URL, else the file inlined as a data URI, else a public URL.
 * Extracted because a third copy of the same eight lines was one too many.
 */
function logoSrc(base: string): string {
  const configured = process.env.EMAIL_LOGO_URL ?? ""
  if (configured) return configured
  try {
    const logoData = fs.readFileSync(path.join(process.cwd(), "public", "logo.png"))
    return `data:image/png;base64,${logoData.toString("base64")}`
  } catch {
    return `${base}/logo.png`
  }
}

function buildVerifyHtml(verifyUrl: string, name?: string | null): string {
  const base = process.env.NEXTAUTH_URL ?? "https://baylo.ph"
  const logoUrl = logoSrc(base)
  const safeUrl = escapeHtml(verifyUrl)
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi there,"
  const exp = "24 hours"

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<title>Verify your Baylo email</title>
</head>
<body style="margin:0;padding:0;background-color:#e7e5dd;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:#e7e5dd;">Confirm your email to finish setting up your Baylo account. This link expires in ${exp}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#e7e5dd;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background-color:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 18px 50px rgba(20,24,15,0.10);">

          <tr>
            <td style="background-color:#161a12;padding:30px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                      <td style="vertical-align:middle;"><span style="display:inline-block;width:42px;height:42px;background-color:#ffffff;border-radius:10px;text-align:center;"><img src="${logoUrl}" alt="Baylo" width="23" height="37" style="display:inline-block;width:23px;height:37px;object-fit:contain;vertical-align:middle;margin-top:2px;" /></span></td>
                      <td style="vertical-align:middle;padding-left:13px;"><span style="font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:23px;letter-spacing:0.5px;color:#ffffff;">BAYLO</span></td>
                    </tr></table>
                  </td>
                  <td style="vertical-align:middle;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#6f7d68;">Welcome</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:48px 48px 0 48px;">
              <p style="margin:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#1e9e63;">Confirm your email</p>
              <h1 style="margin:0 0 22px 0;font-family:'Arial Black',Arial,Helvetica,sans-serif;font-size:38px;line-height:1.02;letter-spacing:-0.8px;text-transform:uppercase;color:#161a12;">One tap and<br />you&rsquo;re in.</h1>
              <p style="margin:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;color:#4a4e44;">${greeting}</p>
              <p style="margin:0 0 32px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;color:#4a4e44;">Welcome to Baylo. Confirm this email address to verify your account &mdash; verifying is what unlocks the one-time welcome grant of Pasa Leaves.</p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 48px 6px 48px;">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td align="center" style="border-radius:12px;background-color:#1e9e63;box-shadow:0 8px 20px rgba(30,158,99,0.30);">
                  <a href="${safeUrl}" target="_blank" style="display:inline-block;padding:17px 44px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;letter-spacing:0.4px;color:#ffffff;text-decoration:none;border-radius:12px;">Verify my email&nbsp;&nbsp;&rarr;</a>
                </td>
              </tr></table>
              <p style="margin:14px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#9a9d92;"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background-color:#1e9e63;vertical-align:middle;margin-right:7px;"></span>This link expires in <strong style="color:#4a4e44;">${exp}</strong> and can be used once.</p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 48px 0 48px;">
              <p style="margin:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#9a9d92;">Button not working? Paste this into your browser:</p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${safeUrl}" style="color:#1e9e63;text-decoration:underline;">${safeUrl}</a></p>
            </td>
          </tr>

          <tr>
            <td style="padding:30px 48px 0 48px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f5ef;border:1px solid #e8e6dd;border-radius:14px;"><tr>
                <td style="padding:18px 22px;">
                  <p style="margin:0 0 5px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#161a12;">If this wasn&rsquo;t you</p>
                  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.6;color:#6f7368;">Someone entered this address when signing up for Baylo. If that wasn&rsquo;t you, ignore this email &mdash; the account stays unverified and nothing happens.</p>
                </td>
              </tr></table>
            </td>
          </tr>

          <tr>
            <td style="padding:34px 48px 40px 48px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #eceae2;font-size:0;line-height:0;">&nbsp;</td></tr></table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>
                <td style="vertical-align:middle;"><img src="${logoUrl}" alt="Baylo" width="15" height="24" style="display:inline-block;width:15px;height:24px;object-fit:contain;vertical-align:middle;" /><span style="font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:14px;letter-spacing:0.5px;color:#161a12;vertical-align:middle;padding-left:8px;">BAYLO</span></td>
                <td style="vertical-align:middle;text-align:right;"><a href="${base}/help" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;color:#1e9e63;text-decoration:none;letter-spacing:0.3px;">Need help?</a></td>
              </tr></table>
              <p style="margin:18px 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#a4a79c;">Baylo Labs &middot; Cebu IT Park, Apas &middot; Cebu City 6000, Philippines</p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#a4a79c;">You received this because this address was used to create a Baylo account &middot; <a href="${base}" style="color:#a4a79c;text-decoration:underline;">baylo.ph</a></p>
            </td>
          </tr>

        </table>
        <p style="margin:22px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#b3b6ab;">&copy; 2026 Baylo Labs &middot; Toward a local circular economy</p>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function buildVerifyText(verifyUrl: string, name?: string | null): string {
  return [
    "One tap and you're in.",
    "",
    name ? `Hi ${name},` : "Hi there,",
    "",
    "Welcome to Baylo. Confirm this email address to verify your account — verifying is what unlocks the one-time welcome grant of Pasa Leaves.",
    "",
    verifyUrl,
    "",
    "This link expires in 24 hours and can be used once.",
    "",
    "If you didn't sign up for Baylo, ignore this email — the account stays unverified and nothing happens.",
    "",
    "Baylo Labs · Cebu IT Park, Apas · Cebu City 6000, Philippines",
  ].join("\n")
}

export async function sendVerificationEmail(to: string, verifyUrl: string, name?: string | null) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? "Baylo <no-reply@baylo.ph>",
    to,
    subject: "Verify your Baylo email",
    html: buildVerifyHtml(verifyUrl, name),
    text: buildVerifyText(verifyUrl, name),
  })
}
