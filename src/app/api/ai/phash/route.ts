import { NextRequest, NextResponse } from "next/server"
import { resolveSession } from "@/lib/api-auth"
import prisma from "@/lib/prisma"
import sharp from "sharp"
import Anthropic from "@anthropic-ai/sdk"
import { fetchAllowedImage, isAllowedImageUrl } from "@/lib/safe-image-url"
import { enforceRateLimit } from "@/lib/rate-limit-config"
import { imageUrlSchema, parseBody } from "@/lib/validation"

// Presence only — see the note in ../identify/route.ts.
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("[phash] ANTHROPIC_API_KEY is not set — duplicate detection will fall back to Stage 1")
}

const anthropic = new Anthropic()

// ── Config ────────────────────────────────────────────────────────────────────
// Hamming distance ceiling (out of 64 bits) for Stage 1 to flag a candidate.
// dHash ranges: renamed/recompressed ≈ 0–8, completely different image ≈ 20+.
// Default 10 gives a comfortable gap; tune down if you get false positives.
const THRESHOLD = parseInt(process.env.PHASH_THRESHOLD ?? "10", 10)

// What to do when Stage 2 (AI) confirms a duplicate: "block" | "warn" | "flag"
// "block" → status:"failed" (wizard blocks Next button)
// "warn"  → status:"warned" (wizard can show a softer warning)
// "flag"  → status:"passed" (allow but include flagged:true in response)
const DUPLICATE_ACTION = process.env.DUPLICATE_ACTION ?? "block"

// WHICH LISTINGS ARE IN THE DUPLICATE POOL — DELIBERATELY ALL OF THEM.
//
// This used to read `status: "AVAILABLE"`, and that was the bug. The moment a
// listing was traded it became OWNED or TRADED, left the pool, and its photo
// was free for anyone to post again with no warning. The check was strongest
// for listings nobody had wanted yet and silent for the ones that had actually
// changed hands — exactly backwards, since a stranger reusing the photo of an
// item that has already been traded away is the strongest signal there is.
//
// Measured on the live table when this was found: every identical-image pair
// but one had at least one side out of the pool. Two of three real images,
// re-uploaded from a second account, published unchallenged; with the filter
// gone all three match at Hamming distance 0.
//
// NOTHING IS EXCLUDED, INCLUDING TAKEDOWNS. Two different things hide a
// listing: `status = REMOVED`, which its OWNER sets and can undo via
// /api/items/[id]/relist, and `moderationHiddenAt`, which a moderator sets and
// the owner cannot. Neither is consulted here. A photo a moderator took down is
// the last one that should quietly become re-postable by a stranger, and an
// owner who delisted their own item is not blocked by their own row either —
// Stage 1B runs first and answers "self", which is allowed.
//
// So the rule is simply "every image this app has accepted", and no status
// column is read at all.

// ── dHash ─────────────────────────────────────────────────────────────────────
// Resize to 9×8, compare each pixel to its right neighbour per row → 64-bit
// binary string. Encodes local gradients, so JPEG recompression / minor resizes
// / brightness shifts don't flip bits — far more robust than aHash.
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

function hammingDistance(a: string, b: string): number {
  let d = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) d++
  return d
}

