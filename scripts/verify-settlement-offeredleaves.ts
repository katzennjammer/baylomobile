// Regression harness: settlement must debit the amount recorded ON THE TRADE,
// never whatever the Offer table happens to hand back first.
//
// The bug this guards against was live. Settlement resolved the Leaves amount
// with:
//
//   offer.findFirst({ where: { senderId, postId, status: "ACCEPTED" } })
//
// and no orderBy. That correlation is not unique — on production data five
// trades matched more than one accepted offer, one matched eight, and one
// sender/post pair held two accepted offers for DIFFERENT amounts (100 and 200
// Leaves). The quantity of currency moved was therefore whichever row the
// optimiser returned. It was safe only by accident, and only until a trade
// existed for that pair.
//
// Every case below plants a DECOY: an accepted Offer whose amount disagrees
// with the one on the trade. Old code debits the decoy; correct code debits the
// trade. That makes these assertions discriminating rather than merely
// descriptive — if settlement is ever repointed at Offer, they fail
// deterministically instead of passing by luck.
//
// Driven over HTTP against the real route, per the house convention: this
// guards /api/trades/[id]/confirm/submit itself, not a reimplementation of it.
// The one thing seeded directly is the pair of confirmation codes — their
// delivery is email, exercised elsewhere, and is not what this test is about.
//
// Run (from baylo/, with a dev server on BASE):
//   npx tsx --env-file=.env scripts/verify-settlement-offeredleaves.ts
import bcrypt from "bcryptjs"
import prisma from "../src/lib/prisma"
import { signAccessToken } from "../src/lib/auth-tokens"

const BASE = process.env.ACCEPT_BASE ?? "http://127.0.0.1:3100"
const P = "zzsettle-"

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`) }
}

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
  await prisma.swapConfirmationCode.deleteMany({ where: { tradeId: { in: tradeIds } } })
  await prisma.leafTransaction.deleteMany({ where: { userId: { in: ids } } })
  await prisma.taskCompletion.deleteMany({ where: { userId: { in: ids } } })
  await prisma.review.deleteMany({ where: { tradeId: { in: tradeIds } } })
  await prisma.message.deleteMany({ where: { tradeId: { in: tradeIds } } })
  await prisma.tradeRequest.deleteMany({ where: { id: { in: tradeIds } } })
  await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { actorId: { in: ids } }] } })
  await prisma.offer.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } })
  await prisma.item.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

/**
 * A user holding `leaves`, with a matching ledger row so the balance/ledger
 * invariant holds DURING the run and not merely after cleanup.
 *
 * Seeded as SIGNUP_GRANT rather than TASK_REWARD on purpose: a TASK_REWARD row
 * counts against that user's WEEKLY_TASK_LEAF_CAP, which would silently swallow
 * their real VERIFIED_SWAP award at settlement and make the balance delta look
 * like something settlement did.
 */
async function freshUser(tag: string, leaves: number) {
  const u = await prisma.user.create({
    data: {
      name: `ZZ ${tag}`, email: `${P}${tag}-${Date.now()}@example.local`,
      isVerified: true, leaves, lifetimeLeaves: leaves,
    },
  })
  if (leaves > 0) {
    const now = new Date()
    await prisma.leafTransaction.create({
      data: {
        userId: u.id, type: "SIGNUP_GRANT", amount: leaves,
        description: "test seed", createdAt: now, eventAt: now,
      },
    })
  }
  return u
}

const mkItem = (userId: string, title: string) => prisma.item.create({
  data: {
    title: P + title, description: "d", images: "[]",
    category: "BOOKS", condition: "GOOD", userId, valueLeaves: 10,
  },
})

/** Seeds both confirmation codes and moves the trade to CONFIRMING. */
async function seedCodes(tradeId: string, senderId: string, receiverId: string) {
  const senderCode = "111111", receiverCode = "222222"
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
  const [sh, rh] = await Promise.all([bcrypt.hash(senderCode, 10), bcrypt.hash(receiverCode, 10)])
  await prisma.$transaction([
    prisma.swapConfirmationCode.upsert({
      where:  { tradeId_userId: { tradeId, userId: senderId } },
      create: { tradeId, userId: senderId, codeHash: sh, used: false, attempts: 0, expiresAt },
      update: { codeHash: sh, used: false, attempts: 0, expiresAt },
    }),
    prisma.swapConfirmationCode.upsert({
      where:  { tradeId_userId: { tradeId, userId: receiverId } },
      create: { tradeId, userId: receiverId, codeHash: rh, used: false, attempts: 0, expiresAt },
      update: { codeHash: rh, used: false, attempts: 0, expiresAt },
    }),
    prisma.tradeRequest.update({ where: { id: tradeId }, data: { status: "CONFIRMING" } }),
  ])
  return { senderCode, receiverCode }
}

function submit(tradeId: string, token: string | null, code: string) {
  return fetch(`${BASE}/api/trades/${tradeId}/confirm/submit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ code }),
  })
}

