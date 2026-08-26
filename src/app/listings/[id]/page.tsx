import { notFound } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import prisma from "@/lib/prisma"
import { auth } from "@root/auth"
import { formatCategory, formatCondition, formatDate } from "@/lib/utils"
import { cloudinaryUrl } from "@/lib/cloudinary"
import TradeButton from "./TradeButton"
import AvatarImage from "@/components/AvatarImage"
import RelistButton from "@/app/dashboard/shelf/RelistButton"
import { CompactRepBadge, LeafRankBadge } from "@/components/RepBadge"
import ReportBlockMenu from "@/components/ReportBlockMenu"

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const item = await prisma.item.findUnique({
    where: { id },
    include: {
      user: {
        select: { id: true, name: true, avatar: true, rating: true, totalTrades: true, lifetimeLeaves: true, location: true, createdAt: true },
      },
    },
  })

  if (!item) notFound()

  const session = await auth()
  const isOwner = session?.user?.id === item.userId

  const images: string[] = JSON.parse(item.images || "[]")

  let ownedItems: { id: string; title: string; images: string }[] = []
  if (session?.user?.id && !isOwner) {
    ownedItems = await prisma.item.findMany({
      where: { userId: session.user.id, status: "AVAILABLE" },
      select: { id: true, title: true, images: true },
    })
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <Link href="/listings" className="text-sm text-gray-500 hover:text-gray-700 mb-6 inline-flex items-center gap-1">
        ← Back to listings
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
        {/* Images */}
        <div className="space-y-3">
          <div className="relative h-80 bg-gray-50 rounded-2xl overflow-hidden">
            {images[0] ? (
              <Image
                src={cloudinaryUrl(images[0], { w: 1200, crop: "limit" })}
                alt={item.title}
                fill
                unoptimized
                className="object-contain"
                sizes="(max-width: 768px) 100vw, 50vw"
                priority
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-300 text-sm">No image</div>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {images.slice(1).map((img, i) => (
                <div key={i} className="relative h-20 w-20 flex-shrink-0 bg-gray-50 rounded-xl overflow-hidden">
                  <Image
                    src={cloudinaryUrl(img, { w: 160, h: 160, crop: "fit" })}
                    alt={`${item.title} ${i + 2}`}
                    fill
                    unoptimized
                    className="object-contain"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div>
          <div className="flex items-start gap-2 mb-2">
            <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
              {formatCategory(item.category)}
            </span>
            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
              {formatCondition(item.condition)}
            </span>
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-3">{item.title}</h1>

          {item.valueLeaves && (
            <p className="text-sm text-gray-500 mb-4">Estimated value: <span className="font-semibold text-gray-700">{item.valueLeaves.toLocaleString()} Leaves</span></p>
          )}

          <p className="text-sm text-gray-600 leading-relaxed mb-4">{item.description}</p>

          {item.wantedItems && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 mb-4">
              <p className="text-xs font-semibold text-amber-700 mb-1">Looking for</p>
              <p className="text-sm text-amber-800">{item.wantedItems}</p>
            </div>
          )}

          <p className="text-xs text-gray-400 mb-6">Posted {formatDate(item.createdAt)}</p>

          {/* Seller card */}
          <div className="border border-gray-100 rounded-2xl p-4 mb-4">
            <p className="text-xs text-gray-400 font-medium mb-3">Posted by</p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold overflow-hidden flex-shrink-0">
                {item.user.avatar ? (
                  <AvatarImage src={item.user.avatar} name={item.user.name} width={40} height={40} className="object-cover" />
                ) : (
                  item.user.name.charAt(0).toUpperCase()
                )}
              </div>
              <div>
                <p className="font-semibold text-sm text-gray-900">{item.user.name}</p>
                {item.user.location && <p className="text-xs text-gray-400">{item.user.location}</p>}
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <CompactRepBadge
                    rating={item.user.rating}
                    totalTrades={item.user.totalTrades}
                  />
                  <LeafRankBadge lifetimeLeaves={item.user.lifetimeLeaves} size="sm" />
                </div>
              </div>
            </div>
          </div>

          {isOwner && item.status === "OWNED" ? (
            <div>
              <div className="text-center py-2 bg-purple-50 rounded-xl text-sm text-purple-600 font-medium mb-3">
                This item is in your inventory — not yet listed
              </div>
              <RelistButton itemId={item.id} />
            </div>
          ) : isOwner ? (
            <div className="flex flex-col gap-2">
              <div className="text-center py-3 bg-gray-50 rounded-xl text-sm text-gray-500 font-medium">
                This is your listing
              </div>
              <Link
                href={`/dashboard/tradeplace?edit=${item.id}`}
                className="block text-center py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                Edit listing
              </Link>
            </div>
          ) : !session ? (
            <Link href="/auth/login" className="block text-center py-3 bg-emerald-600 text-white rounded-xl font-medium text-sm hover:bg-emerald-700 transition-colors">
              Sign in to Trade
            </Link>
          ) : (
            <TradeButton
              requestedItemId={item.id}
              requestedItemTitle={item.title}
              ownedItems={ownedItems}
            />
          )}

          {/* Report the LISTING, block the PERSON — two different targets, which
              is why blockUser is separate. Hidden for the owner and for a signed-
              out visitor; the routes refuse both regardless. */}
          {session?.user?.id && !isOwner && (
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
              <ReportBlockMenu
                target={{ type: "listing", id: item.id }}
                blockUser={{ id: item.user.id, name: item.user.name }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
