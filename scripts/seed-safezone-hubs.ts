// Seed the Safe-Zone Hub table.
//
// Run (from baylo/):
//   npx tsx --env-file=.env scripts/seed-safezone-hubs.ts          # apply
//   npx tsx --env-file=.env scripts/seed-safezone-hubs.ts --dry    # print only
//
// The hub list and its coordinate provenance live in ./safezone-hub-data.ts.
// Read the header there before changing any number in it.
//
// ── THIS SCRIPT WILL NOT SEED AN UNVERIFIED COORDINATE ──────────────────────
//
// A hub whose `coords` is null is SKIPPED and reported, never inserted with a
// placeholder, a zero, or a remembered guess. That is the whole safety property
// and it is enforced here rather than trusted to whoever edits the data file:
// these pins are where two strangers are told to stand, and the previous set of
// coordinates was confident, plausible, and up to 2.8 km wrong.
//
// The consequence is deliberate: a partial hub list is a smaller feature, and a
// hub list with wrong pins in it is a broken one.
//
// AS OF 2026-08-29 THIS SEEDS ALL 22. That is not the gate loosening — it is
// the gate having done its job. The 13 blanks stayed blank until a person went
// and looked at each place, and the check then also overturned 9 coordinates
// the geocoder had returned as "EXACT", three of them by more than a kilometre.
// Had those 13 been filled with plausible numbers on the first pass, nobody
// would ever have had cause to re-examine the 9.
//
// ── IDEMPOTENT ──────────────────────────────────────────────────────────────
//
// Every hub carries an explicit slug id instead of taking the schema's cuid()
// default, and this upserts on it. So re-running never duplicates a hub (this
// file WILL be re-run as the 13 blanks get filled in), the ids are identical
// across environments, and `szh-mnd-parkmall` in a log line is readable where a
// cuid is not.
//
// WHAT AN UPSERT HERE DOES NOT TOUCH: `isActive`. A hub an admin deactivated
// stays deactivated across a re-seed — set on INSERT only, never on update. A
// re-seed must not quietly re-open a place we took down.

import prisma from "../src/lib/prisma"
import { SAFE_ZONE_HUB_SEED, type SeedHub } from "./safezone-hub-data"

const DRY = process.argv.includes("--dry")

function line(hub: SeedHub) {
  const c = hub.coords
  console.log(`  ${hub.type.padEnd(15)} ${hub.name}`)
  console.log(`  ${" ".repeat(15)} ${hub.address}`)
  console.log(`  ${" ".repeat(15)} ${hub.landmark}`)
  if (c) {
    console.log(`  ${" ".repeat(15)} geo:${c.latitude},${c.longitude}   [${c.source}, ${c.retrievedAt}]`)
    if (c.displayName) console.log(`  ${" ".repeat(15)} matched: ${c.displayName}`)
  } else {
    console.log(`  ${" ".repeat(15)} NO VERIFIED COORDINATE — will not be seeded`)
  }
  console.log("")
}

async function main() {
  const ids = new Set(SAFE_ZONE_HUB_SEED.map((h) => h.id))
  if (ids.size !== SAFE_ZONE_HUB_SEED.length) {
    throw new Error("duplicate hub id in SAFE_ZONE_HUB_SEED")
  }

  const ready = SAFE_ZONE_HUB_SEED.filter((h) => h.coords !== null)
  const blocked = SAFE_ZONE_HUB_SEED.filter((h) => h.coords === null)

  const byCity = new Map<string, SeedHub[]>()
  for (const h of ready) byCity.set(h.city, [...(byCity.get(h.city) ?? []), h])

  for (const [city, hubs] of byCity) {
    console.log(`\n── ${city} — ${hubs.length} ready ${"─".repeat(Math.max(0, 40 - city.length))}`)
    for (const h of hubs) line(h)
  }

  if (blocked.length > 0) {
    console.log(`\n${"═".repeat(76)}`)
    console.log(`  HELD BACK — ${blocked.length} hubs have no verified coordinate`)
    console.log(`  These are NOT seeded. Nothing was guessed for them.`)
    console.log(`${"═".repeat(76)}\n`)
    for (const h of blocked) console.log(`  ${h.city.padEnd(16)} ${h.name}`)
    console.log("")
  }

  if (DRY) {
    console.log(`  --dry: ${ready.length} would be written, ${blocked.length} held back.\n`)
    await prisma.$disconnect()
    return
  }

  let created = 0
  let updated = 0
  for (const h of ready) {
    // Non-null asserted safely: `ready` is filtered on coords !== null.
    const c = h.coords!
    const existing = await prisma.safeZoneHub.findUnique({
      where: { id: h.id },
      select: { id: true },
    })
    await prisma.safeZoneHub.upsert({
      where: { id: h.id },
      create: {
        id: h.id,
        name: h.name,
        type: h.type,
        address: h.address,
        latitude: c.latitude,
        longitude: c.longitude,
        city: h.city,
        landmark: h.landmark,
        // INSERT only. See the header.
        isActive: true,
      },
      update: {
        name: h.name,
        type: h.type,
        address: h.address,
        latitude: c.latitude,
        longitude: c.longitude,
        city: h.city,
        landmark: h.landmark,
        // isActive deliberately absent.
      },
    })
    if (existing) updated++
    else created++
  }

  const total = await prisma.safeZoneHub.count()
  const active = await prisma.safeZoneHub.count({ where: { isActive: true } })
  console.log(`  seeded: ${created} created, ${updated} updated, ${blocked.length} held back`)
  console.log(`  table:  ${total} hubs, ${active} active\n`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