/** Runs one full two-party settlement and reports the movement observed. */
async function settle(opts: {
  tag: string
  recordedOnTrade: number | null
  decoyOfferAmounts: number[]
  senderStart: number
}) {
  const a = await freshUser(`${opts.tag}-a`, opts.senderStart)
  const b = await freshUser(`${opts.tag}-b`, 0)
  const i1 = await mkItem(a.id, `${opts.tag}-1`)
  const i2 = await mkItem(b.id, `${opts.tag}-2`)

  const trade = await prisma.tradeRequest.create({
    data: {
      senderId: a.id, receiverId: b.id,
      offeredItemId: i1.id, requestedItemId: i2.id,
      status: "ACCEPTED", offeredLeaves: opts.recordedOnTrade,
    },
  })

  // Decoys: accepted offers on (a -> i2) whose amounts disagree with the trade.
  for (const amt of opts.decoyOfferAmounts) {
    await prisma.offer.create({
      data: {
        postId: i2.id, senderId: a.id, receiverId: b.id,
        offeredItems: "[]", offeredLeaves: amt, status: "ACCEPTED",
      },
    })
  }

  const { senderCode, receiverCode } = await seedCodes(trade.id, a.id, b.id)
  const [tokA, tokB] = await Promise.all([signAccessToken(a.id), signAccessToken(b.id)])

  // Each participant submits their PARTNER's code.
  const r1 = await submit(trade.id, tokA, receiverCode)
  const r2 = await submit(trade.id, tokB, senderCode)

  const [ua, ub, t, ledger] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: a.id }, select: { leaves: true } }),
    prisma.user.findUniqueOrThrow({ where: { id: b.id }, select: { leaves: true } }),
    prisma.tradeRequest.findUniqueOrThrow({ where: { id: trade.id }, select: { status: true } }),
    prisma.leafTransaction.findMany({
      where: { tradeId: trade.id }, select: { userId: true, type: true, amount: true },
    }),
  ])
  const spend   = ledger.filter((l) => l.type === "TRADE_SPEND")
  const receive = ledger.filter((l) => l.type === "TRADE_RECEIVE")
  return {
    a, b, trade, status: t.status, ledger,
    httpOk: r1.ok && r2.ok,
    r1Status: r1.status, r2Status: r2.status,
    senderLeaves: ua.leaves, receiverLeaves: ub.leaves,
    // The trade's own movement, isolated from the VERIFIED_SWAP task awards
    // that settlement also pays out.
    tradeDebit:  spend.reduce((n, l) => n + Math.abs(l.amount), 0),
    tradeCredit: receive.reduce((n, l) => n + l.amount, 0),
    tradeRows:   [...spend, ...receive],
    taskAwarded: ledger.filter((l) => l.type === "TASK_REWARD").reduce((n, l) => n + l.amount, 0),
  }
}

