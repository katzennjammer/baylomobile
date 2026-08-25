// Acceptance harness for the task-reward faucet caps.
// Runs against a scratch DB — point DATABASE_URL at it before running.
import prisma from "../src/lib/prisma"
import { awardTask, reconcileTasks } from "../src/lib/tasks"
import { WEEKLY_TASK_LEAF_CAP, TASK_REWARDS } from "../src/lib/task-constants"
import { computeImpactData } from "../src/lib/impact-constants"

const P = "ZZTEST_"
let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`) }
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: P } }, select: { id: true } })
  const ids = users.map((u) => u.id)
  if (!ids.length) return
  await prisma.taskCompletion.deleteMany({ where: { userId: { in: ids } } })
  await prisma.leafTransaction.deleteMany({ where: { userId: { in: ids } } })
  await prisma.tradeRequest.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } })
  await prisma.item.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

async function mkUser(tag: string) {
  return prisma.user.create({ data: { name: P + tag, email: `${P}${tag}@test.local`, password: "x" } })
}
async function mkItem(userId: string, tag: string) {
  return prisma.item.create({
    data: { title: P + tag, description: "d", images: "[]", category: "BOOKS", condition: "GOOD", userId },
  })
}
async function mkCompletedTrade(aId: string, bId: string, i1: string, i2: string) {
  return prisma.tradeRequest.create({
    data: { senderId: aId, receiverId: bId, offeredItemId: i1, requestedItemId: i2, status: "COMPLETED" },
  })
}

async function main() {
  await cleanup()

  const a = await mkUser("alice"), b = await mkUser("bob"), c = await mkUser("carol")
  const ia1 = await mkItem(a.id, "a1"), ia2 = await mkItem(a.id, "a2"), ia3 = await mkItem(a.id, "a3")
  const ib1 = await mkItem(b.id, "b1"), ib2 = await mkItem(b.id, "b2")
  const ic1 = await mkItem(c.id, "c1")

  // ── 1. A completed trade awards Leaves once, writes a ledger row, ──────────
  //       increments BOTH balances.
  console.log("\n[1] first trade with a new partner")
  const t1 = await mkCompletedTrade(a.id, b.id, ia1.id, ib1.id)
  const r1 = await awardTask(prisma, a.id, "VERIFIED_SWAP", t1.id, { partnerId: b.id, tradeId: t1.id })
  let ua = await prisma.user.findUnique({ where: { id: a.id } })
  let ledger = await prisma.leafTransaction.findMany({ where: { userId: a.id, type: "TASK_REWARD" } })
  check("awards VERIFIED_SWAP", r1.awarded === TASK_REWARDS.VERIFIED_SWAP, JSON.stringify(r1))
  check("leaves incremented", ua!.leaves === 20, `leaves=${ua!.leaves}`)
  check("lifetimeLeaves incremented", ua!.lifetimeLeaves === 20, `lifetime=${ua!.lifetimeLeaves}`)
  check("one TASK_REWARD ledger row", ledger.length === 1 && ledger[0].amount === 20)
  check("balance reconstructable from ledger",
    ledger.reduce((s, r) => s + r.amount, 0) === ua!.leaves)

  // idempotency: same trade again
  const r1b = await awardTask(prisma, a.id, "VERIFIED_SWAP", t1.id, { partnerId: b.id, tradeId: t1.id })
  ua = await prisma.user.findUnique({ where: { id: a.id } })
  check("same trade re-award is a no-op", r1b.awarded === 0 && r1b.reason === "already_awarded", JSON.stringify(r1b))
  check("balance unchanged after re-award", ua!.leaves === 20)

  // ── 2. A SECOND trade with the SAME partner inside 30 days awards zero ─────
  console.log("\n[2] second trade, same partner, inside 30 days")
  const t2 = await mkCompletedTrade(a.id, b.id, ia2.id, ib2.id)
  const r2 = await awardTask(prisma, a.id, "VERIFIED_SWAP", t2.id, { partnerId: b.id, tradeId: t2.id })
  ua = await prisma.user.findUnique({ where: { id: a.id } })
  check("repeat partner awards zero", r2.awarded === 0 && r2.reason === "repeat_partner", JSON.stringify(r2))
  check("balance unchanged", ua!.leaves === 20 && ua!.lifetimeLeaves === 20)
  const zeroRow = await prisma.taskCompletion.findUnique({
    where: { userId_task_refId: { userId: a.id, task: "VERIFIED_SWAP", refId: t2.id } },
  })
  check("zero recorded so it cannot reopen later", zeroRow?.leaves === 0)

  // a DIFFERENT partner still pays
  const t3 = await mkCompletedTrade(a.id, c.id, ia3.id, ic1.id)
  const r3 = await awardTask(prisma, a.id, "VERIFIED_SWAP", t3.id, { partnerId: c.id, tradeId: t3.id })
  ua = await prisma.user.findUnique({ where: { id: a.id } })
  check("new partner still awards", r3.awarded === 20, JSON.stringify(r3))
  check("lifetimeLeaves now 40", ua!.lifetimeLeaves === 40)

  // ── 3. One-time tasks are one-time (the unique constraint) ────────────────
  console.log("\n[3] one-time tasks")
  for (const task of ["FIRST_LISTING", "VERIFY_ACCOUNT", "COMPLETE_PROFILE"] as const) {
    const first = await awardTask(prisma, c.id, task)
    const second = await awardTask(prisma, c.id, task)
    check(`${task} awards once then no-ops`,
      first.awarded === TASK_REWARDS[task] && second.awarded === 0 && second.reason === "already_awarded",
      `${JSON.stringify(first)} ${JSON.stringify(second)}`)
  }
  const dupe = await prisma.taskCompletion.count({ where: { userId: c.id, task: "FIRST_LISTING" } })
  check("exactly one FIRST_LISTING row exists", dupe === 1, `rows=${dupe}`)

  // ── 4. Weekly cap: awards zero, does NOT error ────────────────────────────
  console.log("\n[4] weekly cap")
  const DAY = 24 * 60 * 60 * 1000
  const d = await mkUser("dave")
  // Drive dave up to the cap with a synthetic TASK_REWARD ledger row.
  await prisma.leafTransaction.create({
    data: {
      userId: d.id, type: "TASK_REWARD", amount: WEEKLY_TASK_LEAF_CAP,
      description: "seed to cap", eventAt: new Date(),
    },
  })
  await prisma.user.update({
    where: { id: d.id },
    data: { leaves: WEEKLY_TASK_LEAF_CAP, lifetimeLeaves: WEEKLY_TASK_LEAF_CAP },
  })
  const capped = await awardTask(prisma, d.id, "FIRST_LISTING")
  const ud = await prisma.user.findUnique({ where: { id: d.id } })
  check("capped award returns zero without throwing",
    capped.awarded === 0 && capped.reason === "weekly_cap", JSON.stringify(capped))
  check("capped award leaves balances untouched",
    ud!.leaves === WEEKLY_TASK_LEAF_CAP && ud!.lifetimeLeaves === WEEKLY_TASK_LEAF_CAP)
  const capRow = await prisma.taskCompletion.findUnique({
    where: { userId_task_refId: { userId: d.id, task: "FIRST_LISTING", refId: "" } },
  })
  check("capped award records a 0-leaf row so the denial is permanent", capRow?.leaves === 0,
    JSON.stringify(capRow))

  // Waiting out the window must NOT release an award the cap already refused.
  await prisma.leafTransaction.updateMany({
    where: { userId: d.id },
    data: { eventAt: new Date(Date.now() - 8 * DAY) },
  })
  const retry = await awardTask(prisma, d.id, "FIRST_LISTING")
  const udAfter = await prisma.user.findUnique({ where: { id: d.id } })
  check("waiting out the window does not resurrect a capped award",
    retry.awarded === 0 && udAfter!.lifetimeLeaves === WEEKLY_TASK_LEAF_CAP, JSON.stringify(retry))

  // An event in an EARLIER, under-cap week is still paid — the cap is scoped to
  // the event's own week, not to whenever the award is processed.
  const e = await mkUser("erin")
  await prisma.leafTransaction.create({
    data: {
      userId: e.id, type: "TASK_REWARD", amount: WEEKLY_TASK_LEAF_CAP,
      description: "seed: this week is full", eventAt: new Date(),
    },
  })
  await prisma.user.update({
    where: { id: e.id },
    data: { leaves: WEEKLY_TASK_LEAF_CAP, lifetimeLeaves: WEEKLY_TASK_LEAF_CAP },
  })
  const backdated = await awardTask(prisma, e.id, "FIRST_LISTING", "", {
    eventAt: new Date(Date.now() - 60 * DAY),
  })
  check("an event from an earlier, under-cap week is still awarded",
    backdated.awarded === TASK_REWARDS.FIRST_LISTING, JSON.stringify(backdated))
  const backRow = await prisma.leafTransaction.findFirst({
    where: { userId: e.id, description: { contains: "FIRST_LISTING" } },
  })
  // The two timestamps must disagree here, and each must be right:
  // eventAt = 60 days ago (when it was earned), createdAt = now (when written).
  check("eventAt carries the historical event date",
    !!backRow && Date.now() - backRow.eventAt.getTime() > 50 * DAY,
    backRow ? backRow.eventAt.toISOString() : "no row")
  check("createdAt is the write time, not backdated",
    !!backRow && Date.now() - backRow.createdAt.getTime() < 60_000,
    backRow ? backRow.createdAt.toISOString() : "no row")
  check("the two timestamps are genuinely distinct on a backfilled row",
    !!backRow && backRow.createdAt.getTime() - backRow.eventAt.getTime() > 50 * DAY)

  // ── 5. reconcileTasks backfill still works and is idempotent ──────────────
  console.log("\n[5] reconcile backfill")
  const before = await prisma.user.findUnique({ where: { id: b.id } })
  const st = await reconcileTasks(b.id)
  const st2 = await reconcileTasks(b.id)
  const after = await prisma.user.findUnique({ where: { id: b.id } })
  check("reconcile returns a status", !!st && st.tasks.length === 5)
  check("reconcile is idempotent", st2!.lifetimeLeaves === st!.lifetimeLeaves,
    `${st!.lifetimeLeaves} vs ${st2!.lifetimeLeaves}`)
  check("reconcile keyed lifetimeLeaves >= before", after!.lifetimeLeaves >= before!.lifetimeLeaves)
  const bLedger = await prisma.leafTransaction.aggregate({
    where: { userId: b.id, type: "TASK_REWARD" }, _sum: { amount: true },
  })
  check("bob's ledger sum equals his lifetimeLeaves",
    (bLedger._sum.amount ?? 0) === after!.lifetimeLeaves,
    `ledger=${bLedger._sum.amount} lifetime=${after!.lifetimeLeaves}`)

  // ── 6. computeImpactData unchanged ────────────────────────────────────────
  console.log("\n[6] impact system untouched")
  const trades = [
    { senderId: "u1", offeredItem: { category: "ELECTRONICS" }, requestedItem: { category: "CLOTHING" } },
    { senderId: "u2", offeredItem: { category: "BOOKS" },       requestedItem: { category: "FURNITURE" } },
  ]
  const impact = computeImpactData("u1", trades)
  check("computeImpactData output matches the pre-change values",
    impact.co2Avoided === 35 && impact.waterSaved === 350 && impact.wasteDiverted === 5.5 &&
    impact.itemsRehomed === 2 && impact.co2Given === 35 && impact.co2Received === 6,
    JSON.stringify(impact))

  await cleanup()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