// ── Stage 2: Claude vision confirmation ───────────────────────────────────────
// Both URLs are public Cloudinary URLs — imageUrl is the newly-uploaded image
// (already on Cloudinary before /api/ai/phash is called by the wizard),
// existingUrl is the stored first image of the matching item.
async function confirmWithAI(imageUrl: string, existingUrl: string): Promise<boolean> {
  // `existingUrl` comes out of another row's `images` column. It is our own
  // data, but it is data a user supplied, so it gets the same check as the
  // caller's URL rather than being trusted for having been stored.
  if (!isAllowedImageUrl(imageUrl).ok || !isAllowedImageUrl(existingUrl).ok) {
    throw new Error("blocked")
  }
  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 128,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "url", url: imageUrl } },
        { type: "image", source: { type: "url", url: existingUrl } },
        {
          type: "text",
          text: "You are a duplicate-image detector for a secondhand trade marketplace. Are these two images the same photo, or is the same physical item reused in both? Answer YES or NO on the first line, then one short sentence of reasoning.",
        },
      ],
    }],
  })
  const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : ""
  return text.toUpperCase().startsWith("YES")
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
  const session = await resolveSession()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Two vision calls per request, plus a full-catalogue scan.
  const limited = enforceRateLimit("aiPhash", session.user.id)
  if (limited) return limited

  const parsed = await parseBody(req, imageUrlSchema)
  if (!parsed.ok) return parsed.response
  const { imageUrl } = parsed.data

  // The allowlist runs BEFORE the fetch below and returns 400 without making a
  // request. Falling through to the fetch and letting it fail would still have
  // performed the fetch, which is the whole of the SSRF.
  const allowed = isAllowedImageUrl(imageUrl)
  if (!allowed.ok) return NextResponse.json({ error: allowed.reason }, { status: 400 })

  // ── Stage 1A: compute dHash for the new upload ────────────────────────────
  let hash: string
  try {
    const buffer = await fetchAllowedImage(imageUrl)
    hash = await computeDHash(buffer)
  } catch {
    // Neither the URL nor the error is logged. Both are attacker-controlled, and
    // a log that distinguishes "connection refused" from "404" is the readout
    // that turns a blocked SSRF back into a working port scanner.
    console.error("[phash] Stage 1A failed — item will be posted without imageHash.")
    return NextResponse.json({ hash: null, status: "passed" })
  }

  // ── Stage 1B: self-check (own photos — allowed, just note it) ────────────
  //
  // ItemImageHash, not Item.imageHash: one row per PHOTO. A listing's second
  // and later photos used to be in no pool at all, so re-posting someone's
  // photo #3 was never compared against anything.
  //
  // `images` is deliberately NOT selected here or in 1C. The scan needs only
  // the hashes; the one matched listing's URLs are fetched afterwards, in a
  // single lookup by id. Selecting them inline would drag every candidate's
  // whole JSON array across for the sake of at most one of them — and would
  // have grown fivefold with this change rather than shrinking.
  const ownHashes = await prisma.itemImageHash.findMany({
    where: { item: { userId: session.user.id } },
    select: { itemId: true, position: true, hash: true },
  })
  console.log(`[phash] Own photo hashes (any status): ${ownHashes.length}`)
  for (const row of ownHashes) {
    const dist = hammingDistance(hash, row.hash)
    if (dist <= THRESHOLD) {
      console.log(`[phash] Self-check HIT: item ${row.itemId} photo ${row.position} @ distance ${dist}`)
      return NextResponse.json({ hash, status: "self", matchedItemId: row.itemId, distance: dist })
    }
  }

  // ── Stage 1C: compare against other users' photos ─────────────────────────
  const otherHashes = await prisma.itemImageHash.findMany({
    where: { item: { userId: { not: session.user.id } } },
    select: { itemId: true, position: true, hash: true },
  })

  console.log(`[phash] Candidate photo hashes (other users, any status): ${otherHashes.length}`)
  console.log(`[phash] New upload hash: ${hash}`)

  let candidate: { id: string; position: number; distance: number } | null = null
  let closestDist = Infinity
  let closestItemId: string | null = null
  for (const row of otherHashes) {
    const dist = hammingDistance(hash, row.hash)
    if (dist < closestDist) { closestDist = dist; closestItemId = row.itemId }
    if (dist <= THRESHOLD) {
      candidate = { id: row.itemId, position: row.position, distance: dist }
      break
    }
  }

  if (closestItemId) {
    console.log(`[phash] Closest match: item ${closestItemId} @ distance ${closestDist} (threshold=${THRESHOLD}) → ${closestDist <= THRESHOLD ? "HIT" : "MISS"}`)
  } else {
    console.log(`[phash] No candidates to compare against — returning passed with no check`)
  }

  if (!candidate) {
    return NextResponse.json({
      hash, status: "passed",
      _debug: {
        candidatesChecked: otherHashes.length,
        closestDistance:   closestDist === Infinity ? null : closestDist,
        closestItemId,
        threshold: THRESHOLD,
      },
    })
  }

  // ── The matched listing's own photo, for Stage 2 ──────────────────────────
  //
  // THE PHOTO THAT MATCHED, NOT THE LISTING'S FIRST ONE. This used to read
  // `images[0]` unconditionally, which was harmless only while every listing
  // contributed a single hash. Now that photo #3 can be the match, sending
  // Claude photo #1 asks it to compare two pictures that really are different,
  // it correctly answers "no", and a true positive is overturned into a pass.
  //
  // Falls back to images[0] if the array is shorter than the position — a
  // listing whose photos were edited without its hashes being resent. That is
  // the conservative direction: Stage 2 still gets a picture from the right
  // listing and can only be more sceptical than the truth, never less.
  let existingImageUrl = ""
  try {
    const matched = await prisma.item.findUnique({
      where: { id: candidate.id },
      select: { images: true },
    })
    const urls = JSON.parse(matched?.images ?? "[]") as string[]
    existingImageUrl = urls[candidate.position] ?? urls[0] ?? ""
  } catch { /* leave empty — handled immediately below */ }

  // ── Stage 2: Claude vision confirmation ───────────────────────────────────
  if (!existingImageUrl) {
    // No stored image URL to send to Claude — fall back to Stage 1 result
    console.warn("[phash] Stage 2 skipped: no stored image URL for item", candidate.id)
    const status = DUPLICATE_ACTION === "block" ? "failed" : "passed"
    return NextResponse.json({ hash, status, matchedItemId: candidate.id, distance: candidate.distance, stage: 1 })
  }

  let aiConfirmed: boolean
  try {
    aiConfirmed = await confirmWithAI(imageUrl, existingImageUrl)
  } catch (e) {
    // Vision API failed — fall back to Stage 1 decision conservatively
    console.error("[phash] Stage 2 AI call failed, falling back to Stage 1:", e)
    aiConfirmed = true
  }

  if (!aiConfirmed) {
    // AI says these are different items — Stage 1 was a false positive
    return NextResponse.json({
      hash, status: "passed",
      matchedItemId: candidate.id, distance: candidate.distance, aiVerdict: "no", stage: 2,
    })
  }

  // AI confirmed duplicate — apply configured action
  const status =
    DUPLICATE_ACTION === "block" ? "failed" :
    DUPLICATE_ACTION === "warn"  ? "warned" :
    "passed" // "flag" mode: allow but caller can inspect aiVerdict + flagged

  return NextResponse.json({
    hash, status,
    matchedItemId: candidate.id, distance: candidate.distance,
    aiVerdict: "yes", stage: 2,
    ...(DUPLICATE_ACTION === "flag" ? { flagged: true } : {}),
  })

  } catch (e) {
    // Stages 1B/1C Prisma queries and resolveSession() have no individual try-catch.
    // Without this outer catch, any DB error returns HTML 500, the wizard's
    // r.json() throws, phashRes becomes "rejected", and imageHash is silently dropped.
    console.error(
      "[phash] ⚠ UNHANDLED ERROR in phash route — item will be posted without imageHash.",
      "\n  Root cause: likely a transient DB error in Stage 1B/1C Prisma query, or resolveSession() failure.",
      "\n  error:", e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : e,
    )
    return NextResponse.json({ hash: null, status: "passed" })
  }
}
