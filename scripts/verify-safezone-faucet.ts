// Acceptance harness for the SAFEZONE_MEETUP repeat-partner fix (28 Aug 2026).
//
// RUNS AGAINST A SCRATCH DB. Point DATABASE_URL at one first — it creates and
// deletes rows, and the prefix-scoped cleanup is a safety net, not a licence:
//
//   mysql -u root -e "CREATE DATABASE baylo_faucetcheck"
//   DATABASE_URL="mysql://root@127.0.0.1:3306/baylo_faucetcheck" npx prisma db push
//   DATABASE_URL="mysql://root@127.0.0.1:3306/baylo_faucetcheck" npx tsx scripts/verify-safezone-faucet.ts
//
// What it pins down, in order:
//   1  a FIRST trade between two accounts pays SAFEZONE_MEETUP to both
//   2  a SECOND trade between the SAME pair, inside the window, pays nothing
//      — and writes the zero-leaf completion row that makes the denial final
//   3  a trade with a DIFFERENT partner still pays
//   4  the same rule holds for VERIFIED_SWAP (it always did — this is the
//      regression guard that says the fix did not change it)
//   5  awardTask() FAILS CLOSED when partnerId is missing, and writes NO row,
//      so a later reconcile can still pay it once the call site is fixed
//   6  reconcileTasks() applies the identical rule — a backfill must not be a
//      way to collect an award the live path refused
//   7  resolveMeetupHub() accepts only a hub BOTH listings already named --
//      the pre-commitment rule, which is NOT verification (see that function)
//   8  a hub deactivated after the fact does not retroactively void a claim
//   9  SUM(User.leaves) == SUM(LeafTransaction.amount) throughout

import prisma from "../src/lib/prisma"
import { awardTask, reconcileTasks } from "../src/lib/tasks"
import { TASK_REWARDS, NEW_PARTNER_WINDOW_DAYS } from "../src/lib/task-constants"
import { resolveMeetupHub } from "../src/lib/safe-zones"

