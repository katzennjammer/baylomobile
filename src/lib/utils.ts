export function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function formatCategory(category: string) {
  return category.charAt(0) + category.slice(1).toLowerCase().replace(/_/g, " ")
}

export function formatCondition(condition: string) {
  return condition.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

export const CATEGORIES = [
  "ELECTRONICS",
  "CLOTHING",
  "BAGS",
  "BEAUTY",
  "ACCESSORIES",
  "FURNITURE",
  "BOOKS",
  "GAMING",
  "SPORTS",
  "BIKES",
  "TOYS",
  "TOOLS",
  "MUSIC",
  "ART",
  "COLLECTIBLES",
  "PETS",
  "PLANTS",
  "FOOD",
  "SERVICES",
  "OTHER",
] as const

export const CONDITIONS = ["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"] as const
