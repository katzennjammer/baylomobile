// Acceptance harness for /api/v1.
//
// Drives the real routes over HTTP, per the house convention. Checks the things
// that were actually asked for:
//
//   - every endpoint returns its whole screen payload in ONE call
//   - the REAL SQL query count per endpoint, measured against MariaDB's own
//     Com_select counter rather than counted by eye from the source
//   - 401 without auth, 200 with a Bearer token and no cookie
//   - a non-participant gets coarsened coordinates and a null address
//   - cursor pagination: page 1, page 2, no duplicates, no gaps
//   - the Leaf invariant, signed over all ledger rows
//
// Run (from baylo/, with a dev server on BASE):
//   npx tsx --env-file=.env scripts/verify-v1-endpoints.ts
import prisma from "../src/lib/prisma"
import { signAccessToken } from "../src/lib/auth-tokens"

const BASE = process.env.ACCEPT_BASE ?? "http://127.0.0.1:3100"
const P = "zzv1-"

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`) }
}

// ── Query counting ───────────────────────────────────────────────────────────
// Com_select counts SELECTs server-wide. The harness is the only client, so the
// delta across one request is that request's SELECT count, minus the cost of
// the two counter reads themselves — measured rather than assumed.

async function comSelect(): Promise<number> {
  const rows = await prisma.$queryRaw<{ Variable_name: string; Value: string }[]>`
    SHOW GLOBAL STATUS LIKE 'Com_select'
  `
  return Number(rows[0]?.Value ?? 0)
}

let probeOverhead = 0
async function calibrate() {
  const a = await comSelect()
  const b = await comSelect()
  probeOverhead = b - a
}

interface Measured { status: number; body: unknown; queries: number }

async function measure(path: string, token: string | null): Promise<Measured> {
  const before = await comSelect()
  const res = await fetch(`${BASE}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  const body = await res.json().catch(() => null)
  const after = await comSelect()
  return { status: res.status, body, queries: Math.max(0, after - before - probeOverhead) }
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
  await prisma.swapConfirmationCode.deleteMany({ where: { tradeId: { in: tradeIds } } })
  await prisma.message.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } })
  await prisma.review.deleteMany({ where: { tradeId: { in: tradeIds } } })
  await prisma.tradeRequest.deleteMany({ where: { id: { in: tradeIds } } })
  await prisma.leafTransaction.deleteMany({ where: { userId: { in: ids } } })
  await prisma.taskCompletion.deleteMany({ where: { userId: { in: ids } } })
  await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { actorId: { in: ids } }] } })
  await prisma.offer.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } })
  await prisma.follow.deleteMany({ where: { OR: [{ followerId: { in: ids } }, { followeeId: { in: ids } }] } })
  await prisma.postLike.deleteMany({ where: { userId: { in: ids } } })
  await prisma.item.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

const PICKUP = { lat: 10.316742891, lng: 123.917338712, address: "12 Real Street, Mandaue" }

