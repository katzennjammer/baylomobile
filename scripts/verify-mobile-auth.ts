// Acceptance harness for the mobile client's two new entry paths.
//
// It drives the REAL routes over HTTP, in the exact order and with the exact
// bodies `baylo-mobile/src/api/client.ts` uses, so what passes here is what the
// app does — not an approximation of it. The one thing faked is the SMTP
// server, and it is faked by speaking actual SMTP on a local port: nodemailer,
// the template and the send path all run, and the verification link is read out
// of the delivered message the way a user reads it out of an inbox. Nothing
// reaches into the database to fabricate a token.
//
// What it is looking for, in the order the app hits it:
//
//   1. register            — the mobile "Create an account" screen
//   2. token               — the sign-in it performs immediately afterwards,
//                            which is where the pending session comes from
//   3. resend-verification — the button on the "check your email" step, with a
//                            Bearer token. Its ceiling is three per hour PER
//                            USER, and registration's own email does not come
//                            out of that budget — registration is limited
//                            separately, per IP. The fourth resend is spent at
//                            the end of section 5 to prove the 429.
//   4. verify-email (POST) — the native transport for the emailed token
//   5. the grant           — exactly 50 Leaves, exactly once, and the
//                            whole-database ledger invariant either side of it
//   6. google/token        — reachable, and failing closed on a forged token
//
// Run (from baylo/, with a dev server on BASE whose SMTP points at SMTP_PORT):
//   npx tsx scripts/verify-mobile-auth.ts
import net from "net"
import prisma from "../src/lib/prisma"
import { SIGNUP_GRANT_LEAVES } from "../src/lib/task-constants"

