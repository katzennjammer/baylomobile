/**
 * One-time backfill: recompute dHash for every item that has images stored,
 * replacing any old aHash values so all existing listings are protected by
 * the two-stage duplicate detection.
 *
 * Run from the project root:
 *   npx tsx --env-file=.env scripts/rehash-items.ts
 *
 * --env-file loads DATABASE_URL (and other vars) from .env without needing
 * the dotenv package. Safe to re-run — idempotent.
 */

// Import from the custom generator output path, NOT "@prisma/client"
// (schema.prisma: output = "../src/generated/prisma")
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaMariaDb } from "@prisma/adapter-mariadb"
import sharp from "sharp"

function parseDbUrl(url: string) {
  const u = new URL(url)
  return {
    host:     u.hostname,
    port:     u.port ? parseInt(u.port) : 3306,
    user:     u.username || undefined,
    password: u.password || undefined,
    database: u.pathname.slice(1) || undefined,
  }
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run with: npx tsx --env-file=.env scripts/rehash-items.ts")
  process.exit(1)
}

const adapter = new PrismaMariaDb(parseDbUrl(process.env.DATABASE_URL))
const prisma  = new PrismaClient({ adapter })

async function computeDHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pixels = Array.from(data as Uint8Array)
  const bits: string[] = []
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      bits.push(pixels[row * 9 + col] > pixels[row * 9 + col + 1] ? "1" : "0")
    }
  }
  return bits.join("")
}

async function main() {
  const items = await prisma.item.findMany({
    where:  { images: { not: "" } },
    select: { id: true, images: true },
  })

  console.log(`Found ${items.length} items to rehash…\n`)

  let updated = 0
  let skipped = 0
  let failed  = 0

  for (const item of items) {
    let firstUrl = ""
    try {
      const urls = JSON.parse(item.images) as string[]
      firstUrl = urls[0] ?? ""
    } catch { /* ignore */ }

    if (!firstUrl) { skipped++; continue }

    try {
      const res = await fetch(firstUrl, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buffer = Buffer.from(await res.arrayBuffer())
      const hash   = await computeDHash(buffer)
      await prisma.item.update({ where: { id: item.id }, data: { imageHash: hash } })
      updated++
      process.stdout.write(`  ✓ ${updated}/${items.length}\r`)
    } catch (e) {
      console.error(`\n  ✗ item ${item.id}: ${e instanceof Error ? e.message : e}`)
      failed++
    }
  }

  console.log(`\n\nDone.`)
  console.log(`  ✓ ${updated} updated`)
  console.log(`  - ${skipped} skipped (no image URL)`)
  console.log(`  ✗ ${failed} failed`)

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
