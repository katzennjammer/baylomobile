// Proves a duplicate/capped award inside the settlement transaction cannot
// roll back the trade itself. Run against a scratch DB.
import prisma from "../src/lib/prisma"
import { awardTask } from "../src/lib/tasks"

const P = "ZZTX_"
let pass = 0, fail = 0
const check = (n: string, c: boolean, d = "") => {
  if (c) { pass++; console.log(`  PASS  ${n}`) } else { fail++; console.log(`  FAIL  ${n} ${d}`) }
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

async function main() {
  await cleanup()

  const a = await prisma.user.create({ data: { name: P + "a", email: P + "a@t.local", password: "x" } })
  const b = await prisma.user.create({ data: { name: P + "b", email: P + "b@t.local", password: "x" } })
  const mk = (uid: string, t: string) => prisma.item.create({
    data: { title: P + t, description: "d", images: "[]", category: "BOOKS", condition: "GOOD", userId: uid },
  })
  const i1 = await mk(a.id, "1"), i2 = await mk(b.id, "2")
  const trade = await prisma.tradeRequest.create({
    data: { senderId: a.id, receiverId: b.id, offeredItemId: i1.id, requestedItemId: i2.id, status: "CONFIRMING" },
  })

  // Pre-award A so the in-transaction award hits the duplicate path.
  await awardTask(prisma, a.id, "VERIFIED_SWAP", trade.id, { partnerId: b.id, tradeId: trade.id })
  const preA = await prisma.user.findUnique({ where: { id: a.id } })
  check("A pre-awarded outside the tx", preA!.lifetimeLeaves === 20)

  // Now run the settlement shape: trade + item updates, then awards for both.
  await prisma.$transaction(async (tx) => {
    await tx.tradeRequest.update({ where: { id: trade.id }, data: { status: "COMPLETED" } })
    await tx.item.update({ where: { id: i1.id }, data: { userId: b.id, status: "OWNED" } })
    await tx.item.update({ where: { id: i2.id }, data: { userId: a.id, status: "OWNED" } })
    await tx.user.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { totalTrades: { increment: 1 } } })

    for (const [uid, pid] of [[a.id, b.id], [b.id, a.id]] as const) {
      await awardTask(tx, uid, "VERIFIED_SWAP", trade.id, { partnerId: pid, tradeId: trade.id })
    }
  })

  const t = await prisma.tradeRequest.findUnique({ where: { id: trade.id } })
  const ua = await prisma.user.findUnique({ where: { id: a.id } })
  const ub = await prisma.user.findUnique({ where: { id: b.id } })
  const it1 = await prisma.item.findUnique({ where: { id: i1.id } })

  check("trade COMPLETED despite the duplicate award", t!.status === "COMPLETED", t!.status)
  check("items transferred", it1!.userId === b.id && it1!.status === "OWNED")
  check("totalTrades incremented", ua!.totalTrades === 1 && ub!.totalTrades === 1)
  check("A not double-awarded", ua!.lifetimeLeaves === 20, `lifetime=${ua!.lifetimeLeaves}`)
  check("B awarded once", ub!.lifetimeLeaves === 20 && ub!.leaves === 20, `lifetime=${ub!.lifetimeLeaves}`)

  const rows = await prisma.taskCompletion.count({ where: { task: "VERIFIED_SWAP", refId: trade.id } })
  check("exactly 2 completion rows (one per user)", rows === 2, `rows=${rows}`)

  const ledger = await prisma.leafTransaction.findMany({
    where: { tradeId: trade.id, type: "TASK_REWARD" },
  })
  check("exactly 2 TASK_REWARD ledger rows", ledger.length === 2, `rows=${ledger.length}`)
  check("ledger sums equal both users' balances",
    ledger.filter((r) => r.userId === a.id).reduce((s, r) => s + r.amount, 0) === 20 &&
    ledger.filter((r) => r.userId === b.id).reduce((s, r) => s + r.amount, 0) === 20)

  await cleanup()
  console.log(`\n${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