async function main() {
  console.log(`Driving ${BASE}\n`)
  await cleanup()

  // 1. One decoy, disagreeing. The discriminator.
  console.log("1. trade records 100; a single ACCEPTED offer says 999")
  {
    const r = await settle({ tag: "one", recordedOnTrade: 100, decoyOfferAmounts: [999], senderStart: 500 })
    console.log(`     balances  sender 500 -> ${r.senderLeaves}   receiver 0 -> ${r.receiverLeaves}`)
    console.log(`     (of which VERIFIED_SWAP task awards: ${r.taskAwarded} Leaves)`)
    check("both submissions accepted", r.httpOk, `${r.r1Status}/${r.r2Status}`)
    check("trade COMPLETED", r.status === "COMPLETED", r.status)
    check("debited the TRADE's 100, not the offer's 999", r.tradeDebit === 100, `debited=${r.tradeDebit}`)
    check("receiver credited 100", r.tradeCredit === 100, `credited=${r.tradeCredit}`)
    check("ledger pair is exactly -100/+100", r.tradeRows.length === 2
      && r.tradeRows.some((l) => l.userId === r.a.id && l.amount === -100 && l.type === "TRADE_SPEND")
      && r.tradeRows.some((l) => l.userId === r.b.id && l.amount === 100 && l.type === "TRADE_RECEIVE"),
      JSON.stringify(r.tradeRows))
    check("trade rows net to zero", r.tradeRows.reduce((s, l) => s + l.amount, 0) === 0)
  }

  // 2. The real production shape: two accepted offers, different amounts.
  console.log("\n2. trade records 100; TWO ACCEPTED offers say 100 and 999 (the live ambiguity)")
  {
    const r = await settle({ tag: "amb", recordedOnTrade: 100, decoyOfferAmounts: [100, 999], senderStart: 500 })
    console.log(`     balances  sender 500 -> ${r.senderLeaves}   receiver 0 -> ${r.receiverLeaves}`)
    check("trade COMPLETED", r.status === "COMPLETED", r.status)
    check("debit is 100 and not optimiser-dependent", r.tradeDebit === 100, `debited=${r.tradeDebit}`)
    check("receiver credited 100", r.tradeCredit === 100, `credited=${r.tradeCredit}`)
  }

  // 3. No Leaves on the trade — a decoy offer must not invent a debit.
  console.log("\n3. trade records NULL; an ACCEPTED offer says 750")
  {
    const r = await settle({ tag: "null", recordedOnTrade: null, decoyOfferAmounts: [750], senderStart: 500 })
    console.log(`     balances  sender 500 -> ${r.senderLeaves}   receiver 0 -> ${r.receiverLeaves}`)
    check("trade COMPLETED", r.status === "COMPLETED", r.status)
    check("nothing debited", r.tradeDebit === 0, `debited=${r.tradeDebit}`)
    check("nothing credited", r.tradeCredit === 0, `credited=${r.tradeCredit}`)
    check("no TRADE_SPEND/RECEIVE ledger rows", r.tradeRows.length === 0, JSON.stringify(r.tradeRows))
  }

  // 4. The route still refuses an unauthenticated caller.
  console.log("\n4. auth")
  {
    const a = await freshUser("auth-a", 0), b = await freshUser("auth-b", 0)
    const i1 = await mkItem(a.id, "auth-1"), i2 = await mkItem(b.id, "auth-2")
    const trade = await prisma.tradeRequest.create({
      data: {
        senderId: a.id, receiverId: b.id, offeredItemId: i1.id,
        requestedItemId: i2.id, status: "ACCEPTED", offeredLeaves: 10,
      },
    })
    const { receiverCode } = await seedCodes(trade.id, a.id, b.id)
    const anon = await submit(trade.id, null, receiverCode)
    check("401 without auth", anon.status === 401, `got ${anon.status}`)
    const tok = await signAccessToken(a.id)
    const withBearer = await submit(trade.id, tok, receiverCode)
    check("200 with Bearer and no cookie", withBearer.status === 200, `got ${withBearer.status}`)
  }

  // 5. Global invariant, with the test rows still present.
  console.log("\n5. invariant")
  {
    // The durable invariant is over ALL signed rows, per the note on
    // LeafTransaction: SUM(User.leaves) == SUM(LeafTransaction.amount). The
    // "sum of POSITIVE rows" form is equal to it only while no Leaves-bearing
    // trade has settled — a settlement writes +N and -N, so positive-only
    // overcounts by exactly the credit side. These cases settle real trades,
    // which is precisely when the two formulations part company.
    const [u, all, pos] = await Promise.all([
      prisma.user.aggregate({ _sum: { leaves: true } }),
      prisma.leafTransaction.aggregate({ _sum: { amount: true } }),
      prisma.leafTransaction.aggregate({ _sum: { amount: true }, where: { amount: { gt: 0 } } }),
    ])
    const leaves = u._sum.leaves ?? 0
    check("SUM(User.leaves) == SUM(all ledger rows)",
      leaves === (all._sum.amount ?? 0),
      `leaves=${leaves} ledger=${all._sum.amount}`)
    console.log(`     positive-only would read ${pos._sum.amount} (differs once trades settle — expected)`)
  }

  await cleanup()
  console.log(`\n${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await cleanup().catch(() => {})
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
