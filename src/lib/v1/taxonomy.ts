import { CATEGORY_VALUES, CONDITION_VALUES } from "@/lib/validation"

/**
 * Display labels for the enums, resolved server-side.
 *
 * The client is sent both the raw enum and its label — `"CLOTHING"` and
 * `"Fashion"` — so it can branch on the stable value while rendering the human
 * one, and neither the label nor the hashtag lives in two places. Today the
 * labels are duplicated across ai/value/route.ts, the trending route and
 * several dashboard pages, and they have already drifted: CLOTHING is
 * "Clothing" in one and "#Fashion" in another.
 *
 * These tables are the v1 source of truth. The existing routes keep their own
 * copies until the web user-side routes retire — deduplicating them now would
 * mean editing live routes for a cosmetic win.
 */

export type Category = (typeof CATEGORY_VALUES)[number]
export type Condition = (typeof CONDITION_VALUES)[number]

export const CATEGORY_LABELS: Record<Category, string> = {
  ELECTRONICS: "Electronics",
  CLOTHING: "Fashion",
  BAGS: "Bags",
  BEAUTY: "Beauty",
  ACCESSORIES: "Accessories",
  FURNITURE: "Home & Garden",
  BOOKS: "Books & Media",
  GAMING: "Gaming",
  SPORTS: "Sports",
  BIKES: "Bikes",
  TOYS: "Kids & Toys",
  TOOLS: "Tools & DIY",
  MUSIC: "Music",
  ART: "Art & Crafts",
  COLLECTIBLES: "Collectibles",
  PETS: "Pets",
  PLANTS: "Plants",
  FOOD: "Food",
  SERVICES: "Services",
  OTHER: "Miscellaneous",
}

/**
 * Hashtags for the trending strip.
 *
 * Derived from the label rather than stored separately — one table cannot drift
 * from the other if there is only one table. The handful of labels containing
 * "&" or a space collapse to a single CamelCase token.
 */
export function categoryHashtag(category: Category): string {
  const label = CATEGORY_LABELS[category] ?? category
  const token = label
    .replace(/&/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("")
  return `#${token}`
}

export const CONDITION_LABELS: Record<Condition, string> = {
  NEW: "New",
  LIKE_NEW: "Like new",
  GOOD: "Good",
  FAIR: "Fair",
  POOR: "Poor",
}

export const categoryLabel = (c: string): string =>
  CATEGORY_LABELS[c as Category] ?? c

export const conditionLabel = (c: string): string =>
  CONDITION_LABELS[c as Condition] ?? c

/**
 * Display labels for the task checklist.
 *
 * There is no label table anywhere today — every surface that renders the
 * checklist writes its own strings inline, which is why the same task reads
 * differently on the dashboard and the profile. v1 sends the label with the
 * task so the client renders one wording.
 */
export const TASK_LABELS: Record<string, string> = {
  VERIFY_ACCOUNT:   "Verify your account",
  COMPLETE_PROFILE: "Complete your profile",
  FIRST_LISTING:    "Post your first listing",
  VERIFIED_SWAP:    "Complete a verified swap",
  SAFEZONE_MEETUP:  "Meet at a Safe Zone",
}

export const taskLabel = (t: string): string => TASK_LABELS[t] ?? t
