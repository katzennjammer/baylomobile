// Acceptance harness for owner.trustTier on /api/v1/home.
//
// The badge on every feed card claims something about a stranger's
// trustworthiness, and it now has to agree with the gates that will actually
// stop a trade. Three things are checked, in order of what would hurt most if
// it were wrong:
//
//   1. BATCHED == UNBATCHED. loadEffectiveTiers() answers for a whole page in
//      three aggregates; loadDebtorStanding() + getEffectiveTier() answers for
//      one user in three queries and is what every gate already trusts. They
//      are run against EVERY user in the database and compared. This is the
//      check that matters: the batched version reconstructs "completed trades"
//      by summing two groupBys, and a mistake there is silent and plausible.
//   2. The route actually ships it, over real HTTP with a real Bearer token,
//      non-null for every owner on the page, and equal to (1).
//   3. The drift is reported rather than asserted — User.totalTrades against
//      the real COMPLETED count — so the reason this field exists stays visible
//      in the output even after the data changes.
//
// Run (from baylo/, with a dev server on BASE):
//   npx tsx --env-file=.env scripts/verify-trust-tier.ts
import prisma from "../src/lib/prisma"
import { signAccessToken } from "../src/lib/auth-tokens"
import { loadDebtorStanding, loadEffectiveTiers } from "../src/lib/contracts"
import { getEffectiveTier, getTrustTier } from "../src/lib/reputation"

const BASE = process.env.ACCEPT_BASE ?? "http://127.0.0.1:3000"

let pass = 0,
  fail = 0
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}  ${detail}`)
  }
}

async function main() {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, rating: true, totalTrades: true },
    orderBy: { createdAt: "asc" },
  })
  console.log(`\n${users.length} users\n`)

  // ── 1 ── the batched loader against the one the gates use ──────────────────
  console.log("1. loadEffectiveTiers() vs loadDebtorStanding() + getEffectiveTier()")
  const batched = await loadEffectiveTiers(prisma, users)

  for (const u of users) {
    const standing = await loadDebtorStanding(prisma, u.id)
    const authoritative = getEffectiveTier(standing.completedTrades, u.rating, {
      lifetimeDefaults: standing.lifetimeDefaults,
      hasUnsettledDefault: standing.hasUnsettledDefault,
    })
    check(
      `${u.name} -> ${batched.get(u.id)}`,
      batched.get(u.id) === authoritative,
      `batched=${batched.get(u.id)} authoritative=${authoritative} ` +
        `(trades=${standing.completedTrades} rating=${u.rating} ` +
        `defaults=${standing.lifetimeDefaults} unsettled=${standing.hasUnsettledDefault})`,
    )
  }

  // ── 2 ── the wire ──────────────────────────────────────────────────────────
  console.log("\n2. GET /api/v1/home ships owner.trustTier")
  const viewer = users[0]
  if (!viewer) {
    console.log("  SKIP  no users")
  } else {
    const token = await signAccessToken(viewer.id)
    const res = await fetch(`${BASE}/api/v1/home`, {
      headers: { authorization: `Bearer ${token}` },
    })
    check("200", res.status === 200, `got ${res.status}`)

    if (res.status === 200) {
      const body = await res.json()
      const feed: { owner: { id: string; name: string; trustTier: string | null } }[] =
        body?.data?.feed ?? []
      check("feed is non-empty", feed.length > 0, `${feed.length} items`)

      const missing = feed.filter((i) => i.owner.trustTier === null)
      check(
        "every owner has a non-null trustTier",
        missing.length === 0,
        `${missing.length} null of ${feed.length}`,
      )

      for (const item of feed) {
        check(
          `wire tier for ${item.owner.name} = ${item.owner.trustTier}`,
          item.owner.trustTier === batched.get(item.owner.id),
          `wire=${item.owner.trustTier} expected=${batched.get(item.owner.id)}`,
        )
      }
    }
  }

  // ── 3 ── the drift, reported ───────────────────────────────────────────────
  // Not an assertion. The counter is allowed to be wrong; what must not happen
  // is a tier being computed from it. This prints the gap so that the reason
  // this whole field exists is visible in the harness output.
  console.log("\n3. User.totalTrades vs the real COMPLETED count (report only)")
  let drifted = 0
  for (const u of users) {
    const real = await prisma.tradeRequest.count({
      where: { status: "COMPLETED", OR: [{ senderId: u.id }, { receiverId: u.id }] },
    })
    if (real === u.totalTrades) continue
    drifted++
    const naive = getTrustTier(u.totalTrades, u.rating)
    const truth = batched.get(u.id)
    const note = naive === truth ? "same tier" : `TIER DIFFERS: naive=${naive} real=${truth}`
    console.log(
      `  drift  ${u.name}: totalTrades=${u.totalTrades} real=${real}  ${note}`,
    )
  }
  console.log(`  ${drifted} of ${users.length} users have a drifted counter`)

  console.log(`\n${pass} passed, ${fail} failed\n`)
  await prisma.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