const P = "ZZFAUCET_"
let pass = 0
let fail = 0

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}   ${detail}`)
  }
}
function head(s: string) {
  console.log(`\n── ${s} ${"─".repeat(Math.max(0, 66 - s.length))}`)
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: P } },
    select: { id: true },
  })
  const ids = users.map((u) => u.id)
  if (!ids.length) return
  await prisma.taskCompletion.deleteMany({ where: { userId: { in: ids } } })
  await prisma.leafTransaction.deleteMany({ where: { userId: { in: ids } } })
  // Order matters: both FKs onto SafeZoneHub are RESTRICT, so the trades and
  // the associations have to go before the hubs can.
  await prisma.tradeRequest.deleteMany({
    where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] },
  })
  await prisma.itemSafeZone.deleteMany({ where: { item: { userId: { in: ids } } } })
  await prisma.item.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await prisma.safeZoneHub.deleteMany({ where: { id: { startsWith: P } } })
}

const mkUser = (tag: string) =>
  prisma.user.create({
    data: { name: P + tag, email: `${P}${tag}@test.local`, password: "x" },
  })

const mkItem = (userId: string, tag: string) =>
  prisma.item.create({
    data: {
      title: P + tag,
      description: "x",
      images: "[]",
      category: "OTHER",
      condition: "GOOD",
      userId,
    },
  })

const mkHub = (tag: string) =>
  prisma.safeZoneHub.create({
    data: {
      id: `${P}${tag}`,
      name: P + tag,
      type: "MALL",
      address: "somewhere",
      latitude: 10.3,
      longitude: 123.9,
      city: "Testville",
      landmark: "by the door",
    },
  })

/**
 * A COMPLETED trade whose two items are BOTH offered at `hub`, with the meetup
 * claimed there — the shape the pre-commitment rule accepts.
 */
async function mkTrade(
  aId: string,
  bId: string,
  tag: string,
  at: Date,
  hubId: string | null,
) {
  const [ia, ib] = await Promise.all([mkItem(aId, `${tag}a`), mkItem(bId, `${tag}b`)])
  if (hubId) {
    await prisma.itemSafeZone.createMany({
      data: [
        { itemId: ia.id, hubId },
        { itemId: ib.id, hubId },
      ],
    })
  }
  return prisma.tradeRequest.create({
    data: {
      senderId: aId,
      receiverId: bId,
      offeredItemId: ia.id,
      requestedItemId: ib.id,
      status: "COMPLETED",
      safeZoneHubId: hubId,
      updatedAt: at,
    },
  })
}

async function invariant(where: string) {
  const u = await prisma.user.aggregate({ _sum: { leaves: true } })
  const l = await prisma.leafTransaction.aggregate({ _sum: { amount: true } })
  check(
    `ledger invariant holds ${where}`,
    (u._sum.leaves ?? 0) === (l._sum.amount ?? 0),
    `users=${u._sum.leaves} ledger=${l._sum.amount}`,
  )
}

const DAY = 24 * 60 * 60 * 1000

async function main() {
  if (!/faucetcheck|scratch|test/i.test(process.env.DATABASE_URL ?? "")) {
    console.error(
      "\n  REFUSING TO RUN: DATABASE_URL does not look like a scratch database.\n" +
        "  This harness creates and deletes rows. See the header.\n",
    )
    process.exit(1)
  }

  await cleanup()

  const [alice, bob, carol] = await Promise.all([
    mkUser("alice"),
    mkUser("bob"),
    mkUser("carol"),
  ])
  const hub = await mkHub("hub1")
  const otherHub = await mkHub("hub2")

  // ── 1 ── first trade between alice and bob
  head("1  first trade with a new partner pays SAFEZONE_MEETUP")
  const t1At = new Date(Date.now() - 10 * DAY)
  const t1 = await mkTrade(alice.id, bob.id, "t1", t1At, hub.id)

  const a1 = await prisma.$transaction((tx) =>
    awardTask(tx, alice.id, "SAFEZONE_MEETUP", t1.id, {
      partnerId: bob.id,
      tradeId: t1.id,
      tradeAt: t1At,
      eventAt: t1At,
    }),
  )
  check(
    `alice awarded ${TASK_REWARDS.SAFEZONE_MEETUP} Leaves`,
    a1.awarded === TASK_REWARDS.SAFEZONE_MEETUP && a1.reason === "awarded",
    JSON.stringify(a1),
  )

  // ── 2 ── second trade, SAME pair, inside the window
  head(`2  second trade with the same partner inside ${NEW_PARTNER_WINDOW_DAYS}d pays nothing`)
  const t2At = new Date(Date.now() - 2 * DAY)
  const t2 = await mkTrade(alice.id, bob.id, "t2", t2At, hub.id)

  const a2 = await prisma.$transaction((tx) =>
    awardTask(tx, alice.id, "SAFEZONE_MEETUP", t2.id, {
      partnerId: bob.id,
      tradeId: t2.id,
      tradeAt: t2At,
      eventAt: t2At,
    }),
  )
  check(
    "repeat partner awarded 0",
    a2.awarded === 0 && a2.reason === "repeat_partner",
    JSON.stringify(a2),
  )

  const denialRow = await prisma.taskCompletion.findUnique({
    where: {
      userId_task_refId: { userId: alice.id, task: "SAFEZONE_MEETUP", refId: t2.id },
    },
  })
  check(
    "a zero-leaf completion row makes the denial permanent",
    denialRow !== null && denialRow.leaves === 0,
    JSON.stringify(denialRow),
  )

  // ── 3 ── different partner still pays
  head("3  a different partner still pays")
  const t3At = new Date(Date.now() - 1 * DAY)
  const t3 = await mkTrade(alice.id, carol.id, "t3", t3At, hub.id)
  const a3 = await prisma.$transaction((tx) =>
    awardTask(tx, alice.id, "SAFEZONE_MEETUP", t3.id, {
      partnerId: carol.id,
      tradeId: t3.id,
      tradeAt: t3At,
      eventAt: t3At,
    }),
  )
  check(
    `new partner awarded ${TASK_REWARDS.SAFEZONE_MEETUP}`,
    a3.awarded === TASK_REWARDS.SAFEZONE_MEETUP,
    JSON.stringify(a3),
  )

  // ── 4 ── VERIFIED_SWAP unchanged (regression guard)
  head("4  VERIFIED_SWAP still behaves exactly as before")
  const v1 = await prisma.$transaction((tx) =>
    awardTask(tx, bob.id, "VERIFIED_SWAP", t1.id, {
      partnerId: alice.id,
      tradeId: t1.id,
      tradeAt: t1At,
      eventAt: t1At,
    }),
  )
  const v2 = await prisma.$transaction((tx) =>
    awardTask(tx, bob.id, "VERIFIED_SWAP", t2.id, {
      partnerId: alice.id,
      tradeId: t2.id,
      tradeAt: t2At,
      eventAt: t2At,
    }),
  )
  check("VERIFIED_SWAP pays on a new partner", v1.awarded === TASK_REWARDS.VERIFIED_SWAP, JSON.stringify(v1))
  check("VERIFIED_SWAP refuses a repeat partner", v2.awarded === 0 && v2.reason === "repeat_partner", JSON.stringify(v2))

  // ── 5 ── fail closed with no partnerId
  head("5  a partner-gated task with no partnerId fails CLOSED and writes no row")
  const t4At = new Date()
  const t4 = await mkTrade(carol.id, bob.id, "t4", t4At, hub.id)
  const a4 = await prisma.$transaction((tx) =>
    awardTask(tx, carol.id, "SAFEZONE_MEETUP", t4.id, { tradeId: t4.id, eventAt: t4At }),
  )
  check("awarded 0 with reason missing_partner", a4.awarded === 0 && a4.reason === "missing_partner", JSON.stringify(a4))

  const noRow = await prisma.taskCompletion.findUnique({
    where: {
      userId_task_refId: { userId: carol.id, task: "SAFEZONE_MEETUP", refId: t4.id },
    },
  })
  check(
    "NO completion row written — a caller defect must stay repairable",
    noRow === null,
    JSON.stringify(noRow),
  )

  // ── 6 ── reconcile applies the same rule
  head("6  reconcileTasks() applies the identical rule")
  // carol's t4 award was refused above only because the CALLER forgot the
  // partner. The backfill knows the partner, so it should now pay it — and it
  // is carol's first trade with bob, so the window permits it.
  await reconcileTasks(carol.id)
  const carolT4 = await prisma.taskCompletion.findUnique({
    where: {
      userId_task_refId: { userId: carol.id, task: "SAFEZONE_MEETUP", refId: t4.id },
    },
  })
  check(
    "backfill pays the award the defective call site missed",
    carolT4 !== null && carolT4.leaves === TASK_REWARDS.SAFEZONE_MEETUP,
    JSON.stringify(carolT4),
  )

  // And it must NOT pay alice for t2, which the rule already refused.
  await reconcileTasks(alice.id)
  const aliceT2 = await prisma.taskCompletion.findUnique({
    where: {
      userId_task_refId: { userId: alice.id, task: "SAFEZONE_MEETUP", refId: t2.id },
    },
  })
  check(
    "backfill does NOT resurrect a denial the live path made",
    aliceT2 !== null && aliceT2.leaves === 0,
    JSON.stringify(aliceT2),
  )

  // ── 7 ── the pre-commitment rule
  head("7  resolveMeetupHub() requires BOTH listings to have named the hub")

  const okClaim = await resolveMeetupHub(prisma, hub.id, t1.offeredItemId, t1.requestedItemId)
  check("accepts a hub both listings were offered at", okClaim.ok, JSON.stringify(okClaim))

  const wrongHub = await resolveMeetupHub(prisma, otherHub.id, t1.offeredItemId, t1.requestedItemId)
  check(
    "refuses a hub NEITHER listing named",
    !wrongHub.ok,
    JSON.stringify(wrongHub),
  )

  // One-sided: only the offered item names the hub. This is the case the
  // "both, not either" rule exists for — a single seller cannot unilaterally
  // manufacture the pre-commitment.
  const [solo] = await Promise.all([mkItem(alice.id, "solo")])
  const soloPartner = await mkItem(bob.id, "solopartner")
  await prisma.itemSafeZone.create({ data: { itemId: solo.id, hubId: otherHub.id } })
  const oneSided = await resolveMeetupHub(prisma, otherHub.id, solo.id, soloPartner.id)
  check(
    "refuses a hub only ONE listing named",
    !oneSided.ok,
    JSON.stringify(oneSided),
  )

  // ── 8 ── deactivation does not retroactively void a claim
  head("8  a hub deactivated after the fact still satisfies the claim")
  await prisma.safeZoneHub.update({ where: { id: hub.id }, data: { isActive: false } })
  const afterDeactivation = await resolveMeetupHub(
    prisma, hub.id, t1.offeredItemId, t1.requestedItemId,
  )
  check(
    "pre-commitment survives deactivation",
    afterDeactivation.ok,
    JSON.stringify(afterDeactivation),
  )
  await prisma.safeZoneHub.update({ where: { id: hub.id }, data: { isActive: true } })

  // ── 9 ── invariant
  head("9  ledger")
  await invariant("at end")

  console.log(`\n${"═".repeat(72)}`)
  console.log(`  ${pass} passed, ${fail} failed`)
  console.log(`${"═".repeat(72)}\n`)

  await cleanup()
  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await cleanup().catch(() => {})
  await prisma.$disconnect()
  process.exit(1)
})
