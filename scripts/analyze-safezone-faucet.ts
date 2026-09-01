// READ-ONLY. Answers one question: how many already-paid task awards would the
// corrected repeat-partner rule have suppressed?
//
// Run (from baylo/):
//   npx tsx --env-file=.env scripts/analyze-safezone-faucet.ts
//
// WHY THIS EXISTS. Until this change, faucet guard 1 in awardTask() read
//
//   if (task === "VERIFIED_SWAP" && opts.partnerId)
//
// so SAFEZONE_MEETUP — the other repeatable task — was never checked against
// the 30-day new-partner window, and the settlement site did not even pass a
// partnerId for it. A pair of accounts bouncing the same two items back and
// forth therefore collected 10 Leaves each per trade, bounded only by the
// weekly cap, while VERIFIED_SWAP correctly paid them once a month.
//
// The fix closes that going forward. NOTHING IS CLAWED BACK — this script does
// not write, and there is no repair mode hiding in it. Its whole job is to say
// how much of the existing ledger was produced by the gap, so the number that
// gets quoted is a measured one rather than an assumed one.
//
// THE RULE IS RE-EVALUATED, NOT RE-DERIVED. Every row is judged by the same
// isNewTradePartner() the live path now calls, anchored to the same tradeAt the
// award used (the trade's updatedAt), with the trade itself excluded. If this
// script and production ever disagree, it is because somebody changed that
// function — which is the point of importing it rather than restating it here.

import prisma from "../src/lib/prisma"
import { isNewTradePartner } from "../src/lib/tasks"
import { NEW_PARTNER_WINDOW_DAYS, TASK_REWARDS } from "../src/lib/task-constants"

interface Row {
  task: string
  refId: string
  userId: string
  leaves: number
  tradeAt: Date
  partnerId: string
}

async function main() {
  // ── Context ────────────────────────────────────────────────────────────────
  const totalCompletions = await prisma.taskCompletion.count()
  const byTask = await prisma.taskCompletion.groupBy({
    by: ["task"],
    _count: { id: true },
    _sum: { leaves: true },
  })

  console.log(`\n${"═".repeat(72)}`)
  console.log(`  TaskCompletion rows: ${totalCompletions}`)
  console.log(`${"═".repeat(72)}`)
  for (const t of byTask.sort((a, b) => a.task.localeCompare(b.task))) {
    console.log(
      `  ${t.task.padEnd(18)} ${String(t._count.id).padStart(5)} rows` +
        `   ${String(t._sum.leaves ?? 0).padStart(6)} Leaves`,
    )
  }

  // ── The population under test ──────────────────────────────────────────────
  //
  // Only the two REPEATABLE tasks can be affected: the one-time tasks carry
  // refId "" and are already made one-time by the unique constraint. Zero-leaf
  // rows are included in the scan but reported separately -- a row the cap
  // already refused was not a payout, and counting it as one would overstate
  // the damage.
  const completions = await prisma.taskCompletion.findMany({
    where: { task: { in: ["SAFEZONE_MEETUP", "VERIFIED_SWAP"] } },
    select: { task: true, refId: true, userId: true, leaves: true },
  })

  const tradeIds = [...new Set(completions.map((c) => c.refId).filter(Boolean))]
  const trades = await prisma.tradeRequest.findMany({
    where: { id: { in: tradeIds } },
    select: { id: true, senderId: true, receiverId: true, updatedAt: true },
  })
  const tradeById = new Map(trades.map((t) => [t.id, t]))

  const rows: Row[] = []
  let orphaned = 0
  for (const c of completions) {
    const t = c.refId ? tradeById.get(c.refId) : undefined
    if (!t) {
      // A completion whose trade no longer exists. Counted and skipped rather
      // than guessed at -- there is no partner to test against.
      orphaned++
      continue
    }
    rows.push({
      task: c.task,
      refId: c.refId,
      userId: c.userId,
      leaves: c.leaves,
      tradeAt: t.updatedAt,
      partnerId: t.senderId === c.userId ? t.receiverId : t.senderId,
    })
  }

  // ── Re-evaluation ──────────────────────────────────────────────────────────
  const suppressed: Record<string, { rows: number; leaves: number }> = {}
  const kept: Record<string, { rows: number; leaves: number }> = {}
  const offenders = new Map<string, { rows: number; leaves: number }>()

  for (const r of rows) {
    const fresh = await isNewTradePartner(
      prisma,
      r.userId,
      r.partnerId,
      r.refId,
      r.tradeAt,
    )
    const bucket = fresh ? kept : suppressed
    bucket[r.task] ??= { rows: 0, leaves: 0 }
    bucket[r.task].rows++
    bucket[r.task].leaves += r.leaves

    if (!fresh && r.leaves > 0) {
      const cur = offenders.get(r.userId) ?? { rows: 0, leaves: 0 }
      cur.rows++
      cur.leaves += r.leaves
      offenders.set(r.userId, cur)
    }
  }

  console.log(`\n${"═".repeat(72)}`)
  console.log(`  Re-evaluated against the ${NEW_PARTNER_WINDOW_DAYS}-day new-partner window`)
  console.log(`${"═".repeat(72)}`)
  if (orphaned > 0) console.log(`  (${orphaned} completion rows skipped: trade no longer exists)\n`)

  for (const task of ["SAFEZONE_MEETUP", "VERIFIED_SWAP"]) {
    const s = suppressed[task] ?? { rows: 0, leaves: 0 }
    const k = kept[task] ?? { rows: 0, leaves: 0 }
    const total = s.rows + k.rows
    console.log(`  ${task}   (${TASK_REWARDS[task as "VERIFIED_SWAP"]} Leaves each)`)
    console.log(`    rows examined      ${String(total).padStart(5)}`)
    console.log(`    would be SUPPRESSED${String(s.rows).padStart(5)}   (${s.leaves} Leaves already paid)`)
    console.log(`    would still award  ${String(k.rows).padStart(5)}   (${k.leaves} Leaves)`)
    console.log("")
  }

  const totalSuppressedLeaves = Object.values(suppressed).reduce((a, b) => a + b.leaves, 0)
  const totalSuppressedRows = Object.values(suppressed).reduce((a, b) => a + b.rows, 0)

  if (offenders.size > 0) {
    console.log(`  Accounts holding suppressed-rule Leaves (${offenders.size}):`)
    const named = await prisma.user.findMany({
      where: { id: { in: [...offenders.keys()] } },
      select: { id: true, name: true, email: true, lifetimeLeaves: true },
    })
    const byId = new Map(named.map((u) => [u.id, u]))
    for (const [uid, v] of [...offenders].sort((a, b) => b[1].leaves - a[1].leaves)) {
      const u = byId.get(uid)
      console.log(
        `    ${(u?.name ?? uid).padEnd(22)} ${String(v.leaves).padStart(4)} Leaves ` +
          `over ${v.rows} award(s)   (lifetime ${u?.lifetimeLeaves ?? "?"})`,
      )
    }
    console.log("")
  }

  console.log(`${"═".repeat(72)}`)
  console.log(`  TOTAL that the corrected rule would have suppressed:`)
  console.log(`    ${totalSuppressedRows} award rows, ${totalSuppressedLeaves} Leaves`)
  console.log(`  NOT clawed back. This is a measurement, not a repair.`)
  console.log(`${"═".repeat(72)}\n`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
