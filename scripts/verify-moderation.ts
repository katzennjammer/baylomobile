// Acceptance harness for reporting, blocking and the admin moderation surface.
//
// Drives the REAL routes over HTTP, per the house convention, and reads the
// database directly only to build fixtures and to check what the routes wrote.
//
// Covers, in order:
//   1  a non-admin gets 403 from EVERY /api/admin route
//   2  self-report is refused; reporting your own listing is refused
//   3  reporting the same target twice returns 409
//   4  a blocked user's listings are absent from feed, browse and search,
//      and the SQL that excludes them is printed
//   5  a blocked user's message send is refused, both directions
//   6  blocking mid-trade: the trade and the DPA both survive, verbatim
//   7  an admin action writes an audit row; a hidden listing leaves the feed
//      and its owner cannot relist it
//   8  resolving a report notifies the reporter and frees the openKey slot
//   9  no route accepts `role` in a request body (no promotion endpoint)
//  10  SUM(User.leaves) == SUM(LeafTransaction.amount) is untouched throughout
//
// Run (from baylo/, with a dev server on BASE):
//   npx tsx --env-file=.env scripts/verify-moderation.ts
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import prisma from "../src/lib/prisma"
import { signAccessToken } from "../src/lib/auth-tokens"

const BASE = process.env.ACCEPT_BASE ?? "http://127.0.0.1:3100"
const P = "zzmod-"

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`) }
}
function head(s: string) { console.log(`\n── ${s} ${"─".repeat(Math.max(0, 68 - s.length))}`) }

interface Res<T = unknown> { status: number; body: T }

async function call<T = unknown>(
  method: string, path: string, token: string | null, body?: unknown,
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
const DEL = <T = unknown>(p: string, t: string | null) => call<T>("DELETE", p, t)

/** SUM(User.leaves) == SUM(LeafTransaction.amount). Global, every row. */
async function invariant(label: string) {
  const [users, ledger] = await Promise.all([
    prisma.user.aggregate({ _sum: { leaves: true } }),
    prisma.leafTransaction.aggregate({ _sum: { amount: true } }),
  ])
  const u = users._sum.leaves ?? 0
  const l = ledger._sum.amount ?? 0
  check(`INVARIANT ${label}: SUM(User.leaves)=${u} == SUM(LeafTransaction.amount)=${l}`, u === l)
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: P } },
    select: { id: true },
  })
  const ids = users.map((u) => u.id)
  if (ids.length === 0) return

  // Order matters: AdminAction.actorId is RESTRICT, so audit rows must go
  // before the users they name. That constraint is deliberate (see the model)
  // and this is the one place that has to work around it.
  await prisma.adminAction.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { targetId: { in: ids } }] } })
  await prisma.report.deleteMany({ where: { OR: [{ reporterId: { in: ids } }, { resolvedById: { in: ids } }] } })
  const items = await prisma.item.findMany({ where: { userId: { in: ids } }, select: { id: true } })
  const itemIds = items.map((i) => i.id)
  await prisma.adminAction.deleteMany({ where: { targetId: { in: itemIds } } })
  await prisma.report.deleteMany({ where: { targetId: { in: [...ids, ...itemIds] } } })
  await prisma.block.deleteMany({ where: { OR: [{ blockerId: { in: ids } }, { blockedId: { in: ids } }] } })
  await prisma.deferredContract.deleteMany({ where: { OR: [{ debtorId: { in: ids } }, { creditorId: { in: ids } }] } })
  await prisma.leafTransaction.deleteMany({ where: { userId: { in: ids } } })
  await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { actorId: { in: ids } }] } })
  await prisma.message.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } })
  await prisma.review.deleteMany({ where: { OR: [{ reviewerId: { in: ids } }, { revieweeId: { in: ids } }] } })
  await prisma.swapConfirmationCode.deleteMany({ where: { userId: { in: ids } } })
  await prisma.tradeRequest.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } })
  await prisma.offer.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } })
  await prisma.taskCompletion.deleteMany({ where: { userId: { in: ids } } })
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } })
  await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: ids } } })
  await prisma.item.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

async function makeUser(tag: string, role: "USER" | "MODERATOR" | "ADMIN" = "USER") {
  return prisma.user.create({
    data: {
      name: `${P}${tag}`,
      email: `${P}${tag}@test.local`,
      isVerified: true,
      role,
      leaves: 0,
      lifetimeLeaves: 0,
    },
    select: { id: true, name: true, email: true },
  })
}

async function makeItem(userId: string, title: string) {
  return prisma.item.create({
    data: {
      title, description: `${title} description`, images: "[]",
      category: "BOOKS", condition: "GOOD", valueLeaves: 100,
      status: "AVAILABLE", userId,
    },
    select: { id: true, title: true },
  })
}

async function main() {
  console.log(`Moderation acceptance — ${BASE}`)
  await cleanup()
  await invariant("at start")

  // ── fixtures ──
  const alice = await makeUser("alice")          // ordinary user
  const mallory = await makeUser("mallory")      // the one who gets blocked
  const carol = await makeUser("carol")          // uninvolved third party
  const mod = await makeUser("mod", "MODERATOR")
  const admin = await makeUser("admin", "ADMIN")

  const tAlice = await signAccessToken(alice.id)
  const tMallory = await signAccessToken(mallory.id)
  const tCarol = await signAccessToken(carol.id)
  const tMod = await signAccessToken(mod.id)
  const tAdmin = await signAccessToken(admin.id)

  const aliceItem = await makeItem(alice.id, `${P}Alice Atlas`)
  const malloryItem = await makeItem(mallory.id, `${P}Mallory Manual`)
  const carolItem = await makeItem(carol.id, `${P}Carol Codex`)

  // ═══════════════════════════════════════════════════════════════════════════
  head("1  A non-admin hitting any /api/admin/ route gets 403")

  const adminRoutes: [string, string, unknown?][] = [
    ["GET", "/api/admin/reports"],
    ["GET", "/api/admin/audit"],
    ["GET", "/api/admin/anomalies"],
    ["GET", `/api/admin/reports/does-not-matter`],
    ["POST", `/api/admin/reports/x/resolve`, { action: "dismissed", note: "x" }],
    ["POST", `/api/admin/listings/${aliceItem.id}`, { action: "hide", reason: "x" }],
    ["POST", `/api/admin/users/${alice.id}`, { action: "suspend", reason: "x" }],
  ]
  for (const [method, path, body] of adminRoutes) {
    const r = await call(method, path, tAlice, body)
    check(`${method} ${path} as ordinary user -> 403`, r.status === 403,
      `got ${r.status} ${JSON.stringify(r.body)}`)
  }
  // Unauthenticated is 401, not 403 — a different failure and a different fix.
  const anon = await GET("/api/admin/reports", null)
  check("GET /api/admin/reports unauthenticated -> 401", anon.status === 401, `got ${anon.status}`)
  // And a moderator does get in, or the 403s above prove nothing.
  const modOk = await GET("/api/admin/reports", tMod)
  check("GET /api/admin/reports as MODERATOR -> 200", modOk.status === 200, `got ${modOk.status}`)
  // Suspension is ADMIN-only, so a moderator is refused there specifically.
  const modSuspend = await POST(`/api/admin/users/${mallory.id}`, tMod, { action: "suspend", reason: "x" })
  check("POST /api/admin/users/[id] as MODERATOR -> 403 (ADMIN only)", modSuspend.status === 403,
    `got ${modSuspend.status}`)

  // ═══════════════════════════════════════════════════════════════════════════
  head("2  Self-report is refused")

  const selfUser = await POST("/api/v1/reports", tAlice,
    { targetType: "user", targetId: alice.id, category: "spam" })
  check("reporting your own account -> 403 SELF_REPORT", selfUser.status === 403,
    `got ${selfUser.status} ${JSON.stringify(selfUser.body)}`)

  const selfListing = await POST("/api/v1/reports", tAlice,
    { targetType: "listing", targetId: aliceItem.id, category: "spam" })
  check("reporting your own listing -> 403 SELF_REPORT", selfListing.status === 403,
    `got ${selfListing.status} ${JSON.stringify(selfListing.body)}`)

  // ═══════════════════════════════════════════════════════════════════════════
  head("3  Reporting the same target twice returns a conflict")

  const r1 = await POST<{ data: { report: { id: string } } }>("/api/v1/reports", tAlice,
    { targetType: "listing", targetId: malloryItem.id, category: "prohibited_item", notes: "first" })
  check("first report -> 200", r1.status === 200, `got ${r1.status} ${JSON.stringify(r1.body)}`)
  const reportId = r1.body?.data?.report?.id ?? ""

  const r2 = await POST("/api/v1/reports", tAlice,
    { targetType: "listing", targetId: malloryItem.id, category: "spam", notes: "second" })
  check("second report, same target, same reporter -> 409", r2.status === 409,
    `got ${r2.status} ${JSON.stringify(r2.body)}`)

  // A DIFFERENT reporter is not blocked — the constraint is per reporter.
  const r3 = await POST("/api/v1/reports", tCarol,
    { targetType: "listing", targetId: malloryItem.id, category: "spam" })
  check("a different reporter, same target -> 200 (not a global lock)", r3.status === 200,
    `got ${r3.status}`)

  const openRows = await prisma.report.findMany({
    where: { reporterId: alice.id, targetId: malloryItem.id },
    select: { id: true, status: true, openKey: true },
  })
  check(`exactly one live report row for (alice, listing) [openKey='live']`,
    openRows.filter((r) => r.openKey !== null).length === 1,
    JSON.stringify(openRows))

  // ═══════════════════════════════════════════════════════════════════════════
  head("4  A blocked user's listings are absent from feed, browse and search")

  // Baseline: before any block, Alice can see Mallory's listing everywhere.
  const feedBefore = await GET<{ data: { feed: { id: string }[] } }>("/api/v1/home?limit=50", tAlice)
  const browseBefore = await GET<{ data: { items: { id: string }[] } }>("/api/v1/browse?limit=50", tAlice)
  const searchBefore = await GET<{ data: { items: { id: string }[] } }>(
    `/api/v1/browse?limit=50&q=${encodeURIComponent("Mallory Manual")}`, tAlice)
  check("BEFORE block — listing IS in feed",
    (feedBefore.body?.data?.feed ?? []).some((i) => i.id === malloryItem.id))
  check("BEFORE block — listing IS in browse",
    (browseBefore.body?.data?.items ?? []).some((i) => i.id === malloryItem.id))
  check("BEFORE block — listing IS in search",
    (searchBefore.body?.data?.items ?? []).some((i) => i.id === malloryItem.id))

  const blockRes = await POST<{ data: { effects: { unchanged: unknown } } }>(
    "/api/v1/blocks", tAlice, { userId: mallory.id })
  check("POST /api/v1/blocks -> 200", blockRes.status === 200, `got ${blockRes.status}`)

  const feedAfter = await GET<{ data: { feed: { id: string }[] } }>("/api/v1/home?limit=50", tAlice)
  const browseAfter = await GET<{ data: { items: { id: string }[] } }>("/api/v1/browse?limit=50", tAlice)
  const searchAfter = await GET<{ data: { items: { id: string }[] } }>(
    `/api/v1/browse?limit=50&q=${encodeURIComponent("Mallory Manual")}`, tAlice)
  check("AFTER block — listing absent from feed",
    !(feedAfter.body?.data?.feed ?? []).some((i) => i.id === malloryItem.id))
  check("AFTER block — listing absent from browse",
    !(browseAfter.body?.data?.items ?? []).some((i) => i.id === malloryItem.id))
  check("AFTER block — listing absent from search",
    !(searchAfter.body?.data?.items ?? []).some((i) => i.id === malloryItem.id))

  // The OTHER direction: Mallory (who did not block) must equally lose Alice.
  const malloryFeed = await GET<{ data: { feed: { id: string }[] } }>("/api/v1/home?limit=50", tMallory)
  check("AFTER block — the BLOCKED party also loses the blocker's listings",
    !(malloryFeed.body?.data?.feed ?? []).some((i) => i.id === aliceItem.id))

  // Third parties are unaffected.
  const carolFeed = await GET<{ data: { feed: { id: string }[] } }>("/api/v1/home?limit=50", tCarol)
  check("AFTER block — an uninvolved third party still sees both",
    (carolFeed.body?.data?.feed ?? []).some((i) => i.id === malloryItem.id) &&
    (carolFeed.body?.data?.feed ?? []).some((i) => i.id === aliceItem.id))

  // Item detail 404s, in both directions.
  const detail = await GET(`/api/v1/items/${malloryItem.id}`, tAlice)
  check("AFTER block — item detail -> 404 (not 403; a 403 confirms it exists)",
    detail.status === 404, `got ${detail.status}`)
  const profile = await GET(`/api/v1/profile/${mallory.id}`, tAlice)
  check("AFTER block — profile -> 404", profile.status === 404, `got ${profile.status}`)

  // ── THE QUERY ITSELF, not just the response. ──
  //
  // The requirement is that the exclusion happens in SQL, so print the SQL.
  // Prisma compiles the relation filter into NOT EXISTS subqueries; EXPLAIN
  // over the equivalent statement shows the same shape the ORM emits.
  console.log("\n  The feed query's block filter, as SQL:")
  const explain = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `EXPLAIN SELECT i.id, i.title FROM Item i
       WHERE i.status = 'AVAILABLE'
         AND i.moderationHiddenAt IS NULL
         AND NOT EXISTS (SELECT 1 FROM Block b WHERE b.blockerId = i.userId AND b.blockedId = ?)
         AND NOT EXISTS (SELECT 1 FROM Block b WHERE b.blockedId = i.userId AND b.blockerId = ?)`,
    alice.id, alice.id,
  )
  for (const row of explain) {
    // EXPLAIN returns BigInt columns (rows, filtered), which JSON.stringify
    // refuses outright rather than coercing.
    console.log(`    ${JSON.stringify(row, (_k, v) => (typeof v === "bigint" ? Number(v) : v))}`)
  }
  const excluded = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT i.id FROM Item i
       WHERE i.status = 'AVAILABLE'
         AND i.moderationHiddenAt IS NULL
         AND NOT EXISTS (SELECT 1 FROM Block b WHERE b.blockerId = i.userId AND b.blockedId = ?)
         AND NOT EXISTS (SELECT 1 FROM Block b WHERE b.blockedId = i.userId AND b.blockerId = ?)
         AND i.id = ?`,
    alice.id, alice.id, malloryItem.id,
  )
  check("the SQL itself returns zero rows for the blocked listing", excluded.length === 0)

  // ═══════════════════════════════════════════════════════════════════════════
  head("5  A blocked user's message send is refused")

  const sendFromBlocker = await POST("/api/messages", tAlice,
    { receiverId: mallory.id, content: "hello" })
  check("blocker -> blocked: send refused 403", sendFromBlocker.status === 403,
    `got ${sendFromBlocker.status} ${JSON.stringify(sendFromBlocker.body)}`)

  const sendFromBlocked = await POST("/api/messages", tMallory,
    { receiverId: alice.id, content: "hello back" })
  check("blocked -> blocker: send ALSO refused 403", sendFromBlocked.status === 403,
    `got ${sendFromBlocked.status}`)

  const readThread = await GET(`/api/messages?partnerId=${mallory.id}`, tAlice)
  check("the thread itself is unavailable -> 403", readThread.status === 403,
    `got ${readThread.status}`)

  const convos = await GET<{ data: { conversations: { partner: { id: string } }[] } }>(
    "/api/v1/messages/conversations", tAlice)
  check("the thread is absent from the conversation list",
    !(convos.body?.data?.conversations ?? []).some((c) => c.partner.id === mallory.id))

  // Unaffected third party can still be messaged.
  const sendToCarol = await POST("/api/messages", tAlice, { receiverId: carol.id, content: "hi" })
  check("messaging an unblocked person still works", sendToCarol.status === 201,
    `got ${sendToCarol.status}`)

  // New trades and offers are refused too.
  const tradeAttempt = await POST("/api/trades", tAlice,
    { offeredItemId: aliceItem.id, requestedItemId: malloryItem.id })
  check("starting a trade with a blocked person -> 403", tradeAttempt.status === 403,
    `got ${tradeAttempt.status}`)
  // A VALID offer body. An empty `offeredItems` fails createOfferSchema's
  // "at least one item or some Leaves" refinement and 400s before the block
  // gate is ever reached — which would make this assertion pass for the wrong
  // reason and prove nothing.
  const offerAttempt = await POST("/api/offers", tAlice, {
    postId: malloryItem.id,
    offeredItems: [{ id: aliceItem.id, title: aliceItem.title }],
  })
  check("making an offer to a blocked person -> 403", offerAttempt.status === 403,
    `got ${offerAttempt.status} ${JSON.stringify(offerAttempt.body)}`)

  // And the same offer to an unblocked person still works, so the 403 above is
  // the block and not a broken offer path.
  const offerOk = await POST("/api/offers", tAlice, {
    postId: carolItem.id,
    offeredItems: [{ id: aliceItem.id, title: aliceItem.title }],
  })
  check("the same offer to an unblocked person -> 201", offerOk.status === 201,
    `got ${offerOk.status} ${JSON.stringify(offerOk.body)}`)

  // ═══════════════════════════════════════════════════════════════════════════
  head("6  Blocking mid-trade: what happens to the trade and the DPA")

  // Fresh pair, so the block below is the only thing that changes.
  const dave = await makeUser("dave")
  const erin = await makeUser("erin")
  const tDave = await signAccessToken(dave.id)
  const daveItem = await makeItem(dave.id, `${P}Dave Device`)
  const erinItem = await makeItem(erin.id, `${P}Erin Engine`)

  const trade = await prisma.tradeRequest.create({
    data: {
      senderId: dave.id, receiverId: erin.id,
      offeredItemId: daveItem.id, requestedItemId: erinItem.id,
      status: "ACCEPTED",
    },
    select: { id: true, status: true },
  })
  const contract = await prisma.deferredContract.create({
    data: {
      tradeId: trade.id,
      debtorId: dave.id, creditorId: erin.id,
      amountLeaves: 300, amountPaidLeaves: 50,
      deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      status: "ACTIVE", acceptedAt: new Date(),
    },
    select: { id: true, status: true, amountLeaves: true, amountPaidLeaves: true, deadline: true },
  })

  console.log(`  BEFORE  trade ${trade.id} status=${trade.status}`)
  console.log(`  BEFORE  contract ${contract.id} status=${contract.status} ` +
    `owed=${contract.amountLeaves - contract.amountPaidLeaves} deadline=${contract.deadline.toISOString()}`)

  // Dave — the DEBTOR — blocks Erin, his CREDITOR. This is the exact abuse the
  // design refuses: if a block voided the contract, this would be how you clear
  // a debt.
  const midBlock = await POST<{
    data: { effects: { unchanged: { activeTrades: unknown[]; openContracts: unknown[] }; note: string | null } }
  }>("/api/v1/blocks", tDave, { userId: erin.id })
  check("debtor may block their creditor (the block itself is not refused)", midBlock.status === 200,
    `got ${midBlock.status}`)

  const tradeAfter = await prisma.tradeRequest.findUnique({
    where: { id: trade.id }, select: { status: true },
  })
  const contractAfter = await prisma.deferredContract.findUnique({
    where: { id: contract.id },
    select: { status: true, amountLeaves: true, amountPaidLeaves: true, deadline: true, defaultedAt: true },
  })

  console.log(`  AFTER   trade ${trade.id} status=${tradeAfter?.status}`)
  console.log(`  AFTER   contract ${contract.id} status=${contractAfter?.status} ` +
    `owed=${(contractAfter?.amountLeaves ?? 0) - (contractAfter?.amountPaidLeaves ?? 0)} ` +
    `deadline=${contractAfter?.deadline.toISOString()}`)

  check("the ACCEPTED trade is NOT cancelled by the block", tradeAfter?.status === "ACCEPTED",
    `status is ${tradeAfter?.status}`)
  check("the DPA is NOT voided — status unchanged", contractAfter?.status === "ACTIVE",
    `status is ${contractAfter?.status}`)
  check("the DPA principal is unchanged", contractAfter?.amountLeaves === 300)
  check("the DPA amount paid is unchanged (debt survives)", contractAfter?.amountPaidLeaves === 50)
  check("the DPA deadline is unchanged",
    contractAfter?.deadline.getTime() === contract.deadline.getTime())
  check("the block response REPORTS the surviving trade",
    (midBlock.body?.data?.effects?.unchanged?.activeTrades ?? []).length === 1,
    JSON.stringify(midBlock.body?.data?.effects?.unchanged))
  check("the block response REPORTS the surviving contract",
    (midBlock.body?.data?.effects?.unchanged?.openContracts ?? []).length === 1)
  check("the block response says so in words", !!midBlock.body?.data?.effects?.note,
    String(midBlock.body?.data?.effects?.note))
  console.log(`  NOTE TO USER: ${midBlock.body?.data?.effects?.note}`)

  // And messaging between them IS closed, mid-trade or not.
  const midTradeMsg = await POST("/api/messages", tDave, { receiverId: erin.id, content: "about the swap" })
  check("messaging is still refused even with a live trade between them", midTradeMsg.status === 403,
    `got ${midTradeMsg.status}`)

  await invariant("after mid-trade block")

  // ═══════════════════════════════════════════════════════════════════════════
  head("7  An admin action writes an audit row")

  const auditBefore = await prisma.adminAction.count()

  const hide = await POST(`/api/admin/listings/${malloryItem.id}`, tMod, {
    action: "hide",
    reason: "Prohibited item — verified against the policy list.",
    reportId,
  })
  check("moderator hides a listing -> 200", hide.status === 200,
    `got ${hide.status} ${JSON.stringify(hide.body)}`)

  const auditRows = await prisma.adminAction.findMany({
    where: { targetId: malloryItem.id, action: "LISTING_HIDDEN" },
    select: {
      id: true, actorId: true, action: true, targetType: true, targetId: true,
      reportId: true, reason: true, detail: true, createdAt: true,
      actor: { select: { name: true } },
    },
  })
  check("exactly one audit row written", auditRows.length === 1)
  check("audit count increased by one", (await prisma.adminAction.count()) === auditBefore + 1)
  const row = auditRows[0]
  if (row) {
    console.log("\n  The audit row:")
    console.log(`    id         ${row.id}`)
    console.log(`    who        ${row.actor.name} (${row.actorId})`)
    console.log(`    what       ${row.action} on ${row.targetType} ${row.targetId}`)
    console.log(`    when       ${row.createdAt.toISOString()}`)
    console.log(`    why        ${row.reason}`)
    console.log(`    report     ${row.reportId}`)
    console.log(`    detail     ${row.detail}`)
    check("audit row names WHO", row.actorId === mod.id)
    check("audit row names WHAT", row.action === "LISTING_HIDDEN" && row.targetId === malloryItem.id)
    check("audit row names WHEN", row.createdAt instanceof Date)
    check("audit row names WHY (non-empty)", row.reason.length > 0)
    check("audit row links the report it answers", row.reportId === reportId)
    check("audit row snapshots the listing title",
      !!row.detail && row.detail.includes("Mallory Manual"), String(row.detail))
  }

  // A hidden listing leaves the feed for EVERYONE, not just the blocker.
  const carolFeed2 = await GET<{ data: { feed: { id: string }[] } }>("/api/v1/home?limit=50", tCarol)
  check("a hidden listing is absent from an uninvolved user's feed",
    !(carolFeed2.body?.data?.feed ?? []).some((i) => i.id === malloryItem.id))

  // And its owner cannot resurrect it — the reason moderationHiddenAt is its
  // own column rather than an ItemStatus.
  await prisma.item.update({ where: { id: malloryItem.id }, data: { status: "OWNED" } })
  const relist = await POST(`/api/items/${malloryItem.id}/relist`, tMallory)
  check("the owner cannot relist a moderator-hidden listing -> 403", relist.status === 403,
    `got ${relist.status} ${JSON.stringify(relist.body)}`)

  // An empty reason is refused: the audit row is the point.
  const noReason = await POST(`/api/admin/listings/${carolItem.id}`, tMod, { action: "hide", reason: "  " })
  check("hiding with a blank reason -> 400", noReason.status === 400, `got ${noReason.status}`)

  // Suspension, ADMIN only, also audited.
  const suspend = await POST(`/api/admin/users/${mallory.id}`, tAdmin, {
    action: "suspend", reason: "Repeated prohibited listings.", days: 7,
  })
  check("admin suspends an account -> 200", suspend.status === 200,
    `got ${suspend.status} ${JSON.stringify(suspend.body)}`)
  check("suspension writes its own audit row",
    (await prisma.adminAction.count({ where: { targetId: mallory.id, action: "USER_SUSPENDED" } })) === 1)

  // The suspension bites immediately — same token, now refused.
  const suspendedCall = await GET("/api/v1/home", tMallory)
  check("a suspended account's existing access token stops working -> 401",
    suspendedCall.status === 401, `got ${suspendedCall.status}`)

  // An admin cannot be suspended through the API, and nobody can suspend themselves.
  const selfSuspend = await POST(`/api/admin/users/${admin.id}`, tAdmin, { action: "suspend", reason: "x" })
  check("an admin cannot suspend themselves -> 403", selfSuspend.status === 403, `got ${selfSuspend.status}`)

  await invariant("after admin actions")

  // ═══════════════════════════════════════════════════════════════════════════
  head("8  Resolving a report notifies the reporter and frees the slot")

  const notifBefore = await prisma.notification.count({
    where: { userId: alice.id, type: "REPORT_RESOLVED" },
  })

  const resolve = await POST(`/api/admin/reports/${reportId}/resolve`, tMod, {
    action: "actioned",
    note: "We removed the listing. Thanks for flagging it.",
  })
  check("resolve -> 200", resolve.status === 200, `got ${resolve.status} ${JSON.stringify(resolve.body)}`)

  const notif = await prisma.notification.findFirst({
    where: { userId: alice.id, type: "REPORT_RESOLVED" },
    orderBy: { createdAt: "desc" },
    select: { id: true, message: true, entityType: true, entityId: true, actorId: true },
  })
  check("the reporter got exactly one new REPORT_RESOLVED notification",
    (await prisma.notification.count({ where: { userId: alice.id, type: "REPORT_RESOLVED" } }))
      === notifBefore + 1)
  check("the notification carries the moderator's words", !!notif?.message.includes("We removed the listing"),
    String(notif?.message))
  check("the notification does NOT name the moderator (harassment safety)", notif?.actorId === null,
    `actorId is ${notif?.actorId}`)
  check("the notification points back at the report", notif?.entityId === reportId)
  console.log(`  Reporter sees: "${notif?.message}"`)

  const resolvedRow = await prisma.report.findUnique({
    where: { id: reportId },
    select: { status: true, openKey: true, resolvedById: true, resolvedAt: true, resolutionNote: true },
  })
  check("report status ACTIONED", resolvedRow?.status === "ACTIONED")
  check("openKey nulled, so the reporter may report this target again later",
    resolvedRow?.openKey === null)
  check("resolvedBy recorded", resolvedRow?.resolvedById === mod.id)
  check("resolvedAt recorded", resolvedRow?.resolvedAt !== null)

  // Re-resolving is refused: it would fire a second notification and overwrite
  // the first decision with no trace.
  const reResolve = await POST(`/api/admin/reports/${reportId}/resolve`, tMod,
    { action: "dismissed", note: "changed my mind" })
  check("re-resolving a resolved report -> 409", reResolve.status === 409, `got ${reResolve.status}`)

  // Now the slot is free, the same reporter can file again against that target.
  const refile = await POST("/api/v1/reports", tAlice,
    { targetType: "listing", targetId: malloryItem.id, category: "spam", notes: "it is back" })
  check("after resolution the same reporter CAN report the same target again -> 200",
    refile.status === 200, `got ${refile.status} ${JSON.stringify(refile.body)}`)

  // ═══════════════════════════════════════════════════════════════════════════
  head("9  No route can grant a role (no promotion endpoint exists)")

  // Static check: nothing under src/app/api writes User.role.
  const offenders: string[] = []
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith(".ts")) {
        const src = readFileSync(full, "utf8")
        // A route that both parses `role` from input and writes it back.
        if (/\brole\s*:\s*(body|parsed|input|data)\./.test(src)) offenders.push(full)
        if (/user\.update[\s\S]{0,200}\brole\s*:/.test(src)) offenders.push(full)
      }
    }
  }
  walk(join(process.cwd(), "src", "app", "api"))
  check("no API route writes User.role", offenders.length === 0, offenders.join(", "))

  // Dynamic check: the closest route to a promotion endpoint rejects the field.
  const escalate = await POST(`/api/admin/users/${carol.id}`, tAdmin,
    { action: "suspend", reason: "x", role: "ADMIN" })
  check("sending `role` to the user admin route -> 400 (strict schema rejects it)",
    escalate.status === 400, `got ${escalate.status} ${JSON.stringify(escalate.body)}`)
  const carolRow = await prisma.user.findUnique({ where: { id: carol.id }, select: { role: true } })
  check("and the role did not change", carolRow?.role === "USER", String(carolRow?.role))

  // ═══════════════════════════════════════════════════════════════════════════
  head("10  Unblocking restores what the block hid")

  const unblock = await DEL(`/api/v1/blocks/${mallory.id}`, tAlice)
  check("DELETE /api/v1/blocks/[id] -> 200", unblock.status === 200, `got ${unblock.status}`)
  const unblockAgain = await DEL(`/api/v1/blocks/${mallory.id}`, tAlice)
  check("unblocking twice -> 404 (not a silent success)", unblockAgain.status === 404,
    `got ${unblockAgain.status}`)

  // Alice's own listing comes back for Mallory... except Mallory is suspended,
  // so this is checked from Dave's side of his own block instead.
  const daveUnblock = await DEL(`/api/v1/blocks/${erin.id}`, tDave)
  check("mid-trade block can be lifted -> 200", daveUnblock.status === 200)
  const daveMsg = await POST("/api/messages", tDave, { receiverId: erin.id, content: "sorry" })
  check("messaging works again after unblock", daveMsg.status === 201, `got ${daveMsg.status}`)

  await invariant("at end")

  // ═══════════════════════════════════════════════════════════════════════════
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
