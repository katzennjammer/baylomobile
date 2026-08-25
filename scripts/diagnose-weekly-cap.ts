/**
 * Diagnostic: is WEEKLY_TASK_LEAF_CAP evaluated against wall-clock now, or
 * against the awarding event's own timestamp?
 *
 * Two users, same total eligibility (15 swaps x 20 = 300 Leaves), differing
 * only in WHEN the trades happened:
 *
 *   SPREAD  — 15 trades, one per month across a year. In their original weeks
 *             each week held 20 Leaves, far under the 100 cap. A correct cap
 *             should pay all 300.
 *   BURST   — 15 trades all inside a single week. That week is 300 Leaves
 *             against a 100 cap. A correct cap should pay 100 and permanently
 *             deny the other 200.
 *
 * If both users come out the same, the cap is not reading the event's week.
 *
 * Run against a SCRATCH db only.
 */
import prisma from "../src/lib/prisma"
import { reconcileTasks } from "../src/lib/tasks"
import { WEEKLY_TASK_LEAF_CAP } from "../src/lib/task-constants"

const P = "ZZCAP_"
const DAY = 24 * 60 * 60 * 1000

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
  return prisma.user.create({ data: { name: P + tag, email: `${P}${tag}@t.local`, password: "x" } })
}
async function mkItem(userId: string, tag: string) {
  return prisma.item.create({
    data: { title: P + tag, description: "d", images: "[]", category: "BOOKS", condition: "GOOD", userId },
  })
}

/** Builds N completed trades for `owner`, each with a distinct partner, at the given ages in days. */
async function buildHistory(owner: { id: string }, tag: string, agesInDays: number[]) {
  for (let i = 0; i < agesInDays.length; i++) {
    const partner = await mkUser(`${tag}p${i}`)
    const i1 = await mkItem(owner.id, `${tag}o${i}`)
    const i2 = await mkItem(partner.id, `${tag}p${i}i`)
    const at = new Date(Date.now() - agesInDays[i] * DAY)
    const t = await prisma.tradeRequest.create({
      data: {
        senderId: owner.id, receiverId: partner.id,
        offeredItemId: i1.id, requestedItemId: i2.id, status: "COMPLETED",
      },
    })
    // createdAt/updatedAt are managed by Prisma, so backdate them directly.
    await prisma.$executeRaw`UPDATE TradeRequest SET createdAt = ${at}, updatedAt = ${at} WHERE id = ${t.id}`
  }
}

async function report(userId: string, label: string) {
  const u = await prisma.user.findUnique({ where: { id: userId } })
  const paid = await prisma.taskCompletion.count({ where: { userId, leaves: { gt: 0 } } })
  const zero = await prisma.taskCompletion.count({ where: { userId, leaves: 0 } })
  const total = await prisma.taskCompletion.count({ where: { userId } })
  const rows = await prisma.leafTransaction.findMany({
    where: { userId, type: "TASK_REWARD" }, orderBy: { eventAt: "asc" },
    select: { amount: true, eventAt: true },
  })
  const stamps = new Set(rows.map((r) => r.eventAt.toISOString().slice(0, 10)))
  console.log(`  ${label}`)
  console.log(`    lifetimeLeaves        : ${u!.lifetimeLeaves}   (eligibility was 300 + 15 first-listing)`)
  console.log(`    completion rows       : ${total}  (paid ${paid}, zero-award ${zero})`)
  console.log(`    ledger rows           : ${rows.length}`)
  console.log(`    distinct event dates  : ${stamps.size}  -> ${[...stamps].sort().join(", ")}`)
  return u!.lifetimeLeaves
}

async function main() {
  await cleanup()
  console.log(`WEEKLY_TASK_LEAF_CAP = ${WEEKLY_TASK_LEAF_CAP}\n`)

  const spread = await mkUser("spread")
  const burst  = await mkUser("burst")

  // one trade per month for 15 months
  await buildHistory(spread, "s", Array.from({ length: 15 }, (_, i) => 30 * (i + 1)))
  // 15 trades inside one week, ~200 days ago
  await buildHistory(burst, "b", Array.from({ length: 15 }, (_, i) => 200 + (i % 7)))

  console.log("── first reconcile pass ──")
  await reconcileTasks(spread.id)
  await reconcileTasks(burst.id)
  const s1 = await report(spread.id, "SPREAD (1 trade/month over 15 months)")
  const b1 = await report(burst.id,  "BURST  (15 trades inside ONE week)")

  console.log("\n── verdict on anchoring ──")
  console.log(s1 === b1
    ? `  Both users received the SAME total (${s1}). The cap is NOT reading the\n` +
      "  event's week -- it collapses all history into one wall-clock bucket."
    : `  SPREAD ${s1} vs BURST ${b1} -- the cap distinguishes the event's week.`)

  // Does waiting reopen it? Backdate this run's ledger rows past the window.
  console.log("\n── does waiting out the window release the denied awards? ──")
  const before = (await prisma.user.findUnique({ where: { id: burst.id } }))!.lifetimeLeaves
  await prisma.$executeRaw`
    UPDATE LeafTransaction SET eventAt = DATE_SUB(NOW(), INTERVAL 8 DAY) WHERE userId = ${burst.id}`
  await reconcileTasks(burst.id)
  const after = (await prisma.user.findUnique({ where: { id: burst.id } }))!.lifetimeLeaves
  console.log(`  BURST lifetimeLeaves ${before} -> ${after} after simulating 8 days passing`)
  console.log(after > before
    ? "  LEAK: awards denied by the cap are only DEFERRED. Waiting a week collects them,\n" +
      "  so the cap throttles the faucet but never closes it."
    : "  Denied awards stayed denied.")

  await cleanup()
  await prisma.$disconnect()
  process.exit(0)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
