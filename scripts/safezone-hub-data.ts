// The Safe-Zone hub list: what these places ARE, separately from where they are.
//
// Split out of seed-safezone-hubs.ts so that the geocoder and the seeder can
// both read it without either importing the other's side effects — and, more
// to the point, so that the descriptive half and the COORDINATE half of a hub
// are visibly different kinds of data with different provenance.
//
// ── Why that split matters ──────────────────────────────────────────────────
//
// The first cut of this seed carried coordinates recalled from model knowledge.
// Two of the twenty-two were wrong, and a third disagreed with a second source
// by 550 m. These pins are where two strangers are told to stand, so a wrong
// one does not degrade the feature, it sends somebody to the wrong place.
//
// Coordinates therefore no longer live in this file as bare numbers. They live
// in `coords`, which is either a record naming WHERE THE NUMBER CAME FROM, or
// null. Null means "not verified yet" and the seeder refuses to insert it.
// There is deliberately no way to express "here is a latitude, source unknown".
//
// ── What is hand-written here, and what is not ──────────────────────────────
//
//   name, type, city   — hand-written. Editorial: which places we are willing
//                        to send strangers to, and how we categorise them.
//   address            — hand-written, descriptive. NOT used for positioning.
//   landmark           — hand-written, and the most valuable field in the file.
//                        This is the sentence that actually gets two people to
//                        the same spot: "Parkmall" is not a meeting point, a
//                        mall has six entrances. A geocoder cannot produce it
//                        and must never overwrite it.
//   coords             — NEVER hand-written without an explicit source label.
//                        See scripts/geocode-safezone-hubs.ts.
//
// ═══════════════════════════════════════════════════════════════════════════
//  COORDINATE PROVENANCE
// ═══════════════════════════════════════════════════════════════════════════
//
//  SOURCE:    Google Maps, read off the map by hand, one place at a time.
//  RETRIEVED: 2026-08-29
//  BY:        The project owner, who checked all 22 in a single pass.
//
//  ALL 22 HUBS NOW CARRY A COORDINATE, and all 22 seed. That is the change this
//  revision makes; the previous revision seeded 9 and held back 13.
//
//  THESE NUMBERS REPLACED THE NOMINATIM SET RATHER THAN FILLING IN AROUND IT.
//  Both halves of that sentence matter:
//
//    · The 13 blanks were filled. Expected — they were blank precisely so that
//      a human would come and resolve them.
//
//    · The 9 that already carried "nominatim-exact" WERE ALSO OVERWRITTEN, and
//      several moved a long way: Island Central Mactan ~2.6 km, Barangay
//      Marigondon Hall ~3.6 km, Barangay Pusok Hall ~1.3 km. Those are not
//      nudges. They mean the three-check rule that admitted them — one result,
//      name agrees, city agrees — let through pins that were in the wrong part
//      of the right city.
//
//  Two of those disagreements were legible in the old data before anybody drove
//  anywhere, and are recorded here because the next person tempted to trust a
//  geocoder's own confidence should see what "EXACT" was worth:
//
//    · Island Central Mactan's matched displayName said "Pusok". The hub's
//      address says Pajo. The geocoder returned a confident single match for a
//      different barangay, and the city check could not notice because both
//      barangays are in the same city.
//    · Barangay Marigondon Hall matched an object on Basak–Marigondon Road at
//      123.975. Marigondon is on Mactan's EAST coast, past 124.00. The road is
//      named for the place it leads to, and the match was somewhere along it.
//
//  The old candidates are still in scripts/safezone-hub-geocode.json. That file
//  is now HISTORY, not provenance: nothing below is derived from it. Keep it —
//  it is the evidence for the paragraph above.
//
//  ── Two entries that changed by more than a coordinate ─────────────────────
//
//  CEBU NORTH BUS TERMINAL IS NOT IN MANDAUE, and has not been since October
//  2020, when the Capitol's lease on the Subangdaku site expired and operations
//  moved to the SM City Cebu compound in the North Reclamation Area — Cebu
//  City, not Mandaue. Seeding the Subangdaku coordinate would have pinned a
//  terminal that stopped being one six years ago. Its `city` is therefore
//  "Cebu City" and its id is `szh-ceb-…`, and it is the first hub in this file
//  belonging to neither of the two cities the list was drawn up for.
//
//    The SM City site was announced as a two-year arrangement and has simply
//    continued; there is no permanent replacement as of this writing. A
//    satellite terminal opened at the Cebu Bus Depot in Mandaue in October 2025,
//    but it is a holiday-overflow facility, not a place to tell two strangers to
//    meet on an ordinary Tuesday. If the main terminal moves again this entry
//    moves with it — the cost of putting a LEASED site on a list of fixed
//    landmarks, accepted knowingly because the terminal is where people are.
//
//  BARANGAY BANILAD HALL IS IN MANDAUE, and the address that reads "Cebu City"
//  is the error rather than the filing. A. S. Fortuna Street runs along the
//  Mandaue/Cebu City boundary and consumer maps label stretches of it either
//  way. Three independent things agree on Mandaue: the postal code on the
//  hall's own address (6014 is Mandaue; Cebu City's Banilad is 6000), Mandaue
//  City's published barangay roll, and the old Nominatim record, which resolved
//  it to "Saint Martin Village, Banilad, Mandaue". Cebu City's Banilad is a
//  different barangay ~1.5 km south-west — which is exactly why this hub's NAME
//  carries its city in parentheses, and must keep doing so.

