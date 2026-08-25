// Acceptance harness for verification, the signup grant and their concurrency
// guard. Drives the real production functions — markVerified() is the exact
// function both Google sign-in paths call, not a reimplementation of it.
//
// Run:  npx tsx scripts/verify-token-auth.ts
import prisma from "../src/lib/prisma"
import { markVerified } from "../src/lib/verification"
import { SIGNUP_GRANT_LEAVES, TASK_REWARDS } from "../src/lib/task-constants"

const P = "zzverify-"
let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`) }
}

async function snapshot(userId: string) {
  const [u, txs] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { isVerified: true, signupGrantClaimed: true, leaves: true, lifetimeLeaves: true },
    }),
    prisma.leafTransaction.findMany({
      where: { userId }, orderBy: { createdAt: "asc" },
      select: { type: true, amount: true, description: true, createdAt: true, eventAt: true },
    }),
  ])
  return { ...u, txs }
}

async function freshUser(tag: string) {
  return prisma.user.create({
    data: { name: `ZZ ${tag}`, email: `${P}${tag}-${Date.now()}@example.com` },
  })
}

async function main() {
  // ── 1. A single verification ───────────────────────────────────────────────
  console.log("\n[1] verifying a fresh account")
  const u1 = await freshUser("single")
  const before = await snapshot(u1.id)
  check("starts unverified, 0 leaves, no ledger rows",
    !before.isVerified && !before.signupGrantClaimed && before.leaves === 0 && before.txs.length === 0,
    JSON.stringify(before))

  const at = new Date()
  const r1 = await markVerified(u1.id, at)
  const after = await snapshot(u1.id)

  console.log(`      markVerified -> ${JSON.stringify(r1)}`)
  check("flag flipped", r1.flipped && after.isVerified)
  check(`signup grant credited exactly ${SIGNUP_GRANT_LEAVES}`, r1.grantAwarded === SIGNUP_GRANT_LEAVES,
    `got ${r1.grantAwarded}`)
  check(`VERIFY_ACCOUNT awarded ${TASK_REWARDS.VERIFY_ACCOUNT}`, r1.taskAwarded === TASK_REWARDS.VERIFY_ACCOUNT,
    `got ${r1.taskAwarded}`)
  check("signupGrantClaimed set", after.signupGrantClaimed)

  const expected = SIGNUP_GRANT_LEAVES + TASK_REWARDS.VERIFY_ACCOUNT
  check(`leaves = ${expected}`, after.leaves === expected, `got ${after.leaves}`)
  check(`lifetimeLeaves = ${expected}`, after.lifetimeLeaves === expected, `got ${after.lifetimeLeaves}`)

  const grant = after.txs.filter((t) => t.type === "SIGNUP_GRANT")
  check("exactly one SIGNUP_GRANT ledger row", grant.length === 1, `got ${grant.length}`)
  check(`SIGNUP_GRANT amount = ${SIGNUP_GRANT_LEAVES}`, grant[0]?.amount === SIGNUP_GRANT_LEAVES)
  check("SIGNUP_GRANT eventAt = the verification moment",
    grant[0]?.eventAt.getTime() === at.getTime(),
    `eventAt=${grant[0]?.eventAt.toISOString()} vs at=${at.toISOString()}`)

  const task = after.txs.filter((t) => t.type === "TASK_REWARD")
  check("exactly one TASK_REWARD ledger row", task.length === 1, `got ${task.length}`)
  check("TASK_REWARD eventAt = the verification moment",
    task[0]?.eventAt.getTime() === at.getTime())
  for (const t of after.txs) {
    check(`${t.type} createdAt is write time, not backdated`,
      Math.abs(t.createdAt.getTime() - Date.now()) < 60_000)
  }

  // ── 2. Verifying again must credit nothing ─────────────────────────────────
  console.log("\n[2] verifying the SAME account a second time")
  const r2 = await markVerified(u1.id)
  const after2 = await snapshot(u1.id)
  console.log(`      markVerified -> ${JSON.stringify(r2)}`)
  check("reports no flip", !r2.flipped)
  check("credits 0 grant", r2.grantAwarded === 0, `got ${r2.grantAwarded}`)
  check("credits 0 task", r2.taskAwarded === 0, `got ${r2.taskAwarded}`)
  check("leaves unchanged", after2.leaves === after.leaves, `${after.leaves} -> ${after2.leaves}`)
  check("ledger row count unchanged", after2.txs.length === after.txs.length)

  // ── 3. Concurrency — the property the WHERE-clause guard exists for ────────
  console.log("\n[3] eight concurrent verifications of one fresh account")
  const u2 = await freshUser("race")
  const results = await Promise.all(Array.from({ length: 8 }, () => markVerified(u2.id)))
  const grantTotal = results.reduce((s, r) => s + r.grantAwarded, 0)
  const winners = results.filter((r) => r.grantAwarded > 0).length
  const raced = await snapshot(u2.id)
  console.log(`      grant winners: ${winners}, total granted: ${grantTotal}`)
  check("exactly one caller paid the grant", winners === 1, `got ${winners}`)
  check(`grant total = ${SIGNUP_GRANT_LEAVES}`, grantTotal === SIGNUP_GRANT_LEAVES, `got ${grantTotal}`)
  check("exactly one SIGNUP_GRANT row",
    raced.txs.filter((t) => t.type === "SIGNUP_GRANT").length === 1)
  check("balance matches its ledger",
    raced.leaves === raced.txs.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0),
    `leaves=${raced.leaves} ledger=${raced.txs.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0)}`)

  // ── 4. Cleanup, then the global invariant ─────────────────────────────────
  const ids = (await prisma.user.findMany({
    where: { email: { startsWith: P } }, select: { id: true },
  })).map((u) => u.id)
  await prisma.leafTransaction.deleteMany({ where: { userId: { in: ids } } })
  await prisma.taskCompletion.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  console.log(`\n[4] cleaned up ${ids.length} scratch users`)

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}  pass=${pass} fail=${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
