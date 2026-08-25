import { redirect } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { auth } from "@root/auth"
import prisma from "@/lib/prisma"
import { formatDate, formatCategory, formatCondition } from "@/lib/utils"
import AvatarImage from "@/components/AvatarImage"
import { LeafRankBadge, TierBadge, StarRow } from "@/components/RepBadge"

export default async function ProfilePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/login")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      items: { orderBy: { createdAt: "desc" } },
      sentRequests: {
        include: { requestedItem: true, receiver: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      receivedRequests: {
        include: { offeredItem: true, sender: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      reviewsReceived: {
        include: { reviewer: { select: { name: true, avatar: true } } },
        orderBy: { createdAt: "desc" },
        take: 30,
      },
      _count: { select: { reviewsReceived: true } },
    },
  })

  if (!user) redirect("/auth/login")

  const isGoogleVerified = user.isVerified
  const ratingCount      = user._count.reviewsReceived

  const statusColor: Record<string, string> = {
    PENDING:   "bg-amber-50 text-amber-700",
    ACCEPTED:  "bg-emerald-50 text-emerald-700",
    REJECTED:  "bg-red-50 text-red-700",
    COMPLETED: "bg-blue-50 text-blue-700",
    CANCELLED: "bg-gray-100 text-gray-500",
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

      {/* ── Profile header ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-start gap-5">
          {/* Avatar */}
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 text-2xl font-bold overflow-hidden flex-shrink-0">
            {user.avatar ? (
              <AvatarImage src={user.avatar} name={user.name} width={64} height={64} className="object-cover" />
            ) : (
              user.name.charAt(0).toUpperCase()
            )}
          </div>

          {/* Name / meta */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">{user.name}</h1>
              {isGoogleVerified && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "3px 10px", borderRadius: 999,
                  fontSize: 11, fontWeight: 700,
                  background: "rgba(66,133,244,.1)", color: "#1a56db",
                  border: "1px solid rgba(66,133,244,.2)",
                }}>
                  {/* Google "G" mark */}
                  <svg width={11} height={11} viewBox="0 0 24 24" aria-hidden>
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Google-verified
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{user.email}</p>
            {user.location && <p className="text-xs text-gray-400 mt-0.5">{user.location}</p>}
            <p className="text-xs text-gray-400 mt-1">Member since {formatDate(user.createdAt)}</p>
          </div>
        </div>

        {/* ── Reputation panel ────────────────────────────────────────────── */}
        <div style={{
          marginTop: 24, paddingTop: 20,
          borderTop: "1px solid #F3F4F6",
          display: "flex", flexDirection: "column", gap: 16,
        }}>
          {/* Stats row */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {/* Average rating */}
            <div style={{
              flex: 1, minWidth: 100,
              background: "#FDFAF6", borderRadius: 14, padding: "14px 18px",
              border: "1px solid rgba(154,98,8,.12)",
              display: "flex", flexDirection: "column", gap: 4, alignItems: "center",
            }}>
              <p style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#9A6208", lineHeight: 1 }}>
                {user.rating > 0 ? user.rating.toFixed(1) : "—"}
              </p>
              <p style={{ margin: 0, fontSize: 11, color: "#9CA3AF", fontWeight: 600 }}>
                avg. rating
              </p>
            </div>

            {/* Ratings count */}
            <div style={{
              flex: 1, minWidth: 100,
              background: "#FDFAF6", borderRadius: 14, padding: "14px 18px",
              border: "1px solid rgba(45,47,34,.08)",
              display: "flex", flexDirection: "column", gap: 4, alignItems: "center",
            }}>
              <p style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#374151", lineHeight: 1 }}>
                {ratingCount}
              </p>
              <p style={{ margin: 0, fontSize: 11, color: "#9CA3AF", fontWeight: 600 }}>
                {ratingCount === 1 ? "rating" : "ratings"}
              </p>
            </div>

            {/* Completed trades */}
            <div style={{
              flex: 1, minWidth: 100,
              background: "#FDFAF6", borderRadius: 14, padding: "14px 18px",
              border: "1px solid rgba(60,113,67,.12)",
              display: "flex", flexDirection: "column", gap: 4, alignItems: "center",
            }}>
              <p style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#3C7143", lineHeight: 1 }}>
                {user.totalTrades}
              </p>
              <p style={{ margin: 0, fontSize: 11, color: "#9CA3AF", fontWeight: 600 }}>
                completed trade{user.totalTrades !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          {/* Badges row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <TierBadge totalTrades={user.totalTrades} rating={user.rating} />
            <LeafRankBadge lifetimeLeaves={user.lifetimeLeaves} />
            {isGoogleVerified && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "5px 14px", borderRadius: 999, fontSize: 13, fontWeight: 700,
                background: "rgba(66,133,244,.1)", color: "#1a56db",
                border: "1px solid rgba(66,133,244,.2)",
              }}>
                <svg width={13} height={13} viewBox="0 0 24 24" aria-hidden>
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Google-verified
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Reviews received ────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-bold mb-4">
          Reviews received
          {ratingCount > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-400">({ratingCount})</span>
          )}
        </h2>

        {user.reviewsReceived.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 text-gray-400 text-sm">
            No reviews yet — reviews appear here after completed trades.
          </div>
        ) : (
          <div className="space-y-3">
            {user.reviewsReceived.map((review) => (
              <div key={review.id} style={{
                background: "#fff", borderRadius: 16,
                border: "1px solid rgba(45,47,34,.08)",
                padding: "16px 20px",
                boxShadow: "0 1px 3px rgba(0,0,0,.04)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* Reviewer avatar */}
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "#EEF2EB", overflow: "hidden", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 700, color: "#3C7143",
                    }}>
                      {review.reviewer.avatar ? (
                        <img src={review.reviewer.avatar} alt={review.reviewer.name}
                             style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        review.reviewer.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1A1A" }}>
                      {review.reviewer.name}
                    </span>
                    <StarRow rating={review.rating} size={13} />
                  </div>
                  <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                    {formatDate(review.createdAt)}
                  </span>
                </div>
                {review.comment && (
                  <p style={{ margin: 0, fontSize: 14, color: "#374151", lineHeight: 1.55 }}>
                    {review.comment}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── My Items ────────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">My Listings</h2>
          <Link href="/listings/new" className="text-sm text-emerald-600 hover:underline font-medium">+ Add new</Link>
        </div>
        {user.items.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-gray-100 text-gray-400 text-sm">
            You haven&apos;t posted anything yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {user.items.map((item) => {
              const imgs: string[] = JSON.parse(item.images || "[]")
              return (
                <Link key={item.id} href={`/listings/${item.id}`} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                  <div className="relative h-36 bg-gray-100">
                    {imgs[0] ? (
                      <Image src={imgs[0]} alt={item.title} fill className="object-cover" />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-300 text-xs">No image</div>
                    )}
                    <span className={`absolute top-2 right-2 text-xs px-2 py-0.5 rounded-full font-medium ${item.status === "AVAILABLE" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                      {item.status}
                    </span>
                  </div>
                  <div className="p-3">
                    <p className="text-xs text-gray-400">{formatCategory(item.category)} · {formatCondition(item.condition)}</p>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5 line-clamp-1">{item.title}</p>
                    <p className="text-xs text-gray-400 mt-1">{formatDate(item.createdAt)}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Trade requests received ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-bold mb-4">Trade Requests Received</h2>
        {user.receivedRequests.length === 0 ? (
          <div className="text-center py-8 bg-white rounded-2xl border border-gray-100 text-gray-400 text-sm">No requests yet.</div>
        ) : (
          <div className="space-y-3">
            {user.receivedRequests.map((req) => (
              <div key={req.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    <span className="text-gray-500">{req.sender.name}</span> wants to trade for <span className="font-semibold">{req.offeredItem.title}</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatDate(req.createdAt)}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium flex-shrink-0 ${statusColor[req.status]}`}>
                  {req.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Trade requests sent ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-bold mb-4">Trade Requests Sent</h2>
        {user.sentRequests.length === 0 ? (
          <div className="text-center py-8 bg-white rounded-2xl border border-gray-100 text-gray-400 text-sm">You haven&apos;t sent any requests yet.</div>
        ) : (
          <div className="space-y-3">
            {user.sentRequests.map((req) => (
              <div key={req.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    You offered to trade for <span className="font-semibold">{req.requestedItem.title}</span>
                    <span className="text-gray-400"> from {req.receiver.name}</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatDate(req.createdAt)}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium flex-shrink-0 ${statusColor[req.status]}`}>
                  {req.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