import type { SafeZoneTypeValue } from "../src/lib/safe-zones"

/**
 * Where a coordinate came from. The label is mandatory, which is the point:
 * an unlabelled coordinate cannot be represented by this type.
 */
export type CoordinateSource =
  /** Returned by Nominatim, single unambiguous match. */
  | "nominatim-exact"
  /** Returned by Nominatim among several candidates; a human picked this one. */
  | "nominatim-reviewed"
  /** Looked up by hand by a person, off-map. Say who and when in `note`. */
  | "manual"
  /**
   * Read off a consumer map (Google Maps) by a person working place by place,
   * confirming each one, rather than accepting a search result.
   *
   * Distinct from "manual" on purpose. "manual" says a human typed it. This
   * says a human typed it AFTER LOOKING AT THE PLACE ON A MAP. The whole
   * 2026-08-29 set carries this label, and it is the only one under which a
   * "nominatim-exact" value may be overwritten — see the header.
   */
  | "manual-verified"

export interface HubCoordinates {
  latitude: number
  longitude: number
  source: CoordinateSource
  /** ISO date the coordinate was obtained or confirmed. */
  retrievedAt: string
  /**
   * What the GEOCODER said it matched — the audit trail for a machine-derived
   * number. Deliberately unset on a hand-read coordinate: there was no matcher,
   * and carrying the old geocoder's string beside a number it did not produce
   * would credit the new pin to the tool that got the old one wrong.
   */
  displayName?: string
  osmType?: string
  osmId?: number
  /** Anything a reader needs in order to trust or distrust this number. */
  note?: string
}

export interface SeedHub {
  id: string
  /** The user-facing name. Editorial — a geocoder never rewrites this. */
  name: string
  /**
   * What to SEARCH for, when that differs from what to DISPLAY.
   *
   * These are two different jobs and conflating them corrupts one of them.
   * "Barangay Basak Hall (Lapu-Lapu)" carries a parenthetical because Mandaue
   * has a Basak too and a user picking from a list needs to tell them apart;
   * a geocoder handed that same string searches for the parenthesis. Likewise
   * "Mactan-Cebu International Airport Terminal 1" names the terminal for the
   * reader, while OSM knows the airport.
   *
   * Defaults to `name`. Set it only where the two genuinely diverge, and never
   * to make a bad match look like a good one — narrowing the query to force a
   * hit is how you get a confident coordinate for the wrong place.
   *
   * NOTHING BELOW IS POSITIONED BY THIS ANY MORE — every coordinate in the file
   * is hand-read. These are kept for the next geocoder run, whose job has
   * changed from producing these numbers to CHECKING them.
   */
  geocodeQuery?: string
  type: SafeZoneTypeValue
  address: string
  city: string
  landmark: string
  /** NULL means unverified. The seeder skips these and lists them loudly. */
  coords: HubCoordinates | null
}

