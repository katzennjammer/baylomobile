import prisma from "@/lib/prisma"
import ItemCard from "@/components/ItemCard"
import { CATEGORIES } from "@/lib/utils"
import Link from "next/link"

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string }>
}) {
  const { category, q } = await searchParams

  const items = await prisma.item.findMany({
    where: {
      status: "AVAILABLE",
      ...(category && category !== "ALL" ? { category: category as never } : {}),
      ...(q ? { OR: [{ title: { contains: q } }, { description: { contains: q } }] } : {}),
    },
    include: { user: { select: { id: true, name: true, avatar: true, rating: true, totalTrades: true } } },
    orderBy: { createdAt: "desc" },
  })

  return (
    <div className="max-w-7xl mx-auto px-4 py-8" style={{ paddingTop: "calc(68px + 2rem)" }}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Browse Listings</h1>
        <Link href="/listings/new" className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-colors">
          + Post an Item
        </Link>
      </div>

      {/* Search & Filter */}
      <form method="GET" className="flex flex-col sm:flex-row gap-3 mb-8">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search items..."
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <select
          name="category"
          defaultValue={category ?? "ALL"}
          className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
        >
          <option value="ALL">All Categories</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat.charAt(0) + cat.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <button type="submit" className="px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-700 transition-colors">
          Search
        </button>
      </form>

      {items.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg mb-2">No items found.</p>
          <p className="text-sm">Try a different search or category.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-4">{items.length} item{items.length !== 1 ? "s" : ""} found</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
