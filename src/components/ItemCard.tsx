import Link from "next/link"
import Image from "next/image"
import { formatCategory, formatCondition } from "@/lib/utils"
import { cloudinaryUrl } from "@/lib/cloudinary"
import AvatarImage from "@/components/AvatarImage"
import { CompactRepBadge } from "@/components/RepBadge"

type ItemWithUser = {
  id: string
  title: string
  images: string
  category: string
  condition: string
  status: string
  user: {
    id:          string
    name:        string
    avatar:      string | null
    rating:      number
    totalTrades: number
  }
}

export default function ItemCard({ item }: { item: ItemWithUser }) {
  const images: string[] = JSON.parse(item.images || "[]")
  const thumbnail = cloudinaryUrl(images[0] ?? "/placeholder.png", { w: 600, crop: "limit" })

  return (
    <Link href={`/listings/${item.id}`} className="group block bg-[#BFB9AB] rounded-2xl border border-[#B2B6A2] shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      <div className="relative h-48 bg-[#F4EAEB]">
        <Image
          src={thumbnail}
          alt={item.title}
          fill
          unoptimized
          className="object-cover group-hover:scale-105 transition-transform duration-300"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
        />
        <span className="absolute top-2 right-2 text-xs bg-[#BFB9AB]/90 text-[#68604D] px-2 py-0.5 rounded-full font-medium">
          {formatCondition(item.condition)}
        </span>
      </div>
      <div className="p-4">
        <p className="text-xs text-[#3C7143] font-medium mb-1">{formatCategory(item.category)}</p>
        <h3 className="font-semibold text-[#2D2F22] text-sm leading-snug line-clamp-2 mb-3">{item.title}</h3>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-[#F4EAEB] flex items-center justify-center text-xs font-bold text-[#3C7143] overflow-hidden flex-shrink-0">
            {item.user.avatar ? (
              <AvatarImage src={item.user.avatar} name={item.user.name} width={24} height={24} className="object-cover" />
            ) : (
              item.user.name.charAt(0).toUpperCase()
            )}
          </div>
          <span className="text-xs text-[#68604D] truncate font-medium">{item.user.name}</span>
          <span className="ml-auto flex-shrink-0">
            <CompactRepBadge rating={item.user.rating} totalTrades={item.user.totalTrades} />
          </span>
        </div>
      </div>
    </Link>
  )
}