export const LAPU_LAPU = "Lapu-Lapu City"
export const MANDAUE = "Mandaue City"
/**
 * A third city, one hub — and it arrived by accident rather than by expansion:
 * Cebu North Bus Terminal was seeded as Mandaue and turned out to have moved
 * across the boundary in 2020. See the header.
 *
 * Worth knowing before adding more: `city` is a plain string on the schema
 * exactly so that a new city is an INSERT and not a migration, so nothing
 * breaks. What it does change is the picker, which groups by city — Cebu City
 * now appears there as a group of one.
 */
export const CEBU_CITY = "Cebu City"

/**
 * The coordinate-source record shared by every hub below.
 *
 * A FUNCTION rather than a shared object literal, and the reason is not style:
 * one literal spread into 22 entries is one object aliased 22 times, so a
 * mutation to any single hub's coords would silently move every hub in the
 * file. Callers with something specific to say pass a `note`.
 */
const verified = (
  latitude: number,
  longitude: number,
  note?: string,
): HubCoordinates => ({
  latitude,
  longitude,
  source: "manual-verified",
  retrievedAt: "2026-08-29",
  ...(note ? { note } : {}),
})

export const SAFE_ZONE_HUB_SEED: SeedHub[] = [
  // ── Lapu-Lapu City (Mactan Island) ─────────────────────────────────────────
  {
    id: "szh-llc-gaisano-grand-mactan",
    name: "Gaisano Grand Mall Mactan",
    type: "MALL",
    // Was recorded as M.L. Quezon National Highway, Pusok. It is not there.
    address: "Basak–Marigondon Road, Basak, Lapu-Lapu City, Cebu",
    city: LAPU_LAPU,
    landmark: "Ground floor, at the main entrance beside the supermarket checkout lanes",
    coords: verified(10.28646, 123.97023),
  },
  {
    id: "szh-llc-island-central-mactan",
    name: "Island Central Mactan",
    type: "MALL",
    address: "M.L. Quezon National Highway, Pajo, Lapu-Lapu City, Cebu",
    city: LAPU_LAPU,
    landmark: "Ground floor atrium, in front of the customer service counter",
    coords: verified(
      10.30534,
      123.96281,
      "Replaces a nominatim-exact pin ~2.6 km north whose own matched name said Pusok, while this hub is in Pajo.",
    ),
  },
  {
    id: "szh-llc-marina-mall",
    name: "Marina Mall Mactan",
    type: "MALL",
    address: "Airport Road, Pusok, Lapu-Lapu City, Cebu",
    city: LAPU_LAPU,
    landmark: "Ground floor, at the food court entrance facing the car park",
    coords: verified(10.31376, 123.97873),
  },
  {
    id: "szh-llc-city-hall-grounds",
    name: "Lapu-Lapu City Hall Grounds",
    geocodeQuery: "Lapu-Lapu City Hall",
    type: "PUBLIC_PLAZA",
    address: "P. Burgos Street, Poblacion, Lapu-Lapu City, Cebu",
    city: LAPU_LAPU,
    landmark: "Covered court in front of the main building, beside the flagpole",
    coords: verified(10.31061, 123.94942),
  },
  {
    id: "szh-llc-police-station",
    name: "Lapu-Lapu City Police Station",
    type: "POLICE_STATION",
    address: "P. Burgos Street, Poblacion, Lapu-Lapu City, Cebu",
    city: LAPU_LAPU,
    landmark: "Front desk lobby, just inside the main gate",
    // ~90 m from the City Hall grounds above. These two pins are close together
    // because the two places are: same street, adjacent compounds.
    coords: verified(10.30982, 123.95003),
  },
  {
    id: "szh-llc-mactan-shrine",
    name: "Mactan Shrine (Liberty Shrine)",
    geocodeQuery: "Mactan Shrine",
    type: "PUBLIC_PLAZA",
    address: "Punta Engaño Road, Punta Engaño, Lapu-Lapu City, Cebu",
    city: LAPU_LAPU,
    landmark: "At the base of the Lapulapu monument, inside the main plaza",
    coords: verified(10.31221, 124.01668),
  },
  {
    id: "szh-llc-mcia-terminal-1",
    name: "Mactan-Cebu International Airport Terminal 1",
    geocodeQuery: "Mactan-Cebu International Airport",
    type: "TRANSPORT_HUB",
    address: "Airport Road, Pusok, Lapu-Lapu City, Cebu",
    city: LAPU_LAPU,
    landmark: "Arrivals level, at the public meeting point outside the exit doors",
    // The old pin was the airport RELATION's centroid — the middle of the
    // airfield. This is Terminal 1, which is what the name promises and the
    // only part of the airport a person on foot can actually stand in.
    coords: verified(10.30962, 123.97894),
  },
  {
    id: "szh-llc-brgy-basak",
    name: "Barangay Basak Hall (Lapu-Lapu)",
    geocodeQuery: "Barangay Basak Hall",
    type: "BARANGAY_HALL",
    address: "Basak, Lapu-Lapu City, Cebu",
    city: LAPU_LAPU,
    // Both cities have a Basak. The name carries the city for that reason.
    landmark: "Covered court beside the hall, near the barangay tanod desk",
    // The geocoder's top hit for this one was in CEBU CITY.
    coords: verified(10.30063, 123.97182),
  },
  {
    id: "szh-llc-brgy-pajo",
    name: "Barangay Pajo Hall",
    type: "BARANGAY_HALL",
    address: "Pajo, Lapu-Lapu City, Cebu",
    city: LAPU_LAPU,
    landmark: "Reception desk at the hall entrance, ground floor",
    coords: verified(10.30618, 123.96334),
  },
  {
    id: "szh-llc-brgy-pusok",
    name: "Barangay Pusok Hall",
    type: "BARANGAY_HALL",
    address: "Pusok, Lapu-Lapu City, Cebu",
    city: LAPU_LAPU,
    landmark: "Front porch of the hall, beside the barangay blotter desk",
    coords: verified(10.31284, 123.97204, "Replaces a nominatim-exact pin ~1.3 km north-east."),
  },
  {
    id: "szh-llc-brgy-gun-ob",
    name: "Barangay Gun-ob Hall",
    type: "BARANGAY_HALL",
    address: "Gun-ob, Lapu-Lapu City, Cebu",
    city: LAPU_LAPU,
    landmark: "Covered court fronting the hall",
    coords: verified(10.30958, 123.96131),
  },
  {
    id: "szh-llc-brgy-marigondon",
    name: "Barangay Marigondon Hall",
    type: "BARANGAY_HALL",
    address: "Marigondon, Lapu-Lapu City, Cebu",
    city: LAPU_LAPU,
    landmark: "Covered court beside the hall, near the main road entrance",
    coords: verified(
      10.30047,
      124.00718,
      "Replaces a nominatim-exact pin ~3.6 km west, which sat on Basak–Marigondon Road rather than in Marigondon.",
    ),
  },

  // ── Mandaue City ───────────────────────────────────────────────────────────
  {
    id: "szh-mnd-parkmall",
    name: "Parkmall",
    type: "MALL",
    address: "Ouano Avenue, Tipolo, Mandaue City, Cebu",
    city: MANDAUE,
    landmark: "Ground floor main atrium, beside the concierge desk",
    coords: verified(10.32271, 123.93852),
  },
  {
    id: "szh-mnd-j-centre-mall",
    name: "J Centre Mall",
    type: "MALL",
    address: "A.S. Fortuna Street, Bakilid, Mandaue City, Cebu",
    city: MANDAUE,
    landmark: "Ground floor lobby, in front of the cinema ticket counter",
    // The geocoder's answer here was "SM City JMall" — a different mall whose
    // name is one character away. Nothing about that match was flagged.
    coords: verified(10.33289, 123.92683),
  },
  {
    id: "szh-mnd-pacific-mall",
    name: "Pacific Mall Metro Mandaue",
    type: "MALL",
    address: "U.N. Avenue corner Plaridel Street, Centro, Mandaue City, Cebu",
    city: MANDAUE,
    landmark: "Ground floor, at the main entrance facing U.N. Avenue",
    // One of the two the geocoder could not find at all. Now hand-read.
    coords: verified(10.32771, 123.94203),
  },
  {
    id: "szh-mnd-city-hall-grounds",
    name: "Mandaue City Hall Grounds",
    geocodeQuery: "Mandaue City Hall",
    type: "PUBLIC_PLAZA",
    address: "S.B. Cabahug Street, Centro, Mandaue City, Cebu",
    city: MANDAUE,
    landmark: "Covered plaza in front of the main building, beside the information desk",
    coords: verified(10.32384, 123.94251),
  },
  {
    id: "szh-mnd-police-office",
    name: "Mandaue City Police Office",
    type: "POLICE_STATION",
    // Was recorded as Plaridel Street, Centro. The office is at the Wharf.
    address: "Wharf, A. Soriano St corner Ouano Ave, Mandaue City, Cebu",
    city: MANDAUE,
    landmark: "Front desk lobby, immediately inside the main entrance",
    coords: verified(10.32468, 123.94331),
  },
  {
    id: "szh-mnd-plaza-mandaue",
    name: "Plaza Mandaue",
    type: "PUBLIC_PLAZA",
    address: "Centro, Mandaue City, Cebu",
    city: MANDAUE,
    landmark: "Beside the plaza bandstand, fronting the National Shrine of St. Joseph",
    // ~90 m from Mandaue City Hall, and ~50 m from the police office. Centro is
    // small and these three genuinely share a block.
    coords: verified(10.32524, 123.94297),
  },
  {
    id: "szh-mnd-brgy-subangdaku",
    name: "Barangay Subangdaku Hall",
    type: "BARANGAY_HALL",
    address: "Subangdaku, Mandaue City, Cebu",
    city: MANDAUE,
    landmark: "Covered court beside the hall",
    coords: verified(10.32831, 123.92654),
  },
  {
    id: "szh-mnd-brgy-tipolo",
    name: "Barangay Tipolo Hall",
    type: "BARANGAY_HALL",
    address: "P. Basubas St, Tipolo, Mandaue City, Cebu",
    city: MANDAUE,
    landmark: "Ground floor reception, beside the barangay clearance window",
    // The other one the geocoder could not find at all. Now hand-read.
    coords: verified(10.32436, 123.93451),
  },
  {
    id: "szh-mnd-brgy-banilad",
    name: "Barangay Banilad Hall (Mandaue)",
    geocodeQuery: "Barangay Banilad Hall",
    type: "BARANGAY_HALL",
    // Filed under Mandaue, and that is correct — the "Cebu City" some maps
    // print for this stretch of A. S. Fortuna is the error. See the header.
    address: "A. S. Fortuna Street, Banilad, Mandaue City, Cebu",
    city: MANDAUE,
    // Cebu City also has a Banilad. Same reason Basak carries its city.
    landmark: "Covered court fronting the hall",
    coords: verified(10.34102, 123.92941),
  },

  // ── Cebu City ──────────────────────────────────────────────────────────────
  // One hub, and not because the list expanded — because this one turned out
  // not to be in Mandaue. See the header.
  {
    id: "szh-ceb-north-bus-terminal",
    name: "Cebu North Bus Terminal",
    type: "TRANSPORT_HUB",
    address: "SM City Cebu compound, North Reclamation Area, Cebu City, Cebu",
    city: CEBU_CITY,
    landmark: "Main passenger waiting hall, beside the ticketing booths",
    coords: verified(
      10.31109,
      123.92078,
      "The operating site since October 2020. The Subangdaku, Mandaue address this terminal is still widely listed at closed when the Capitol's lease expired; pinning it would send people to a terminal that is not there.",
    ),
  },
]