async function seed() {
  const owner = await prisma.user.create({
    data: { name: "ZZ Owner", email: `${P}owner-${Date.now()}@example.local`, isVerified: true, location: "Mandaue" },
  })
  const viewer = await prisma.user.create({
    data: { name: "ZZ Viewer", email: `${P}viewer-${Date.now()}@example.local`, isVerified: true, leaves: 0 },
  })

  // An item with a precise pickup point, owned by someone the viewer has no
  // trade with — the exact case the coarsening rule exists for.
  const withPickup = await prisma.item.create({
    data: {
      title: `${P}pickup-item`, description: "has a real address", images: '["https://example.test/a.jpg"]',
      category: "BOOKS", condition: "GOOD", valueLeaves: 40, userId: owner.id,
      pickupLat: PICKUP.lat, pickupLng: PICKUP.lng, pickupAddress: PICKUP.address,
    },
  })

  // Enough items to paginate through.
  for (let i = 0; i < 6; i++) {
    await prisma.item.create({
      data: {
        title: `${P}feed-${i}`, description: "d", images: "[]",
        category: "CLOTHING", condition: "GOOD", valueLeaves: 10 + i, userId: owner.id,
      },
    })
  }

  await prisma.message.create({
    data: { content: "hello there", senderId: owner.id, receiverId: viewer.id },
  })

  return { owner, viewer, withPickup }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Driving ${BASE}\n`)
  await cleanup()
  const { owner, viewer, withPickup } = await seed()
  const token = await signAccessToken(viewer.id)
  await calibrate()

  // 1. Every route: 401 without auth, 200 with Bearer and no cookie.
  console.log("1. auth on every /api/v1 route")
  const routes = [
    "/api/v1/home",
    "/api/v1/browse",
    "/api/v1/trades",
    "/api/v1/messages/conversations",
    "/api/v1/profile/me",
    `/api/v1/profile/${owner.id}`,
    `/api/v1/items/${withPickup.id}`,
  ]
  for (const r of routes) {
    const anon = await fetch(`${BASE}${r}`)
    const anonBody = await anon.json().catch(() => null) as { error?: { code?: string } } | null
    const auth = await fetch(`${BASE}${r}`, { headers: { authorization: `Bearer ${token}` } })
    check(
      `${r}  401 anon / 200 bearer`,
      anon.status === 401 && auth.status === 200 && anonBody?.error?.code === "UNAUTHENTICATED",
      `anon=${anon.status} bearer=${auth.status} code=${anonBody?.error?.code}`,
    )
  }

  // 2. Envelope shape and real query counts.
  console.log("\n2. envelope + REAL query count per endpoint")
  console.log(`   (Com_select delta, probe overhead ${probeOverhead} calibrated out)`)
  const counts: Record<string, number> = {}
  for (const r of routes) {
    const m = await measure(r, token)
    const b = m.body as { data?: unknown; error?: unknown; meta?: unknown } | null
    const enveloped = !!b && "data" in b && "error" in b && "meta" in b && b.error === null && b.data !== null
    counts[r] = m.queries
    check(`${r}  envelope { data, error, meta }`, enveloped, JSON.stringify(b)?.slice(0, 120))
    console.log(`         queries: ${m.queries}`)
  }

  // 3. Each endpoint carries its whole screen in one call.
  console.log("\n3. whole-screen payloads")
  const home = (await measure("/api/v1/home", token)).body as { data: Record<string, unknown> }
  check("home has viewer/unread/feed/trending/matches",
    ["viewer", "unread", "feed", "trending", "matches"].every((k) => k in home.data))
  const browse = (await measure("/api/v1/browse", token)).body as { data: Record<string, unknown> }
  check("browse has items + facets", ["items", "facets"].every((k) => k in browse.data))
  const tr = (await measure("/api/v1/trades", token)).body as { data: Record<string, unknown> }
  check("trades has viewer/pendingIncoming/trades/offers",
    ["viewer", "pendingIncoming", "trades", "offers"].every((k) => k in tr.data))
  const me = (await measure("/api/v1/profile/me", token)).body as { data: Record<string, unknown> }
  check("profile/me has user/counts/items/reviews/tasks/impact",
    ["user", "counts", "items", "reviews", "tasks", "impact"].every((k) => k in me.data))

  // 4. Pickup: a non-participant must get the coarsened form.
  console.log("\n4. pickup for a NON-PARTICIPANT")
  const detail = (await measure(`/api/v1/items/${withPickup.id}`, token)).body as {
    data: { item: { pickup: { lat: number; lng: number; address: string | null; precise: boolean } } }
  }
  const pk = detail.data.item.pickup
  console.log("   response .data.item.pickup:")
  console.log("  ", JSON.stringify(pk))
  console.log(`   (real values were lat=${PICKUP.lat} lng=${PICKUP.lng} address=${JSON.stringify(PICKUP.address)})`)
  check("address is null", pk.address === null)
  check("precise is false", pk.precise === false)
  check("lat coarsened to 2dp", pk.lat === Math.round(PICKUP.lat * 100) / 100, `${pk.lat}`)
  check("lng coarsened to 2dp", pk.lng === Math.round(PICKUP.lng * 100) / 100, `${pk.lng}`)
  check("no raw pickup columns anywhere in the body",
    !JSON.stringify(detail).includes("pickupLat") &&
    !JSON.stringify(detail).includes("pickupAddress") &&
    !JSON.stringify(detail).includes(PICKUP.address))

  // D3: wantedItems must not appear.
  check("no wantedItems key in a v1 item (D3)",
    !JSON.stringify(detail).includes("wantedItems"))

  // 5. Owner DOES get the precise form — the rule is a filter, not a blanket.
  console.log("\n5. pickup for the OWNER")
  const ownerToken = await signAccessToken(owner.id)
  const ownerView = (await measure(`/api/v1/items/${withPickup.id}`, ownerToken)).body as {
    data: { item: { pickup: { lat: number; address: string | null; precise: boolean } } }
  }
  const opk = ownerView.data.item.pickup
  console.log("  ", JSON.stringify(opk))
  check("owner sees precise:true", opk.precise === true)
  check("owner sees the real address", opk.address === PICKUP.address)
  check("owner sees full-precision lat", opk.lat === PICKUP.lat, `${opk.lat}`)

  // 6. Cursor pagination on the feed.
  console.log("\n6. cursor pagination on /api/v1/home feed")
  const p1 = (await measure("/api/v1/home?limit=3", token)).body as {
    data: { feed: { id: string }[] }; meta: { nextCursor: string | null }
  }
  check("page 1 returned 3", p1.data.feed.length === 3, `${p1.data.feed.length}`)
  check("page 1 has a nextCursor", !!p1.meta.nextCursor)
  const p2 = (await measure(
    `/api/v1/home?limit=3&cursor=${encodeURIComponent(p1.meta.nextCursor ?? "")}`, token,
  )).body as { data: { feed: { id: string }[] }; meta: { nextCursor: string | null } }
  check("page 2 returned rows", p2.data.feed.length > 0, `${p2.data.feed.length}`)
  const ids1 = p1.data.feed.map((i) => i.id)
  const ids2 = p2.data.feed.map((i) => i.id)
  const overlap = ids1.filter((i) => ids2.includes(i))
  check("no duplicates across pages", overlap.length === 0, overlap.join(","))

  // No gaps: pages 1+2 must equal the first six of an unpaginated read.
  const big = (await measure("/api/v1/home?limit=50", token)).body as {
    data: { feed: { id: string }[] }
  }
  const expected = big.data.feed.slice(0, ids1.length + ids2.length).map((i) => i.id)
  check("no gaps — pages 1+2 match a single larger read",
    JSON.stringify([...ids1, ...ids2]) === JSON.stringify(expected),
    `paged=${[...ids1, ...ids2].join(",")} single=${expected.join(",")}`)

  // 7. Validation: unknown params rejected, bad cursor rejected, limit capped.
  console.log("\n7. query validation")
  const unknown = await fetch(`${BASE}/api/v1/browse?catgeory=BOOKS`, {
    headers: { authorization: `Bearer ${token}` },
  })
  const ub = await unknown.json() as { error?: { code?: string; message?: string } }
  check("unknown param rejected with 400", unknown.status === 400 && ub.error?.code === "VALIDATION_ERROR",
    `${unknown.status} ${ub.error?.message}`)
  const badCursor = await fetch(`${BASE}/api/v1/home?cursor=not-a-cursor`, {
    headers: { authorization: `Bearer ${token}` },
  })
  check("malformed cursor rejected with 400", badCursor.status === 400, `${badCursor.status}`)
  const overLimit = await fetch(`${BASE}/api/v1/home?limit=500`, {
    headers: { authorization: `Bearer ${token}` },
  })
  check("limit over cap rejected with 400", overLimit.status === 400, `${overLimit.status}`)
  const nearestNoCoords = await fetch(`${BASE}/api/v1/browse?sort=nearest`, {
    headers: { authorization: `Bearer ${token}` },
  })
  check("sort=nearest without lat/lng is 400, not a silent fallback",
    nearestNoCoords.status === 400, `${nearestNoCoords.status}`)

  // 8. 404 semantics.
  console.log("\n8. not-found semantics")
  const ghostItem = await fetch(`${BASE}/api/v1/items/cmdoesnotexist000000`, {
    headers: { authorization: `Bearer ${token}` },
  })
  check("absent item is 404", ghostItem.status === 404, `${ghostItem.status}`)
  const ghostProfile = await fetch(`${BASE}/api/v1/profile/cmdoesnotexist000000`, {
    headers: { authorization: `Bearer ${token}` },
  })
  check("absent profile is 404", ghostProfile.status === 404, `${ghostProfile.status}`)

  // 9. The invariant, in its corrected form.
  console.log("\n9. Leaf invariant")
  const [u, all, pos] = await Promise.all([
    prisma.user.aggregate({ _sum: { leaves: true } }),
    prisma.leafTransaction.aggregate({ _sum: { amount: true } }),
    prisma.leafTransaction.aggregate({ _sum: { amount: true }, where: { amount: { gt: 0 } } }),
  ])
  const leaves = u._sum.leaves ?? 0
  check("SUM(User.leaves) == SUM(LeafTransaction.amount)  [signed, all rows]",
    leaves === (all._sum.amount ?? 0), `leaves=${leaves} ledger=${all._sum.amount}`)
  console.log(`     positive-only reads ${pos._sum.amount} — equal only while no Leaves trade has settled`)

  console.log("\n── query counts ──")
  for (const [r, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(2)}  ${r}`)

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
