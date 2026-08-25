// Acceptance harness for item valuation.
//
// Drives the real routes over HTTP, per the house convention, and checks the
// claims the manuscript is going to make about them:
//
//   - a valuation response carries valuationSource, set to one of exactly two
//     values, and the Item it produces stores that value
//   - DETERMINISM: identical inputs return byte-identical output, twice
//   - condition CHANGES the number: same category, two conditions, two values
//   - a user override outside the allowed band is REJECTED with a 400
//   - an override inside the band is accepted and both numbers are stored
//   - one re-valuation per listing, then 409
//   - the old /api/ai/value path still answers, from the same model
//   - a per-path census of every Item in the database
//
// Run (from baylo/, with a dev server on BASE):
//   npx tsx --env-file=.env scripts/verify-valuation.ts
import prisma from "../src/lib/prisma"
import { signAccessToken } from "../src/lib/auth-tokens"
import {
  CONDITION_MULTIPLIERS,
  CATEGORY_BANDS,
  OVERRIDE_BAND_PCT,
  MIN_COMPARABLES,
  MAX_REVALUATIONS,
  valueItem,
  overrideBounds,
} from "../src/lib/valuation"

const BASE = process.env.ACCEPT_BASE ?? "http://127.0.0.1:3100"
const P = "zzval-"

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`) }
}

const show = (v: unknown) => JSON.stringify(v, null, 2)

// ── Fixtures ─────────────────────────────────────────────────────────────────

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: P } }, select: { id: true },
  })
  const ids = users.map((u) => u.id)
  if (!ids.length) return
  await prisma.leafTransaction.deleteMany({ where: { userId: { in: ids } } })
  await prisma.taskCompletion.deleteMany({ where: { userId: { in: ids } } })
  await prisma.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { actorId: { in: ids } }] } })
  await prisma.item.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
}

interface Api { status: number; body: Record<string, unknown> }

async function api(path: string, token: string, init?: RequestInit): Promise<Api> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> }
}

const post = (path: string, token: string, body: unknown) =>
  api(path, token, { method: "POST", body: JSON.stringify(body) })

/** A listing body with everything the create schema requires. */
const listing = (over: Record<string, unknown>) => ({
  title: `${P}item`,
  description: "harness fixture",
  category: "BOOKS",
  condition: "GOOD",
  images: [],
  ...over,
})

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Driving ${BASE}\n`)
  await cleanup()

  const user = await prisma.user.create({
    data: { name: "ZZ Valuer", email: `${P}u-${Date.now()}@example.local`, isVerified: true },
  })
  const token = await signAccessToken(user.id)

  // ── 0. The model's constants, stated once so the output is self-describing.
  console.log("0. model configuration")
  console.log(`     override band     ±${Math.round(OVERRIDE_BAND_PCT * 100)}%`)
  console.log(`     min comparables   ${MIN_COMPARABLES}`)
  console.log(`     max revaluations  ${MAX_REVALUATIONS}`)
  console.log(`     condition mult.   ${Object.entries(CONDITION_MULTIPLIERS).map(([k, v]) => `${k}=${v}`).join("  ")}`)

  // ── 1. Auth.
  console.log("\n1. auth")
  const anon = await fetch(`${BASE}/api/v1/valuation?category=BOOKS&condition=GOOD`)
  check("401 without a token", anon.status === 401, `${anon.status}`)

  // ── 2. A real valuation response.
  console.log("\n2. a real valuation response")
  const v1 = await api("/api/v1/valuation?category=ELECTRONICS&condition=GOOD", token)
  console.log(show(v1.body))
  const d1 = v1.body.data as Record<string, unknown> | null
  check("200", v1.status === 200, `${v1.status}`)
  check("valuationSource is set",
    d1?.valuationSource === "comparables" || d1?.valuationSource === "category_band",
    String(d1?.valuationSource))
  check("carries a suggestion, a range and an allowed band",
    typeof d1?.suggestedLeaves === "number" && !!d1?.allowed && typeof d1?.basis === "string")

  // ── 3. Determinism. The headline claim.
  console.log("\n3. determinism — same inputs twice")
  const runA = await api("/api/v1/valuation?category=BIKES&condition=FAIR", token)
  const runB = await api("/api/v1/valuation?category=BIKES&condition=FAIR", token)
  console.log("  run 1:", JSON.stringify(runA.body.data))
  console.log("  run 2:", JSON.stringify(runB.body.data))
  check("two runs are byte-identical",
    JSON.stringify(runA.body.data) === JSON.stringify(runB.body.data))

  // The pure model, hammered. The route is deterministic given the database;
  // the function is deterministic full stop, and that is the property the
  // manuscript's "objective and consistent" claim actually rests on.
  const comps = [
    { valueLeaves: 900, condition: "NEW" },
    { valueLeaves: 300, condition: "POOR" },
    { valueLeaves: 500, condition: "GOOD" },
    { valueLeaves: 410, condition: "FAIR" },
  ]
  const first = JSON.stringify(valueItem({ category: "GAMING", condition: "LIKE_NEW", comparables: comps }))
  let stable = true
  for (let i = 0; i < 500; i++) {
    if (JSON.stringify(valueItem({ category: "GAMING", condition: "LIKE_NEW", comparables: comps })) !== first) stable = false
  }
  check("valueItem() is identical over 500 calls", stable)
  console.log(`     ${first}`)

  // ── 4. Condition changes the value.
  console.log("\n4. condition affects value — same category, different condition")
  const mint    = await post("/api/items", token, listing({ title: `${P}mint`, category: "ELECTRONICS", condition: "NEW" }))
  const cracked = await post("/api/items", token, listing({ title: `${P}cracked`, category: "ELECTRONICS", condition: "POOR" }))
  const mintV    = mint.body.valueLeaves as number
  const crackedV = cracked.body.valueLeaves as number
  console.log(`  NEW  ELECTRONICS -> valueLeaves=${mintV} suggested=${mint.body.suggestedLeaves} source=${mint.body.valuationSource}`)
  console.log(`  POOR ELECTRONICS -> valueLeaves=${crackedV} suggested=${cracked.body.suggestedLeaves} source=${cracked.body.valuationSource}`)
  check("both created", mint.status === 201 && cracked.status === 201, `${mint.status}/${cracked.status}`)
  check("the two values differ", mintV !== crackedV, `${mintV} vs ${crackedV}`)
  check("NEW is worth more than POOR", mintV > crackedV, `${mintV} <= ${crackedV}`)

  const [lo, hi] = CATEGORY_BANDS.ELECTRONICS
  const expectNew  = Math.floor(((lo + hi) / 2) * CONDITION_MULTIPLIERS.NEW + 0.5)
  const expectPoor = Math.floor(((lo + hi) / 2) * CONDITION_MULTIPLIERS.POOR + 0.5)
  check("NEW matches the band midpoint × its multiplier", mintV === expectNew, `${mintV} != ${expectNew}`)
  check("POOR matches the band midpoint × its multiplier", crackedV === expectPoor, `${crackedV} != ${expectPoor}`)

  // ── 5. valuationSource is persisted, not just returned.
  console.log("\n5. valuationSource is stored on the Item")
  const mintRow = await prisma.item.findUnique({
    where: { id: mint.body.id as string },
    select: { valueLeaves: true, suggestedLeaves: true, valuationSource: true, revaluationCount: true },
  })
  console.log(" ", show(mintRow))
  check("row carries valuationSource", mintRow?.valuationSource === mint.body.valuationSource)
  check("row carries suggestedLeaves", mintRow?.suggestedLeaves === mint.body.suggestedLeaves)
  check("stored suggestion equals stored value when unoverridden",
    mintRow?.valueLeaves === mintRow?.suggestedLeaves)

  // ── 6. The override band.
  console.log("\n6. user override")
  const bandRef = await api("/api/v1/valuation?category=BOOKS&condition=GOOD", token)
  const suggested = (bandRef.body.data as { suggestedLeaves: number }).suggestedLeaves
  const allowed = overrideBounds(suggested)
  console.log(`  BOOKS/GOOD suggestion ${suggested}, allowed ${allowed.min}–${allowed.max}`)

  const inBand = Math.round((suggested + allowed.max) / 2)
  const okRes = await post("/api/items", token, listing({ title: `${P}inband`, valueLeaves: inBand }))
  console.log(`  in-band ${inBand} -> ${okRes.status}`)
  check("an in-band override is accepted", okRes.status === 201, `${okRes.status}`)
  check("the override is what got stored", okRes.body.valueLeaves === inBand, `${okRes.body.valueLeaves}`)
  check("the suggestion is stored ALONGSIDE it, not overwritten",
    okRes.body.suggestedLeaves === suggested, `${okRes.body.suggestedLeaves} != ${suggested}`)

  const tooHigh = allowed.max + 1
  const highRes = await post("/api/items", token, listing({ title: `${P}toohigh`, valueLeaves: tooHigh }))
  console.log(`\n  OUT OF BAND (${tooHigh}) -> HTTP ${highRes.status}`)
  console.log(show(highRes.body))
  check("an over-band override is rejected with 400", highRes.status === 400, `${highRes.status}`)
  check("the 400 names the suggestion and the bounds",
    highRes.body.suggestedLeaves === suggested && !!highRes.body.allowed)

  const tooLow = Math.max(1, allowed.min - 1)
  const lowRes = await post("/api/items", token, listing({ title: `${P}toolow`, valueLeaves: tooLow }))
  console.log(`  UNDER BAND (${tooLow}) -> HTTP ${lowRes.status}`)
  check("an under-band override is rejected with 400", lowRes.status === 400, `${lowRes.status}`)

  check("nothing out of band reached the database",
    (await prisma.item.count({ where: { userId: user.id, title: { in: [`${P}toohigh`, `${P}toolow`] } } })) === 0)

  // ── 7. Edits are bounded too, and re-price on a condition change.
  console.log("\n7. edit path")
  const editId = okRes.body.id as string
  const badEdit = await api(`/api/items/${editId}`, token, {
    method: "PATCH", body: JSON.stringify({ valueLeaves: allowed.max * 4 }),
  })
  check("PATCH with an out-of-band value is 400", badEdit.status === 400, `${badEdit.status}`)

  const condEdit = await api(`/api/items/${editId}`, token, {
    method: "PATCH", body: JSON.stringify({ condition: "POOR", valueLeaves: null }),
  })
  console.log(`  BOOKS GOOD->POOR: value ${okRes.body.valueLeaves} -> ${condEdit.body.valueLeaves}, source ${condEdit.body.valuationSource}`)
  check("a condition edit re-prices the listing", condEdit.status === 200 &&
    condEdit.body.valueLeaves !== okRes.body.valueLeaves, `${condEdit.status} ${condEdit.body.valueLeaves}`)

  const titleOnly = await api(`/api/items/${editId}`, token, {
    method: "PATCH", body: JSON.stringify({ title: `${P}renamed` }),
  })
  check("a title-only edit does NOT re-price",
    titleOnly.body.valueLeaves === condEdit.body.valueLeaves,
    `${titleOnly.body.valueLeaves} != ${condEdit.body.valueLeaves}`)

  // ── 8. One re-valuation per listing.
  console.log("\n8. re-valuation budget")
  const rv1 = await api(`/api/v1/valuation?category=BOOKS&condition=POOR&itemId=${editId}`, token)
  const rv2 = await api(`/api/v1/valuation?category=BOOKS&condition=POOR&itemId=${editId}`, token)
  console.log(`  first re-valuation  -> ${rv1.status}`)
  console.log(`  second re-valuation -> ${rv2.status}  ${JSON.stringify(rv2.body.error)}`)
  check("the first re-valuation succeeds", rv1.status === 200, `${rv1.status}`)
  check("the second is refused with 409", rv2.status === 409, `${rv2.status}`)
  check("the counter reflects exactly one spend",
    (await prisma.item.findUnique({ where: { id: editId }, select: { revaluationCount: true } }))?.revaluationCount === 1)

  const foreign = await api(`/api/v1/valuation?category=BOOKS&condition=GOOD&itemId=${mint.body.id}x`, token)
  check("an unknown itemId is 404", foreign.status === 404, `${foreign.status}`)

  // ── 8b. The comparables path, over HTTP.
  //
  // No live category has reached MIN_COMPARABLES yet — the statistical branch
  // has been armed and never fired, which is precisely the gap this harness
  // exists to close. Three settled, priced PLANTS items are created so the
  // branch is exercised end to end through the real route rather than only
  // through the pure function, and they are torn down with the rest of the
  // fixtures. Their conditions differ on purpose: the path normalises each
  // comparable by its own multiplier before averaging, and three identical
  // conditions would not prove that happened.
  console.log("\n8b. the comparables path, end to end")
  const seeded = [
    { condition: "NEW" as const,      valueLeaves: 280 },
    { condition: "GOOD" as const,     valueLeaves: 200 },
    { condition: "POOR" as const,     valueLeaves: 90  },
  ]
  for (const [i, sIt] of seeded.entries()) {
    await prisma.item.create({
      data: {
        title: `${P}comp-${i}`, description: "settled comparable", images: "[]",
        category: "PLANTS", condition: sIt.condition, valueLeaves: sIt.valueLeaves,
        status: "OWNED", userId: user.id,
      },
    })
  }
  console.log(`  seeded ${seeded.length} settled PLANTS items: ` +
    seeded.map((x) => `${x.valueLeaves}@${x.condition}`).join(", "))

  const compA = await api("/api/v1/valuation?category=PLANTS&condition=GOOD", token)
  const compB = await api("/api/v1/valuation?category=PLANTS&condition=GOOD", token)
  console.log(show(compA.body.data))
  const cd = compA.body.data as { valuationSource: string; sampleSize: number; suggestedLeaves: number }
  check("the route now takes the comparables path", cd.valuationSource === "comparables", cd.valuationSource)
  check(`sampleSize is ${MIN_COMPARABLES}`, cd.sampleSize === MIN_COMPARABLES, String(cd.sampleSize))
  check("still deterministic on the comparables path",
    JSON.stringify(compA.body.data) === JSON.stringify(compB.body.data))

  // Condition normalisation: 280/1.40 = 200, 200/1.00 = 200, 90/0.45 = 200.
  // All three normalise to exactly 200, so a GOOD-condition suggestion must be
  // 200 — if the raw values were averaged instead it would be 190.
  check("comparables are normalised by their own condition before averaging",
    cd.suggestedLeaves === 200, `${cd.suggestedLeaves} (raw mean would be 190)`)

  const compPoor = await api("/api/v1/valuation?category=PLANTS&condition=POOR", token)
  const cp = (compPoor.body.data as { suggestedLeaves: number; valuationSource: string })
  console.log(`  PLANTS/GOOD -> ${cd.suggestedLeaves}   PLANTS/POOR -> ${cp.suggestedLeaves}`)
  check("condition still moves the number on the comparables path",
    cp.suggestedLeaves === 90 && cp.valuationSource === "comparables", `${cp.suggestedLeaves}`)

  // And an item created in that category records the comparables path.
  const compItem = await post("/api/items", token, listing({ title: `${P}from-comps`, category: "PLANTS", condition: "GOOD" }))
  console.log(`  new PLANTS listing -> value=${compItem.body.valueLeaves} source=${compItem.body.valuationSource}`)
  check("a listing valued this way stores valuationSource=comparables",
    compItem.body.valuationSource === "comparables", String(compItem.body.valuationSource))

  // ── 9. The deprecated path still answers, from the same model.
  console.log("\n9. legacy /api/ai/value")
  const legacy = await api("/api/ai/value?category=ELECTRONICS&condition=NEW", token)
  const modern = await api("/api/v1/valuation?category=ELECTRONICS&condition=NEW", token)
  const mdata = modern.body.data as { suggestedLeaves: number; valuationSource: string }
  console.log(" ", JSON.stringify(legacy.body))
  check("the old path still returns 200", legacy.status === 200, `${legacy.status}`)
  check("it agrees with v1 on the number", legacy.body.suggestedLeaves === mdata.suggestedLeaves,
    `${legacy.body.suggestedLeaves} != ${mdata.suggestedLeaves}`)
  check("it agrees with v1 on the path taken", legacy.body.valuationSource === mdata.valuationSource)
  check("it is marked deprecated", typeof legacy.body.deprecated === "string")

  // ── 10. The census.
  console.log("\n10. how every Item in the database was valued")
  const census = await prisma.item.groupBy({
    by: ["valuationSource"], _count: { _all: true },
  })
  const total = await prisma.item.count()
  for (const row of census.sort((a, b) => (b._count._all - a._count._all))) {
    const name = row.valuationSource ?? "(pre-model — predates the valuation system)"
    console.log(`  ${String(row._count._all).padStart(4)}  ${name}`)
  }
  console.log(`  ${String(total).padStart(4)}  TOTAL`)
  check("every item falls in exactly one bucket",
    census.reduce((s, r) => s + r._count._all, 0) === total)

  await cleanup()

  console.log("\n── census after harness teardown (real listings only) ──")
  for (const row of await prisma.item.groupBy({ by: ["valuationSource"], _count: { _all: true } })) {
    console.log(`  ${String(row._count._all).padStart(4)}  ${row.valuationSource ?? "(pre-model)"}`)
  }

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
