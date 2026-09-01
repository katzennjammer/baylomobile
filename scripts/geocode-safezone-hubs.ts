// Geocode the Safe-Zone hubs against Nominatim (OpenStreetMap).
//
// Run (from baylo/):
//   npx tsx scripts/geocode-safezone-hubs.ts
//
// WHY THIS EXISTS. The first cut of the seed carried coordinates recalled from
// model knowledge rather than looked up. Two of the twenty-two were wrong and a
// third disagreed with a second source by 550 m. That is not a rounding
// problem, it is a category error: these pins are where two strangers are told
// to stand, and "roughly right" sends one of them to the wrong side of a mall.
// Coordinates now come from a service that can be checked, or they do not
// ship.
//
// ── The rule this script will not break ─────────────────────────────────────
//
// A FAILED LOOKUP IS RECORDED AS NOT_FOUND. It is never quietly backfilled from
// the old numbers, and there is no fallback path in here that could do so --
// not as a default, not as a "best effort", not behind a flag. A hub whose
// coordinate could not be verified is one a human has to look up, and the only
// honest output for it is a blank and a label saying so. Silently substituting
// the very numbers this exercise exists to replace would leave the seed looking
// verified while being exactly as wrong as before, which is worse than the
// state we started in, because it would stop anyone checking.
//
// ── Nominatim usage policy ──────────────────────────────────────────────────
//
// https://operations.osmfoundation.org/policies/nominatim/
//   - Absolute maximum of 1 request per second. This script waits RATE_MS
//     (1200 ms) between calls, single-threaded, no concurrency.
//   - A User-Agent identifying the application is REQUIRED. See UA below.
//   - Results are cached to disk so re-running the seed does not re-query.
//
// ON THE User-Agent: the policy asks for a contact address, and there is
// deliberately none in here. The only address available is the developer's
// personal email, and putting somebody's personal email into an outbound header
// to a third-party service is not a decision a script should make for them. If
// this is ever run at volume rather than twice by hand, add a real project
// contact to UA below.

import { writeFileSync } from "node:fs"
import { SAFE_ZONE_HUB_SEED } from "./safezone-hub-data"

const UA = "baylo-safezone-hub-geocoder/1.0 (Baylo marketplace; one-off seed verification)"
const ENDPOINT = "https://nominatim.openstreetmap.org/search"
const RATE_MS = 1200
const OUT = "scripts/safezone-hub-geocode.json"

/** EXACT: one result. AMBIGUOUS: several. NOT_FOUND: none. */
export type Confidence = "EXACT" | "AMBIGUOUS" | "NOT_FOUND"

interface NominatimResult {
  lat: string
  lon: string
  display_name: string
  osm_type?: string
  osm_id?: number
  class?: string
  type?: string
  addresstype?: string
}

