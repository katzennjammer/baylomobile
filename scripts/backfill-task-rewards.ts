/**
 * Runs reconcileTasks() for every user and reports exactly what was re-awarded:
 * per user, the tasks detected, Leaves granted, and the LeafTransaction rows
 * written. Finishes with the ledger invariant check.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/backfill-task-rewards.ts
 *
 * Idempotent — the TaskCompletion unique constraint makes a second run a no-op.
 */
import prisma from "../src/lib/prisma"
import { reconcileTasks } from "../src/lib/tasks"

const TASK_LABEL: Record<string, string> = {
  VERIFY_ACCOUNT:   "VERIFY_ACCOUNT",
  COMPLETE_PROFILE: "COMPLETE_PROFILE",
  FIRST_LISTING:    "FIRST_LISTING",
  VERIFIED_SWAP:    "VERIFIED_SWAP",
  SAFEZONE_MEETUP:  "SAFEZONE_MEETUP",
}

async function main() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select:  { id: true, name: true, email: true, leaves: true, lifetimeLeaves: true },
  })
  console.log(`Reconciling ${users.length} users\n`)

  let grandTotal = 0

  for (const u of users) {
    const before = { leaves: u.leaves, lifetime: u.lifetimeLeaves }
    const txBefore = await prisma.leafTransaction.count({ where: { userId: u.id } })

    await reconcileTasks(u.id)

    const after = await prisma.user.findUnique({
      where: { id: u.id }, select: { leaves: true, lifetimeLeaves: true },
    })
    const completions = await prisma.taskCompletion.findMany({
      where: { userId: u.id }, orderBy: { createdAt: "asc" },
      select: { task: true, refId: true, leaves: true },
    })
    const rows = await prisma.leafTransaction.findMany({
      where: { userId: u.id, type: "TASK_REWARD" },
      orderBy: { createdAt: "asc" },
      select: { id: true, amount: true, description: true, tradeId: true },
    })
    const granted = after!.lifetimeLeaves - before.lifetime
    grandTotal += granted

    console.log(`── ${u.name}  <${u.email}>`)
    console.log(`   ${u.id}`)
    if (completions.length === 0) {
      console.log(`   no tasks detected`)
    } else {
      const paid = completions.filter((c) => c.leaves > 0)
      const zero = completions.filter((c) => c.leaves === 0)
      for (const c of paid) {
        console.log(`   detected  ${TASK_LABEL[c.task].padEnd(17)} +${c.leaves} Leaves` +
          (c.refId ? `   trade ${c.refId}` : ""))
      }
      for (const c of zero) {
        console.log(`   detected  ${TASK_LABEL[c.task].padEnd(17)}  0 Leaves  (repeat partner, no award)` +
          (c.refId ? `   trade ${c.refId}` : ""))
      }
    }
    console.log(`   granted this run: ${granted} Leaves`)
    console.log(`   leaves ${before.leaves} -> ${after!.leaves}   lifetimeLeaves ${before.lifetime} -> ${after!.lifetimeLeaves}`)
    console.log(`   LeafTransaction rows: ${txBefore} -> ${txBefore + rows.length - (txBefore ? 0 : 0)} (TASK_REWARD: ${rows.length})`)
    for (const r of rows) {
      console.log(`     +${String(r.amount).padStart(3)}  ${r.description}${r.tradeId ? `  [trade ${r.tradeId}]` : ""}`)
    }
    console.log()
  }

  // ── Ledger invariant ──────────────────────────────────────────────────────
  const [balances, positives, allTx] = await Promise.all([
    prisma.user.aggregate({ _sum: { leaves: true, lifetimeLeaves: true } }),
    prisma.leafTransaction.aggregate({ where: { amount: { gt: 0 } }, _sum: { amount: true } }),
    prisma.leafTransaction.aggregate({ _sum: { amount: true } }),
  ])
  const sumLeaves    = balances._sum.leaves ?? 0
  const sumLifetime  = balances._sum.lifetimeLeaves ?? 0
  const sumPositive  = positives._sum.amount ?? 0
  const sumAll       = allTx._sum.amount ?? 0

  console.log("═══ ledger invariant ═══")
  console.log(`  total Leaves granted this run : ${grandTotal}`)
  console.log(`  SUM(User.leaves)              : ${sumLeaves}`)
  console.log(`  SUM(User.lifetimeLeaves)      : ${sumLifetime}`)
  console.log(`  SUM(positive LeafTransaction) : ${sumPositive}`)
  console.log(`  SUM(all LeafTransaction)      : ${sumAll}`)
  const ok = sumLeaves === sumPositive && sumLifetime === sumPositive && sumAll === sumPositive
  console.log(ok
    ? "  OK — every Leaf traceable to a ledger entry"
    : "  MISMATCH — balances are not reconstructable from the ledger")

  await prisma.$disconnect()
  process.exit(ok ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
