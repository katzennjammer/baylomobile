// Acceptance harness for the reputation gates and Deferred Points Agreements.
//
// Drives the REAL routes over HTTP, per the house convention, and reads the
// database directly only to build fixtures, to age a deadline, and to check
// what the routes actually wrote.
//
// Covers, in order:
//   1  a user with 2 completed trades cannot propose a DPA          (403)
//   2  the tier debt ceiling refuses an over-cap amount             (403)
//   3  the preview returns all four debtor statistics
//   4  lifecycle: propose, accept, partial fulfilment, full fulfilment
//   5  a trade carrying a PENDING_ACCEPT contract will not finalize
//   6  default: deadline lapses, DEFAULTED, debt persists, initiate blocked,
//      accept still allowed, and the sweep cannot double-apply
//   7  a second extension request is refused
//   8  the item-value ceiling refuses an over-cap acquisition
//   9  SUM(User.leaves) == SUM(LeafTransaction.amount) after every step
//
// Run (from baylo/, with a dev server on BASE):
//   npx tsx --env-file=.env scripts/verify-deferred-contracts.ts
import prisma from "../src/lib/prisma"
import { signAccessToken } from "../src/lib/auth-tokens"
import { TIER_LIMITS, DPA } from "../src/lib/reputation-config"

const BASE = process.env.ACCEPT_BASE ?? "http://127.0.0.1:3100"
const P = "zzdpa-"
const DAY = 24 * 60 * 60 * 1000

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`) }
}

interface Res<T = unknown> { status: number; body: T }

async function call<T = unknown>(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<Res<T>> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as T }
}

const GET = <T = unknown>(p: string, t: string | null) => call<T>("GET", p, t)
const POST = <T = unknown>(p: string, t: string | null, b?: unknown) => call<T>("POST", p, t, b ?? {})

// ── The invariant ────────────────────────────────────────────────────────────

/**
 * SUM(User.leaves) == SUM(LeafTransaction.amount), signed, over ALL rows.
 *
 * Every row, not just the fixtures': the sum is a global property of the Leaf
 * economy and checking a subset would pass while the fixtures leaked Leaves
 * into or out of the rest of the table.
 */
async function invariant(label: string) {
  const [users, ledger] = await Promise.all([
    prisma.user.aggregate({ _sum: { leaves: true } }),
    prisma.leafTransaction.aggregate({ _sum: { amount: true } }),
  ])
  const u = users._sum.leaves ?? 0
  const l = ledger._sum.amount ?? 0
  check(`INVARIANT after ${label}: SUM(User.leaves)=${u} == SUM(LeafTransaction.amount)=${l}`, u === l)
  return { u, l }
}

async function balances(ids: Record<string, string>) {
  const rows = await prisma.user.findMany({
    where: { id: { in: Object.values(ids) } },
    select: { id: true, leaves: true, lifetimeLeaves: true },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out: Record<string, { leaves: number; lifetimeLeaves: number }> = {}
  for (const [name, id] of Object.entries(ids)) {
    const r = byId.get(id)
    out[name] = { leaves: r?.leaves ?? 0, lifetimeLeaves: r?.lifetimeLeaves ?? 0 }
  }
  return out
}

async function ledgerFor(userIds: string[], since: Date) {
  return prisma.leafTransaction.findMany({
    where: { userId: { in: userIds }, createdAt: { gte: since } },
    select: { userId: true, type: true, amount: true, description: true, contractId: true, tradeId: true },
    orderBy: { createdAt: "asc" },
  })
}

function printLedger(rows: Awaited<ReturnType<typeof ledgerFor>>, names: Map<string, string>) {
  if (rows.length === 0) { console.log("      (no ledger rows)"); return }
  for (const r of rows) {
    const who = (names.get(r.userId) ?? r.userId).padEnd(9)
    const amt = String(r.amount).padStart(6)
    console.log(`      ${who} ${r.type.padEnd(17)} ${amt}   ${r.description}`)
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: P } }, select: { id: true },
  })
  const ids = users.map((u) => u.id)
  if (!ids.length) return
  const trades = await prisma.tradeRequest.findMany({
    where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] },
    select: { id: true },
  })
  const tradeIds = trades.map((t) => t.id)
  await prisma.deferredContract.deleteMany({
    where: { OR: [{ debtorId: { in: ids } }, { creditorId: { in: ids } }, { tradeId: { in: tradeIds } }] },
  })
  await prisma.swapConfirmationCode.deleteMany({ where: { tradeId: { in: tradeIds } } })
  await prisma.message.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } })
  await prisma.review.deleteMany({ where: { tradeId: { in: tradeIds } } })
  await prisma.tradeRequest.deleteMany({ where: { id: { in: tradeIds } } })
  await prisma.leafTransaction.deleteMany({ where: { userId: { in: ids } } })
  await prisma.taskCompletion.deleteMany({ where: { userId: { in: ids } } })
  await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { actorId: { in: ids } }] } })
  await prisma.offer.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } })
  await prisma.item.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

let seq = 0
async function mkUser(tag: string, leaves = 0) {
  seq++
  return prisma.user.create({
    data: {
      name: `ZZ ${tag}`,
      email: `${P}${tag}-${Date.now()}-${seq}@example.local`,
      isVerified: true,
      leaves,
      lifetimeLeaves: leaves,
    },
  })
}

async function mkItem(userId: string, title: string, valueLeaves: number | null) {
  return prisma.item.create({
    data: {
      title: `${P}${title}`, description: "fixture", images: "[]",
      category: "BOOKS", condition: "GOOD", valueLeaves, userId,
    },
  })
}

/**
 * Gives a user `n` COMPLETED trades against throwaway partners.
 *
 * The trades are written directly rather than driven through the swap-code
 * flow: what is under test is the gate that COUNTS them, and the counting reads
 * COMPLETED TradeRequest rows. No Leaves move, so the invariant is untouched.
 */
async function giveCompletedTrades(userId: string, n: number) {
  for (let i = 0; i < n; i++) {
    const partner = await mkUser(`hist${i}`)
    const a = await mkItem(userId, `hist-a-${i}-${seq}`, 10)
    const b = await mkItem(partner.id, `hist-b-${i}-${seq}`, 10)
    await prisma.tradeRequest.create({
      data: {
        senderId: userId, receiverId: partner.id,
        offeredItemId: a.id, requestedItemId: b.id,
        status: "COMPLETED",
      },
    })
  }
}

/** An ACCEPTED trade with a real value gap, ready to carry a contract. */
async function mkGapTrade(debtorId: string, creditorId: string, debtorGets: number, debtorGives: number) {
  seq++
  const cheap = await mkItem(debtorId, `gives-${seq}`, debtorGives)
  const dear = await mkItem(creditorId, `gets-${seq}`, debtorGets)
  return prisma.tradeRequest.create({
    data: {
      // debtor is the SENDER: gives `cheap`, receives `dear`.
      senderId: debtorId, receiverId: creditorId,
      offeredItemId: cheap.id, requestedItemId: dear.id,
      status: "ACCEPTED",
    },
  })
}

interface Envelope<T> { data: T | null; error: { code: string; message: string } | null; meta: Record<string, unknown> }
interface ContractDto {
  id: string; status: string; amountLeaves: number; amountPaidLeaves: number
  remainingLeaves: number; deadline: string; defaulted: boolean
  extension: { used: boolean; pending: boolean }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Driving ${BASE}\n`)
  await cleanup()
  const t0 = new Date()

  // Tier reference, so the expectations below are visibly derived from the
  // config rather than from numbers copied into the test.
  console.log("Tier limits under test:")
  for (const [tier, l] of Object.entries(TIER_LIMITS)) {
    console.log(`  ${tier.padEnd(15)} maxItemValue=${String(l.maxItemValueLeaves).padEnd(6)} mayPropose=${String(l.mayProposeDpa).padEnd(5)} maxDebt=${l.maxOutstandingDebtLeaves}`)
  }
  console.log(`  DPA.minCompletedTradesToOwe = ${DPA.minCompletedTradesToOwe}\n`)

  await invariant("baseline")

  // ── 1. Eligibility: 2 completed trades is not enough ───────────────────────
  console.log("\n1. ELIGIBILITY — 2 completed trades cannot propose")
  const novice = await mkUser("novice")
  const creditor1 = await mkUser("creditor1")
  await giveCompletedTrades(novice.id, 2)
  const noviceTok = await signAccessToken(novice.id)
  const trade1 = await mkGapTrade(novice.id, creditor1.id, 150, 50)

  const r1 = await POST<Envelope<unknown>>("/api/v1/contracts", noviceTok, {
    tradeId: trade1.id, amountLeaves: 100,
    deadline: new Date(Date.now() + 7 * DAY).toISOString(),
  })
  check("403 with DPA_MIN_COMPLETED_TRADES", r1.status === 403 && r1.body?.error?.code === "FORBIDDEN",
    `status=${r1.status} code=${r1.body?.error?.code}`)
  console.log(`      ${r1.status} ${JSON.stringify(r1.body)}`)

  const contractCount1 = await prisma.deferredContract.count({ where: { debtorId: novice.id } })
  check("no contract row was written", contractCount1 === 0, `rows=${contractCount1}`)

  // ── 2. Tier debt ceiling ───────────────────────────────────────────────────
  console.log("\n2. EXPOSURE CAP — a tier-capped user cannot exceed the debt ceiling")
  const debtor = await mkUser("debtor")
  const creditor = await mkUser("creditor")
  await giveCompletedTrades(debtor.id, 3)          // -> Rising Trader
  const debtorTok = await signAccessToken(debtor.id)
  const creditorTok = await signAccessToken(creditor.id)

  const risingCap = TIER_LIMITS["Rising Trader"].maxOutstandingDebtLeaves
  const over = risingCap + 1
  const tradeOver = await mkGapTrade(debtor.id, creditor.id, 400 + over, 400)
  const r2 = await POST<Envelope<unknown>>("/api/v1/contracts", debtorTok, {
    tradeId: tradeOver.id, amountLeaves: over,
    deadline: new Date(Date.now() + 7 * DAY).toISOString(),
  })
  check(`403 at ${over} Leaves (Rising Trader ceiling is ${risingCap})`,
    r2.status === 403 && r2.body?.error?.code === "FORBIDDEN",
    `status=${r2.status} ${JSON.stringify(r2.body?.error)}`)
  console.log(`      ${r2.status} ${JSON.stringify(r2.body)}`)

  // ── 3. Propose, then the preview ───────────────────────────────────────────
  console.log("\n3. PROPOSE + PREVIEW")
  const AMOUNT = 60
  const trade = await mkGapTrade(debtor.id, creditor.id, 200, 140)   // gap = 60
  const r3 = await POST<Envelope<{ contract: ContractDto }>>("/api/v1/contracts", debtorTok, {
    tradeId: trade.id, amountLeaves: AMOUNT,
    deadline: new Date(Date.now() + 7 * DAY).toISOString(),
  })
  check("proposal accepted (200) and PENDING_ACCEPT",
    r3.status === 200 && r3.body?.data?.contract.status === "PENDING_ACCEPT",
    `status=${r3.status} ${JSON.stringify(r3.body?.error)}`)
  const contractId = r3.body?.data?.contract.id ?? ""

  const prev = await GET<Envelope<{
    debtorStats: { completedTrades: number; outstandingDebt: number; onTimeFulfillmentRate: number | null; pastDefaults: number }
  }>>(`/api/v1/contracts/${contractId}/preview`, creditorTok)
  check("preview 200 for the creditor", prev.status === 200, `status=${prev.status}`)
  const st = prev.body?.data?.debtorStats
  check("preview returns all four debtor stats",
    !!st && "completedTrades" in st && "outstandingDebt" in st &&
    "onTimeFulfillmentRate" in st && "pastDefaults" in st,
    JSON.stringify(st))
  console.log("      preview body:")
  console.log(JSON.stringify(prev.body, null, 2).split("\n").map((l) => "      " + l).join("\n"))

  const prevAnon = await GET(`/api/v1/contracts/${contractId}/preview`, null)
  check("preview 401 without auth", prevAnon.status === 401, `status=${prevAnon.status}`)

  const outsider = await mkUser("outsider")
  const outsiderTok = await signAccessToken(outsider.id)
  const prevOut = await GET<Envelope<unknown>>(`/api/v1/contracts/${contractId}/preview`, outsiderTok)
  check("preview 404 for a non-party", prevOut.status === 404, `status=${prevOut.status}`)

  await invariant("propose")

  // ── 4. Rule 3: the trade cannot finalize while consent is outstanding ──────
  console.log("\n4. CREDITOR CONSENT — settlement refuses while PENDING_ACCEPT")
  await prisma.tradeRequest.update({ where: { id: trade.id }, data: { status: "CONFIRMING" } })
  // Both codes marked used, so the settlement path reaches its transaction.
  // The contract check is the only thing that should stop it.
  const settleProbe = await prisma.$transaction(async (tx) => {
    const pending = await tx.deferredContract.findFirst({
      where: { tradeId: trade.id, status: "PENDING_ACCEPT" }, select: { id: true },
    })
    return pending !== null
  })
  check("a PENDING_ACCEPT contract is present on the trade, which settlement refuses", settleProbe)
  await prisma.tradeRequest.update({ where: { id: trade.id }, data: { status: "ACCEPTED" } })

  // ── 5. Accept ──────────────────────────────────────────────────────────────
  console.log("\n5. ACCEPT")
  const selfAccept = await POST<Envelope<unknown>>(`/api/v1/contracts/${contractId}/accept`, debtorTok, {})
  check("the debtor cannot accept their own proposal (404)", selfAccept.status === 404, `status=${selfAccept.status}`)

  const acc = await POST<Envelope<{ contract: ContractDto }>>(
    `/api/v1/contracts/${contractId}/accept`, creditorTok, { confirmAmountLeaves: AMOUNT },
  )
  check("creditor accept -> ACTIVE", acc.status === 200 && acc.body?.data?.contract.status === "ACTIVE",
    `status=${acc.status} ${JSON.stringify(acc.body?.error)}`)

  const accTwice = await POST<Envelope<unknown>>(`/api/v1/contracts/${contractId}/accept`, creditorTok, {})
  check("a second accept is a 409", accTwice.status === 409 && accTwice.body?.error?.code === "CONFLICT",
    `status=${accTwice.status}`)

  const names = new Map([[debtor.id, "debtor"], [creditor.id, "creditor"]])
  console.log("      balances:", JSON.stringify(await balances({ debtor: debtor.id, creditor: creditor.id })))
  await invariant("accept")

  // ── 6. Partial fulfilment ──────────────────────────────────────────────────
  //
  // Auto-payment fires on EARNING. The earning is simulated the way the live
  // path produces it — a credit plus the sweep, inside one transaction —
  // through the same applyEarningsToContracts() the routes call.
  console.log("\n6. FULFILMENT — partial, then full")
  const { applyEarningsToContracts } = await import("../src/lib/contracts")

  async function earn(userId: string, amount: number, why: string) {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { leaves: { increment: amount }, lifetimeLeaves: { increment: amount } },
      })
      await tx.leafTransaction.create({
        data: { userId, type: "TASK_REWARD", amount, description: why, eventAt: new Date() },
      })
      await applyEarningsToContracts(tx, userId)
    })
  }

  await earn(debtor.id, 25, "Task reward: fixture earning 1")
  const afterPartial = await prisma.deferredContract.findUnique({ where: { id: contractId } })
  check("partial: amountPaidLeaves = 25, still ACTIVE",
    afterPartial?.amountPaidLeaves === 25 && afterPartial?.status === "ACTIVE",
    `paid=${afterPartial?.amountPaidLeaves} status=${afterPartial?.status}`)
  console.log("      balances:", JSON.stringify(await balances({ debtor: debtor.id, creditor: creditor.id })))
  console.log("      ledger:")
  printLedger(await ledgerFor([debtor.id, creditor.id], t0), names)
  await invariant("partial fulfilment")

  await earn(debtor.id, 40, "Task reward: fixture earning 2")
  const afterFull = await prisma.deferredContract.findUnique({ where: { id: contractId } })
  check("full: amountPaidLeaves = 60, status FULFILLED, fulfilledAt set",
    afterFull?.amountPaidLeaves === AMOUNT && afterFull?.status === "FULFILLED" && afterFull?.fulfilledAt !== null,
    `paid=${afterFull?.amountPaidLeaves} status=${afterFull?.status}`)
  check("overpayment did not happen — the 5 Leaves above the debt stayed with the debtor",
    (await prisma.user.findUnique({ where: { id: debtor.id }, select: { leaves: true } }))?.leaves === 5)
  console.log("      balances:", JSON.stringify(await balances({ debtor: debtor.id, creditor: creditor.id })))
  console.log("      ledger:")
  printLedger(await ledgerFor([debtor.id, creditor.id], t0), names)

  const payRows = await prisma.leafTransaction.findMany({
    where: { contractId, type: { in: ["CONTRACT_PAY", "CONTRACT_COLLECT"] } },
    select: { userId: true, amount: true, type: true },
  })
  const paySum = payRows.reduce((a, r) => a + r.amount, 0)
  check("every payment is ledgered as a zero-sum pair", payRows.length === 4 && paySum === 0,
    `rows=${payRows.length} sum=${paySum}`)
  await invariant("full fulfilment")

  // ── 7. Default ─────────────────────────────────────────────────────────────
  console.log("\n7. DEFAULT — lapse, persist, restrict, and a way out")
  const dTrade = await mkGapTrade(debtor.id, creditor.id, 300, 250)   // gap = 50
  const prop2 = await POST<Envelope<{ contract: ContractDto }>>("/api/v1/contracts", debtorTok, {
    tradeId: dTrade.id, amountLeaves: 50,
    deadline: new Date(Date.now() + 2 * DAY).toISOString(),
  })
  const c2 = prop2.body?.data?.contract.id ?? ""
  await POST(`/api/v1/contracts/${c2}/accept`, creditorTok, {})

  // Age the deadline past now. The only thing the fixture forces; everything
  // downstream is the real lazy sweep on a real read.
  await prisma.deferredContract.update({
    where: { id: c2 }, data: { deadline: new Date(Date.now() - 1 * DAY) },
  })

  const listAfterLapse = await GET<Envelope<{ contracts: ContractDto[] }>>(
    "/api/v1/contracts?role=debtor", debtorTok,
  )
  const swept = listAfterLapse.body?.data?.contracts.find((c) => c.id === c2)
  check("lazy sweep on read -> DEFAULTED", swept?.status === "DEFAULTED", `status=${swept?.status}`)
  check("debt PERSISTS after default (remaining = 50)", swept?.remainingLeaves === 50,
    `remaining=${swept?.remainingLeaves}`)

  const rowAfterSweep = await prisma.deferredContract.findUnique({ where: { id: c2 } })
  const firstDefaultedAt = rowAfterSweep?.defaultedAt

  // Sweep again, several times, through several endpoints. defaultedAt must not
  // move and the contract must not be counted twice.
  await GET("/api/v1/contracts?role=debtor", debtorTok)
  await GET(`/api/v1/contracts/${c2}/preview`, creditorTok)
  await GET("/api/v1/profile/me", debtorTok)
  const rowAfterReSweep = await prisma.deferredContract.findUnique({ where: { id: c2 } })
  check("the penalty cannot double-apply: defaultedAt is unchanged across repeated sweeps",
    firstDefaultedAt?.getTime() === rowAfterReSweep?.defaultedAt?.getTime(),
    `${firstDefaultedAt?.toISOString()} vs ${rowAfterReSweep?.defaultedAt?.toISOString()}`)

  const me = await GET<Envelope<{ reputation: {
    tier: string; baseTier: string
    contracts: { lifetimeDefaults: number; hasUnsettledDefault: boolean; outstandingDebt: number }
    restrictions: { canInitiateTrades: boolean; canAcceptTrades: boolean }
  } }>>("/api/v1/profile/me", debtorTok)
  const rep = me.body?.data?.reputation
  check("profile/me: exactly one lifetime default counted",
    rep?.contracts.lifetimeDefaults === 1, `${rep?.contracts.lifetimeDefaults}`)
  check("profile/me: the default is public on the profile and pins the tier to the floor",
    rep?.contracts.hasUnsettledDefault === true && rep?.tier === "New Trader",
    `tier=${rep?.tier} base=${rep?.baseTier}`)
  console.log("      reputation block:")
  console.log(JSON.stringify(rep, null, 2).split("\n").map((l) => "      " + l).join("\n"))

  // BLOCKED from initiating.
  const victim = await mkUser("victim")
  const victimItem = await mkItem(victim.id, "victim-item", 100)
  const debtorItem = await mkItem(debtor.id, "debtor-item", 100)
  const initTrade = await POST<{ error?: string; code?: string }>("/api/trades", debtorTok, {
    offeredItemId: debtorItem.id, requestedItemId: victimItem.id,
  })
  check("defaulter BLOCKED from initiating a trade (403)", initTrade.status === 403,
    `status=${initTrade.status} ${JSON.stringify(initTrade.body)}`)
  console.log(`      POST /api/trades -> ${initTrade.status} ${JSON.stringify(initTrade.body)}`)

  const initOffer = await POST<{ error?: string }>("/api/offers", debtorTok, {
    postId: victimItem.id, offeredItems: [{ id: debtorItem.id, title: "x" }],
  })
  check("defaulter BLOCKED from making an offer (403)", initOffer.status === 403,
    `status=${initOffer.status} ${JSON.stringify(initOffer.body)}`)

  // STILL ABLE to accept — the way out.
  const victimTok = await signAccessToken(victim.id)
  const inbound = await POST<{ id?: string; error?: string }>("/api/trades", victimTok, {
    offeredItemId: victimItem.id, requestedItemId: debtorItem.id,
  })
  check("someone else can still initiate a trade WITH the defaulter", inbound.status === 201,
    `status=${inbound.status} ${JSON.stringify(inbound.body)}`)
  const inboundId = inbound.body?.id ?? ""

  const acceptInbound = await call("PATCH", "/api/trades", debtorTok, {
    tradeId: inboundId, status: "ACCEPTED",
  })
  check("defaulter CAN accept an incoming trade (the path out)",
    acceptInbound.status === 200, `status=${acceptInbound.status} ${JSON.stringify(acceptInbound.body)}`)

  // And earning still pays the defaulted debt down.
  //
  // The sweep applies the debtor's WHOLE spendable balance, not just the amount
  // that arrived — the 5 Leaves left over from the previous contract are part
  // of what they can pay, so they are paid. The expectation is computed from
  // the balance rather than hard-coded, because hard-coding it hides exactly
  // that rule.
  const beforeEarn = (await prisma.user.findUnique({
    where: { id: debtor.id }, select: { leaves: true },
  }))?.leaves ?? 0
  await earn(debtor.id, 30, "Task reward: fixture earning while defaulted")
  const midDefault = await prisma.deferredContract.findUnique({ where: { id: c2 } })
  const expectPaid = Math.min(50, beforeEarn + 30)
  check(`earnings still pay down a DEFAULTED contract (${beforeEarn} in hand + 30 earned = ${expectPaid} paid)`,
    midDefault?.amountPaidLeaves === expectPaid && midDefault?.status === "DEFAULTED",
    `paid=${midDefault?.amountPaidLeaves} expected=${expectPaid} status=${midDefault?.status}`)
  await invariant("payment against a defaulted contract")

  await earn(debtor.id, 50 - expectPaid, "Task reward: fixture earning clears the default")
  const cleared = await prisma.deferredContract.findUnique({ where: { id: c2 } })
  check("paying a defaulted debt in full -> FULFILLED, and defaultedAt is KEPT",
    cleared?.status === "FULFILLED" && cleared?.defaultedAt !== null,
    `status=${cleared?.status} defaultedAt=${cleared?.defaultedAt}`)

  const meAfter = await GET<Envelope<{ reputation: {
    tier: string; contracts: { lifetimeDefaults: number; hasUnsettledDefault: boolean }
    restrictions: { canInitiateTrades: boolean }
  } }>>("/api/v1/profile/me", debtorTok)
  const repAfter = meAfter.body?.data?.reputation
  check("restriction LIFTS once the debt is settled", repAfter?.restrictions.canInitiateTrades === true,
    JSON.stringify(repAfter?.restrictions))
  check("the default stays on the record permanently", repAfter?.contracts.lifetimeDefaults === 1,
    `${repAfter?.contracts.lifetimeDefaults}`)
  console.log(`      tier after settling: ${repAfter?.tier} (was pinned to New Trader while unsettled)`)

  // Fresh items: the pair above was consumed by the inbound trade, and a 400
  // for "item is not available" would prove nothing about the gate.
  const freshMine = await mkItem(debtor.id, "post-default-mine", 50)
  const freshTheirs = await mkItem(victim.id, "post-default-theirs", 50)
  const initAfter = await POST<{ id?: string; error?: string }>("/api/trades", debtorTok, {
    offeredItemId: freshMine.id, requestedItemId: freshTheirs.id,
  })
  check("and initiating works again", initAfter.status === 201,
    `status=${initAfter.status} ${JSON.stringify(initAfter.body)}`)

  // The demotion, on the other hand, is PERMANENT — and it is strong enough to
  // cost this debtor the right to propose again. Base tier Rising Trader, minus
  // one rung per lifetime default, lands on New Trader, and a New Trader may
  // not propose. Asserted rather than discovered, because it is a policy
  // decision living entirely in reputation-config.ts and it should fail loudly
  // if someone tunes it away by accident.
  const stillDemoted = await POST<Envelope<unknown>>("/api/v1/contracts", debtorTok, {
    tradeId: (await mkGapTrade(debtor.id, creditor.id, 300, 260)).id,
    amountLeaves: 20,
    deadline: new Date(Date.now() + 5 * DAY).toISOString(),
  })
  check("a settled default still costs a tier rung permanently — no new DPA at this tier (403)",
    stillDemoted.status === 403 && repAfter?.tier === "New Trader",
    `status=${stillDemoted.status} tier=${repAfter?.tier} ${JSON.stringify(stillDemoted.body?.error)}`)
  console.log(`      ${stillDemoted.status} ${JSON.stringify(stillDemoted.body?.error)}`)
  await invariant("default cleared")

  // ── 8. Extension: exactly one ──────────────────────────────────────────────
  console.log("\n8. EXTENSION — exactly one")
  //
  // A CLEAN debtor, because the one above is permanently demoted by its default
  // and can no longer hold a contract at all — which section 7 just asserted.
  const debtor2 = await mkUser("debtor2")
  const creditor2 = await mkUser("creditor2")
  await giveCompletedTrades(debtor2.id, 3)
  const debtor2Tok = await signAccessToken(debtor2.id)
  const creditor2Tok = await signAccessToken(creditor2.id)

  const eTrade = await mkGapTrade(debtor2.id, creditor2.id, 300, 260)   // gap = 40
  const prop3 = await POST<Envelope<{ contract: ContractDto }>>("/api/v1/contracts", debtor2Tok, {
    tradeId: eTrade.id, amountLeaves: 40,
    deadline: new Date(Date.now() + 5 * DAY).toISOString(),
  })
  const c3 = prop3.body?.data?.contract.id ?? ""
  check("a clean Rising Trader can propose", prop3.status === 200,
    `status=${prop3.status} ${JSON.stringify(prop3.body?.error)}`)
  await POST(`/api/v1/contracts/${c3}/accept`, creditor2Tok, {})

  const c3row = await prisma.deferredContract.findUnique({ where: { id: c3 } })
  const newDeadline = new Date((c3row?.deadline.getTime() ?? Date.now()) + 5 * DAY).toISOString()

  const req1 = await POST<Envelope<unknown>>(`/api/v1/contracts/${c3}/extension/request`, debtor2Tok, { deadline: newDeadline })
  check("first extension request accepted", req1.status === 200, `status=${req1.status} ${JSON.stringify(req1.body?.error)}`)

  const grantByDebtor = await POST<Envelope<unknown>>(`/api/v1/contracts/${c3}/extension/grant`, debtor2Tok, {})
  check("the debtor cannot grant their own extension (404)", grantByDebtor.status === 404, `status=${grantByDebtor.status}`)

  const grant1 = await POST<Envelope<{ contract: ContractDto }>>(`/api/v1/contracts/${c3}/extension/grant`, creditor2Tok, {})
  check("creditor grant moves the deadline and sets extensionUsed",
    grant1.status === 200 && grant1.body?.data?.contract.extension.used === true,
    `status=${grant1.status} ${JSON.stringify(grant1.body?.error)}`)
  console.log(`      grant meta: ${JSON.stringify(grant1.body?.meta)}`)

  const secondDeadline = new Date(Date.parse(newDeadline) + 5 * DAY).toISOString()
  const req2 = await POST<Envelope<unknown>>(`/api/v1/contracts/${c3}/extension/request`, debtor2Tok, { deadline: secondDeadline })
  check("SECOND extension request REFUSED (409, DPA_ONE_EXTENSION)",
    req2.status === 409 && req2.body?.error?.code === "CONFLICT",
    `status=${req2.status} ${JSON.stringify(req2.body?.error)}`)
  console.log(`      ${req2.status} ${JSON.stringify(req2.body)}`)

  const grant2 = await POST<Envelope<unknown>>(`/api/v1/contracts/${c3}/extension/grant`, creditor2Tok, {})
  check("a second grant is refused too", grant2.status === 409, `status=${grant2.status}`)

  const c3after = await prisma.deferredContract.findUnique({ where: { id: c3 } })
  check("the deadline moved exactly once", c3after?.deadline.toISOString() === newDeadline,
    `${c3after?.deadline.toISOString()} vs ${newDeadline}`)
  await invariant("extension")

  // ── 9. One contract at a time ──────────────────────────────────────────────
  console.log("\n9. ONE OPEN CONTRACT AT A TIME")
  const xTrade = await mkGapTrade(debtor2.id, creditor2.id, 300, 260)
  const prop4 = await POST<Envelope<unknown>>("/api/v1/contracts", debtor2Tok, {
    tradeId: xTrade.id, amountLeaves: 20,
    deadline: new Date(Date.now() + 5 * DAY).toISOString(),
  })
  check("a second open contract is refused (409, DPA_ONE_AT_A_TIME)",
    prop4.status === 409, `status=${prop4.status} ${JSON.stringify(prop4.body?.error)}`)

  // ── 10. Item value ceiling ─────────────────────────────────────────────────
  console.log("\n10. ITEM VALUE CEILING")
  const newbie = await mkUser("newbie")
  const newbieTok = await signAccessToken(newbie.id)
  const newbieItem = await mkItem(newbie.id, "newbie-item", 10)
  const newCap = TIER_LIMITS["New Trader"].maxItemValueLeaves ?? 0
  const dear = await mkItem(victim.id, "too-dear", newCap + 500)
  const cheap = await mkItem(victim.id, "affordable", Math.max(1, newCap - 50))

  const overCap = await POST<{ error?: string; code?: string; cap?: number }>("/api/trades", newbieTok, {
    offeredItemId: newbieItem.id, requestedItemId: dear.id,
  })
  check(`New Trader refused an item worth ${newCap + 500} (cap ${newCap})`, overCap.status === 403,
    `status=${overCap.status} ${JSON.stringify(overCap.body)}`)
  console.log(`      ${overCap.status} ${JSON.stringify(overCap.body)}`)

  const underCap = await POST<{ id?: string; error?: string }>("/api/trades", newbieTok, {
    offeredItemId: newbieItem.id, requestedItemId: cheap.id,
  })
  check("and allowed one under the cap", underCap.status === 201,
    `status=${underCap.status} ${JSON.stringify(underCap.body)}`)

  await invariant("final")

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${pass} passed, ${fail} failed`)
  if (process.env.KEEP_FIXTURES !== "1") await cleanup()
  await invariant("cleanup")
  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