export interface GeocodeRecord {
  id: string
  name: string
  city: string
  query: string
  confidence: Confidence
  latitude: number | null
  longitude: number | null
  displayName: string | null
  osmType: string | null
  osmId: number | null
  placeClass: string | null
  placeType: string | null
  resultCount: number
  /** Which pass produced this: the full query, or the Cebu-bounded retry. */
  strategy: "full-query" | "bounded-name" | null
  /**
   * ADVISORY, 0..1: how much of the name we asked for appears in what came
   * back. Deliberately does NOT feed `confidence` — see nameAgreement().
   * Low means "go and look", not "reject".
   */
  nameAgreement: number | null
  /** ADVISORY: does the top match sit in the city we asked about? */
  cityMatches: boolean | null
  /**
   * The mechanical verdict this script is willing to stand behind.
   *
   * ACCEPT only when the match is unambiguous, textually agrees with the name
   * we asked for, AND lands in the right municipality. Everything else is
   * REVIEW or MISSING and carries NO coordinate into the seed.
   *
   * This is deliberately conservative, and the reason is the whole point of
   * the exercise: the previous coordinates were confident and wrong. A pin a
   * human has not looked at should not be able to reach a map just because a
   * geocoder returned exactly one row.
   */
  verdict: "ACCEPT" | "REVIEW" | "MISSING"
  /** Every candidate, for the AMBIGUOUS ones a human has to adjudicate. */
  candidates: {
    lat: number
    lng: number
    displayName: string
    osmType: string | null
    osmId: number | null
    placeClass: string | null
    placeType: string | null
  }[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Metro Cebu, as left,top,right,bottom. Covers Lapu-Lapu, Mandaue and Cebu City.
 *
 * Used with bounded=1 on the SECOND pass only. A viewbox is a legitimate
 * geocoding technique -- it tells the service where on earth to look, which
 * REDUCES false positives -- and it is categorically different from dropping
 * terms out of a query until something matches. The first constrains the
 * search space; the second shops for a hit. Only the first is done here.
 */
const CEBU_VIEWBOX = "123.85,10.42,124.05,10.24"

async function search(
  q: string,
  opts: { bounded?: boolean } = {},
): Promise<NominatimResult[]> {
  const url = new URL(ENDPOINT)
  url.searchParams.set("q", q)
  url.searchParams.set("format", "jsonv2")
  // More than one, so "several matched" is detectable at all. With limit=1
  // every ambiguous place would silently report as EXACT — the classification
  // would become a description of the limit rather than of the data.
  url.searchParams.set("limit", "10")
  url.searchParams.set("addressdetails", "1")
  if (opts.bounded) {
    url.searchParams.set("viewbox", CEBU_VIEWBOX)
    url.searchParams.set("bounded", "1")
  }

  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" } })
  if (!res.ok) throw new Error(`Nominatim ${res.status} for ${JSON.stringify(q)}`)
  return (await res.json()) as NominatimResult[]
}

/**
 * Does the returned place sit in the city we asked about?
 *
 * THE SECOND CHECK THE CONFIDENCE FLAG CANNOT MAKE, and it caught things
 * name-agreement did not:
 *
 *   "Barangay Basak Hall" (Lapu-Lapu)  ranked "Basak San Nicolas Barangay Hall,
 *                                      CEBU CITY" first — agreement 1.00, wrong
 *                                      city, and the correct Lapu-Lapu hall was
 *                                      the third candidate.
 *   "Cebu North Bus Terminal"          returned a Cebu City location against a
 *                                      seed row that claims Mandaue.
 *
 * Nominatim orders by its own relevance, which is not "nearest to the city you
 * named" — so the top result can be a better textual match in the wrong
 * municipality. This is the check that notices.
 *
 * Matching on the bare municipality token ("Mandaue", "Lapu-Lapu") because
 * display_name renders it without the "City" suffix that our own labels carry.
 */
function cityMatches(expectedCity: string, displayName: string): boolean {
  const municipality = expectedCity.replace(/\s*City$/i, "").toLowerCase()
  return displayName.toLowerCase().includes(municipality)
}

/**
 * How much of the name we asked for actually appears in the name we got back,
 * 0..1 over lowercased word tokens.
 *
 * THIS IS THE CHECK THAT THE CONFIDENCE FLAG CANNOT MAKE. "EXACT" means
 * Nominatim returned exactly one result; it says nothing about whether that
 * result is the right place. The first run of this script matched
 * "J Centre Mall" to "SM City JMall" and reported EXACT, because one wrong
 * answer is still one answer. A token overlap of 0.33 on that pair is what
 * makes the mismatch visible mechanically instead of only to somebody reading
 * the table carefully.
 *
 * It is ADVISORY and deliberately does not feed the confidence flag: a low
 * score is a prompt to look, not a verdict. "Mactan Shrine" legitimately
 * matching "Liberty Shrine" would score low and still be correct.
 */
function nameAgreement(asked: string, got: string): number {
  const norm = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2)
  const a = norm(asked)
  if (a.length === 0) return 0
  const g = new Set(norm(got))
  return a.filter((w) => g.has(w)).length / a.length
}

async function main() {
  const records: GeocodeRecord[] = []

  console.log(`\n  Geocoding ${SAFE_ZONE_HUB_SEED.length} hubs via Nominatim`)
  console.log(`  ${RATE_MS} ms between requests (policy: max 1/sec)\n`)

  for (const hub of SAFE_ZONE_HUB_SEED) {
    // The SEARCH string, which is not always the display name -- see
    // SeedHub.geocodeQuery. Province and country are appended because they
    // genuinely disambiguate: there is a Banilad in Cebu City and one in
    // Mandaue, and more than one Basak.
    const query = `${hub.geocodeQuery ?? hub.name}, ${hub.city}, Cebu, Philippines`

    const askedName = hub.geocodeQuery ?? hub.name

    let results: NominatimResult[] = []
    let strategy: "full-query" | "bounded-name" | null = null
    let error: string | null = null
    try {
      // Pass 1: the full "name, city, province, country" string.
      results = await search(query)
      if (results.length > 0) strategy = "full-query"

      // Pass 2, ONLY if pass 1 found nothing: the bare name, confined to the
      // Metro Cebu viewbox. This is not query-shopping — no term is dropped to
      // make a match likelier, the search AREA is narrowed, which can only
      // remove wrong answers. Free-text Nominatim queries are weak on POIs in
      // the Philippines, and constraining the area is the standard remedy.
      if (results.length === 0) {
        await sleep(RATE_MS)
        results = await search(askedName, { bounded: true })
        if (results.length > 0) strategy = "bounded-name"
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }

    // A transport error is NOT a NOT_FOUND — "the service did not answer" and
    // "the service says this place is not in OSM" are different facts, and
    // collapsing them would let a network blip masquerade as a verified
    // absence. Surface it and stop, rather than record a lie.
    if (error) {
      console.error(`\n  REQUEST FAILED for ${hub.name}: ${error}`)
      console.error(`  Stopping. Nothing partial is written.\n`)
      process.exit(1)
    }

    const confidence: Confidence =
      results.length === 0 ? "NOT_FOUND" : results.length === 1 ? "EXACT" : "AMBIGUOUS"

    const top = results[0]
    records.push({
      id: hub.id,
      name: hub.name,
      city: hub.city,
      query,
      confidence,
      // NOTHING is filled in for a miss. See the rule at the top of this file.
      latitude: top ? Number(top.lat) : null,
      longitude: top ? Number(top.lon) : null,
      displayName: top?.display_name ?? null,
      osmType: top?.osm_type ?? null,
      osmId: top?.osm_id ?? null,
      placeClass: top?.class ?? null,
      placeType: top?.type ?? top?.addresstype ?? null,
      resultCount: results.length,
      strategy,
      nameAgreement: top ? Number(nameAgreement(askedName, top.display_name).toFixed(2)) : null,
      cityMatches: top ? cityMatches(hub.city, top.display_name) : null,
      verdict: !top
        ? "MISSING"
        : confidence === "EXACT" &&
            nameAgreement(askedName, top.display_name) >= 0.6 &&
            cityMatches(hub.city, top.display_name)
          ? "ACCEPT"
          : "REVIEW",
      candidates: results.map((r) => ({
        lat: Number(r.lat),
        lng: Number(r.lon),
        displayName: r.display_name,
        osmType: r.osm_type ?? null,
        osmId: r.osm_id ?? null,
        placeClass: r.class ?? null,
        placeType: r.type ?? r.addresstype ?? null,
      })),
    })

    const agree = top ? nameAgreement(askedName, top.display_name) : null
    process.stdout.write(
      `  ${confidence.padEnd(10)} ${hub.name}` +
        `${results.length > 1 ? `  (${results.length} results)` : ""}` +
        `${agree !== null ? `  agree ${agree.toFixed(2)}${agree < 0.5 ? "  <-- LOOK" : ""}` : ""}\n`,
    )

    await sleep(RATE_MS)
  }

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        source: "Nominatim (OpenStreetMap)",
        endpoint: ENDPOINT,
        retrievedAt: new Date().toISOString(),
        userAgent: UA,
        note:
          "NOT_FOUND entries carry null coordinates and MUST be filled in by hand. " +
          "No AI-recalled coordinate was substituted for any failed lookup.",
        records,
      },
      null,
      2,
    ),
    "utf8",
  )

  // ── The table ──────────────────────────────────────────────────────────────
  const found = records.filter((r) => r.confidence !== "NOT_FOUND")
  const missing = records.filter((r) => r.confidence === "NOT_FOUND")

  console.log(`\n${"═".repeat(100)}`)
  console.log(`  GEOCODED  —  ${found.length} of ${records.length}`)
  console.log(`${"═".repeat(100)}\n`)

  for (const r of found) {
    console.log(`  ${r.confidence === "EXACT" ? "EXACT    " : "AMBIGUOUS"}  ${r.name}  (${r.city})`)
    console.log(`             matched: ${r.displayName}`)
    console.log(`             osm:     ${r.osmType}/${r.osmId}   type=${r.placeType}   via ${r.strategy}`)
    console.log(
      `             checks:  name-agreement ${r.nameAgreement}` +
        `   city-match ${r.cityMatches}` +
        `   ==> ${r.verdict}`,
    )
    console.log(`             geo:${r.latitude},${r.longitude}`)
    if (r.confidence === "AMBIGUOUS") {
      console.log(`             ${r.resultCount} results — other candidates:`)
      for (const c of r.candidates.slice(1)) {
        console.log(`               · ${c.displayName}`)
        console.log(`                 geo:${c.lat},${c.lng}  (${c.osmType}/${c.osmId})`)
      }
    }
    console.log("")
  }

  if (missing.length > 0) {
    console.log(`${"═".repeat(100)}`)
    console.log(`  NOT FOUND  —  ${missing.length}.  These need a manual lookup; nothing was guessed.`)
    console.log(`${"═".repeat(100)}\n`)
    for (const r of missing) {
      console.log(`  ${r.name}  (${r.city})`)
      console.log(`             queried: ${r.query}`)
      console.log(`             coordinates: NONE — left blank on purpose\n`)
    }
  }

  console.log(`  written: ${OUT}\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