const BASE = process.env.ACCEPT_BASE ?? "http://127.0.0.1:3100"
const SMTP_PORT = Number(process.env.ACCEPT_SMTP_PORT ?? 2525)
const P = "zzmobileauth-"
const PASSWORD = "correct-horse-battery"

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}  ${detail}`)
  }
}

// ── A minimal SMTP sink ──────────────────────────────────────────────────────

interface Captured {
  to: string
  body: string
}
const inbox: Captured[] = []

function startSmtpSink(port: number): Promise<net.Server> {
  const server = net.createServer((socket) => {
    let inData = false
    let rcpt = ""
    let body = ""

    socket.write("220 localhost ESMTP sink\r\n")
    socket.on("data", (chunk) => {
      const text = chunk.toString("utf8")

      if (inData) {
        body += text
        if (body.includes("\r\n.\r\n")) {
          inData = false
          inbox.push({ to: rcpt, body: body.split("\r\n.\r\n")[0] })
          body = ""
          socket.write("250 2.0.0 Ok: queued\r\n")
        }
        return
      }

      for (const line of text.split("\r\n").filter(Boolean)) {
        const verb = line.slice(0, 4).toUpperCase()
        if (verb === "EHLO" || verb === "HELO") socket.write("250-localhost\r\n250 AUTH PLAIN LOGIN\r\n")
        else if (verb === "AUTH") socket.write("235 2.7.0 Accepted\r\n")
        else if (verb === "MAIL") socket.write("250 2.1.0 Ok\r\n")
        else if (verb === "RCPT") {
          rcpt = /<([^>]*)>/.exec(line)?.[1] ?? ""
          socket.write("250 2.1.5 Ok\r\n")
        } else if (verb === "DATA") {
          inData = true
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n")
        } else if (verb === "QUIT") {
          socket.write("221 2.0.0 Bye\r\n")
          socket.end()
        } else socket.write("250 2.0.0 Ok\r\n")
      }
    })
    socket.on("error", () => {
      /* client hung up; not this test's concern */
    })
  })

  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => resolve(server))
  })
}

/** How many messages have reached `to` so far. */
function countFor(to: string): number {
  return inbox.filter((m) => m.to === to).length
}

/** Pulls the raw token out of the most recent message to `to`. */
function tokenFor(to: string): string | null {
  for (let i = inbox.length - 1; i >= 0; i--) {
    if (inbox[i].to !== to) continue
    // Quoted-printable soft line breaks split long URLs across lines.
    const decoded = inbox[i].body.replace(/=\r\n/g, "").replace(/=3D/g, "=")
    const match = /\/api\/auth\/verify-email\?token=([A-Za-z0-9]+)/.exec(decoded)
    if (match) return match[1]
  }
  return null
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

const jsonHeaders = { "content-type": "application/json", accept: "application/json" }

async function req(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; json: Record<string, unknown>; retryAfter: string | null }> {
  const res = await fetch(`${BASE}${path}`, { ...init, redirect: "manual" })
  let json: Record<string, unknown> = {}
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    /* empty body */
  }
  return { status: res.status, json, retryAfter: res.headers.get("retry-after") }
}

/** The whole-database ledger invariant, measured rather than assumed. */
async function ledgerTotals() {
  const [users, all, positive] = await Promise.all([
    prisma.user.aggregate({ _sum: { leaves: true } }),
    prisma.leafTransaction.aggregate({ _sum: { amount: true } }),
    prisma.leafTransaction.aggregate({ _sum: { amount: true }, where: { amount: { gt: 0 } } }),
  ])
  return {
    userLeaves: users._sum.leaves ?? 0,
    allRows: all._sum.amount ?? 0,
    positiveRows: positive._sum.amount ?? 0,
  }
}

async function main() {
  const sink = await startSmtpSink(SMTP_PORT)
  console.log(`SMTP sink listening on 127.0.0.1:${SMTP_PORT}`)
  console.log(`Driving ${BASE}\n`)

  const before = await ledgerTotals()
  console.log(
    `Ledger before:  SUM(User.leaves)=${before.userLeaves}  ` +
      `SUM(all rows)=${before.allRows}  SUM(positive rows)=${before.positiveRows}`,
  )

  const stamp = Date.now()
  const email = `${P}${stamp}@example.com`

  // ── 1. Registration, as the mobile screen performs it ─────────────────────
  console.log("\n[1] POST /api/auth/register — the mobile Create-an-account screen")

  // Field-level validation first: the screen puts `issues` against the input
  // they name, so a 400 that does not carry them would silently degrade to a
  // banner. 7 characters is one short of the server's minimum.
  const short = await req("/api/auth/register", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ name: "Short Pass", email: `${P}short-${stamp}@example.com`, password: "7chars!" }),
  })
  const shortIssues = (short.json.issues ?? []) as { field: string; message: string }[]
  check(
    "a 7-character password is rejected with a field-level issue",
    short.status === 400 && shortIssues.some((i) => i.field === "password"),
    `status=${short.status} body=${JSON.stringify(short.json)}`,
  )
  check(
    "the issue's message is the one the client shows verbatim",
    shortIssues.some((i) => /8 characters/.test(i.message)),
    JSON.stringify(shortIssues),
  )

  const reg = await req("/api/auth/register", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ name: "Mobile Tester", email, password: PASSWORD }),
  })
  check("registration returns 201", reg.status === 201, `status=${reg.status} body=${JSON.stringify(reg.json)}`)
  check(
    "it reports the verification email as sent",
    reg.json.verificationEmailSent === true,
    JSON.stringify(reg.json),
  )
  check("the new account is not yet verified", reg.json.isVerified === false, JSON.stringify(reg.json))
  check("one verification email was delivered", countFor(email) === 1, `count=${countFor(email)}`)

  const userId = String(reg.json.id)

  // The duplicate the screen routes to the email field as a 409.
  const dupe = await req("/api/auth/register", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ name: "Mobile Tester", email, password: PASSWORD }),
  })
  check("re-registering the same address is a 409", dupe.status === 409, `status=${dupe.status}`)

  // ── 2. The sign-in the screen performs immediately afterwards ─────────────
  console.log("\n[2] POST /api/auth/token — where the pending session comes from")

  const tok = await req("/api/auth/token", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  check("password sign-in succeeds for an UNVERIFIED account", tok.status === 200, `status=${tok.status}`)
  check(
    "it returns the pair and the user block the client stores",
    typeof tok.json.accessToken === "string" &&
      typeof tok.json.refreshToken === "string" &&
      typeof tok.json.user === "object",
    JSON.stringify(Object.keys(tok.json)),
  )

  const accessToken = String(tok.json.accessToken)

  const wrong = await req("/api/auth/token", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email, password: "not-the-password" }),
  })
  check("a wrong password is a 401", wrong.status === 401, `status=${wrong.status}`)
  check(
    "and its message is the deliberately vague one the client shows verbatim",
    /invalid email or password/i.test(String(wrong.json.error ?? "")),
    JSON.stringify(wrong.json),
  )

  // The Bearer token actually works against the v1 tree — this is the "password
  // login still works end to end" leg, not just "the endpoint answered".
  const home = await req("/api/v1/home", { headers: { authorization: `Bearer ${accessToken}` } })
  check("that access token authenticates a real /api/v1 request", home.status === 200, `status=${home.status}`)

  // ── 3. Resend, with a Bearer token, and its ceiling ───────────────────────
  console.log("\n[3] POST /api/auth/resend-verification — the button on the check-your-email step")

  const noAuth = await req("/api/auth/resend-verification", { method: "POST", headers: jsonHeaders })
  check("it is authenticated (401 without a token)", noAuth.status === 401, `status=${noAuth.status}`)

  const resend1 = await req("/api/auth/resend-verification", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  })
  check("a Bearer token is accepted", resend1.status === 200, `status=${resend1.status} ${JSON.stringify(resend1.json)}`)
  check("it reports the mail as sent", resend1.json.sent === true, JSON.stringify(resend1.json))
  check("a second email was delivered", countFor(email) === 2, `count=${countFor(email)}`)

  // The budget is THREE PER HOUR PER USER, and the email registration sent does
  // not come out of it — registration is limited separately, per IP, under its
  // own key. So all three of these land and the fourth is the one refused. The
  // fourth is spent at the end of section 5, once the account is verified,
  // because that is the only order in which both the already-verified no-op and
  // the 429 can be observed on one account within one budget.
  const resend2 = await req("/api/auth/resend-verification", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  })
  check("a second resend still lands (2 of 3)", resend2.status === 200, `status=${resend2.status}`)
  check("a third email was delivered", countFor(email) === 3, `count=${countFor(email)}`)

  // Issuing a new token must invalidate the previous one, or "send me another"
  // widens the window instead of moving it.
  const liveTokens = await prisma.emailVerificationToken.count({ where: { userId } })
  check("only ONE verification token is live after three sends", liveTokens === 1, `count=${liveTokens}`)

  // ── 4. Redemption over the native transport ───────────────────────────────
  console.log("\n[4] POST /api/auth/verify-email — the token, sent as JSON rather than followed")

  const token = tokenFor(email)
  check("a token was extractable from the delivered email", !!token, "none found")
  if (!token) throw new Error("no token; cannot continue")

  const beforeUser = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { leaves: true, lifetimeLeaves: true, isVerified: true, signupGrantClaimed: true },
  })

  const verify = await req("/api/auth/verify-email", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ token }),
  })
  check("redemption succeeds", verify.status === 200 && verify.json.verified === true, JSON.stringify(verify.json))
  check("it reports this as the call that flipped the flag", verify.json.alreadyVerified === false, JSON.stringify(verify.json))

  // ── 5. Exactly 50 Leaves, exactly once ────────────────────────────────────
  console.log("\n[5] the grant — exactly 50 Leaves, exactly once")

  const afterUser = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { leaves: true, lifetimeLeaves: true, isVerified: true, signupGrantClaimed: true },
  })
  const grantRows = await prisma.leafTransaction.findMany({
    where: { userId, type: "SIGNUP_GRANT" },
    select: { amount: true, description: true },
  })

  check("the account is now verified", afterUser.isVerified, JSON.stringify(afterUser))
  check("the grant is marked claimed", afterUser.signupGrantClaimed, JSON.stringify(afterUser))
  check(
    `exactly one SIGNUP_GRANT row, for ${SIGNUP_GRANT_LEAVES}`,
    grantRows.length === 1 && grantRows[0].amount === SIGNUP_GRANT_LEAVES,
    JSON.stringify(grantRows),
  )

  const balanceDelta = afterUser.leaves - beforeUser.leaves
  const lifetimeDelta = afterUser.lifetimeLeaves - beforeUser.lifetimeLeaves
  const taskRows = await prisma.leafTransaction.findMany({
    where: { userId, type: "TASK_REWARD" },
    select: { amount: true, description: true },
  })
  const taskTotal = taskRows.reduce((sum, r) => sum + r.amount, 0)
  console.log(
    `      balance ${beforeUser.leaves} -> ${afterUser.leaves} (+${balanceDelta}), ` +
      `of which grant=${SIGNUP_GRANT_LEAVES} and VERIFY_ACCOUNT task=${taskTotal}`,
  )
  check(
    "the balance moved by grant + task reward and nothing else",
    balanceDelta === SIGNUP_GRANT_LEAVES + taskTotal,
    `delta=${balanceDelta}`,
  )
  check("lifetimeLeaves moved by the same amount", lifetimeDelta === balanceDelta, `delta=${lifetimeDelta}`)

  // What the VERIFY screen displays. `leavesAwarded` is grant + task, not the
  // grant alone — the 50 is the welcome grant and the rest is VERIFY_ACCOUNT
  // paid through the ordinary task path. Worth pinning: a client that showed
  // this number as "your 50-Leaf grant" would be wrong by the task reward.
  check(
    `verify-email reported leavesAwarded = ${SIGNUP_GRANT_LEAVES} + ${taskTotal}`,
    verify.json.leavesAwarded === SIGNUP_GRANT_LEAVES + taskTotal,
    `reported=${String(verify.json.leavesAwarded)}`,
  )

  // Redeeming again: the token is single-use, so this must be refused outright.
  const replay = await req("/api/auth/verify-email", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ token }),
  })
  check("replaying the same token is refused", replay.status === 400, `status=${replay.status} ${JSON.stringify(replay.json)}`)

  // The third and last send of the budget, now that the account is verified.
  // The route short-circuits before issuing a token — there is no reason to
  // mint a live credential for an account already past the gate — and the
  // client shows "already verified" rather than an error.
  const resend3 = await req("/api/auth/resend-verification", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  })
  check(
    "resending for a verified account is a no-op that reports alreadyVerified",
    resend3.status === 200 && resend3.json.alreadyVerified === true && resend3.json.sent === false,
    JSON.stringify(resend3.json),
  )
  check("and no fourth email was sent", countFor(email) === 3, `count=${countFor(email)}`)

  // Four in an hour is one too many.
  const resend4 = await req("/api/auth/resend-verification", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  })
  check(
    "the FOURTH send in an hour is refused with 429",
    resend4.status === 429,
    `status=${resend4.status} body=${JSON.stringify(resend4.json)}`,
  )
  check(
    "the 429 carries Retry-After, which the screen turns into 'try again in N minutes'",
    resend4.retryAfter !== null && Number(resend4.retryAfter) > 0,
    `retry-after=${resend4.retryAfter}`,
  )

  const finalUser = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { leaves: true },
  })
  check("no further Leaves were credited", finalUser.leaves === afterUser.leaves, `${finalUser.leaves} vs ${afterUser.leaves}`)

  const grantRowsFinal = await prisma.leafTransaction.count({ where: { userId, type: "SIGNUP_GRANT" } })
  check("still exactly one SIGNUP_GRANT row", grantRowsFinal === 1, `count=${grantRowsFinal}`)

  // ── 6. The Google endpoint ────────────────────────────────────────────────
  console.log("\n[6] POST /api/auth/google/token — reachable, and failing closed")

  const noToken = await req("/api/auth/google/token", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({}),
  })
  check("a missing idToken is a 400", noToken.status === 400, `status=${noToken.status} ${JSON.stringify(noToken.json)}`)

  // A syntactically valid JWT with a forged payload. If this were ever accepted
  // the endpoint would be a "log me in as anyone" API.
  const forged = [
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "nope" })).toString("base64url"),
    Buffer.from(
      JSON.stringify({
        iss: "https://accounts.google.com",
        aud: "whatever",
        email: "victim@example.com",
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url"),
    "not-a-real-signature",
  ].join(".")

  const forgedRes = await req("/api/auth/google/token", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ idToken: forged }),
  })
  const configured = forgedRes.status !== 500
  check(
    "a forged ID token is refused",
    forgedRes.status === 401 || forgedRes.status === 500,
    `status=${forgedRes.status} ${JSON.stringify(forgedRes.json)}`,
  )
  check(
    "no account was created for the forged token's email",
    (await prisma.user.count({ where: { email: "victim@example.com" } })) === 0,
  )
  console.log(
    configured
      ? "      GOOGLE audiences ARE configured on this server (401 = signature rejected)."
      : "      NOTE: 500 means the server has NO accepted Google audiences —\n" +
        "            set GOOGLE_CLIENT_ID / GOOGLE_NATIVE_CLIENT_IDS in baylo/.env.",
  )

  // ── 7. The invariant, over the whole database ─────────────────────────────
  console.log("\n[7] SUM(User.leaves) == SUM(LeafTransaction.amount), signed, all rows")

  const after = await ledgerTotals()
  console.log(
    `Ledger after:   SUM(User.leaves)=${after.userLeaves}  ` +
      `SUM(all rows)=${after.allRows}  SUM(positive rows)=${after.positiveRows}`,
  )
  check(
    "the two totals are equal",
    after.userLeaves === after.allRows,
    `${after.userLeaves} != ${after.allRows}`,
  )
  check(
    "and the run's own delta is accounted for entirely by this account",
    after.userLeaves - before.userLeaves === afterUser.leaves,
    `db delta=${after.userLeaves - before.userLeaves} account=${afterUser.leaves}`,
  )

  sink.close()

  console.log(`\n${pass} passed, ${fail} failed`)
  console.log(`(test account left in place: ${email})`)
  if (fail > 0) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
