"use client"

import React from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import "../baylo-dashboard.css"
import TopNav from "../_shell/TopNav"
import type { Notif, Message } from "../_shell/TopNav"
import DashSidebar from "../_shell/DashSidebar"
import ChatDock from "../_shell/ChatDock"
import type { ChatWindow } from "../_shell/ChatDock"
import { subscribeChannel, unsubscribeChannel } from "@/lib/pusher-client"
import { CompactRepBadge } from "@/components/RepBadge"
import { isLeavesOnlyTrade, formatTradeTitleStr } from "@/lib/trade-format"

const SwapConfirmModal = dynamic(() => import("@/components/SwapConfirmModal"), { ssr: false })
const RateTradeModal   = dynamic(() => import("@/components/RateTradeModal"),   { ssr: false })

// ── Types ─────────────────────────────────────────────────────────────────────

type TradeStatus = "PENDING" | "ACCEPTED" | "CONFIRMING" | "COMPLETED" | "REJECTED" | "CANCELLED"

interface SerializedItem {
  id:             string
  title:          string
  image:          string | null
  category:       string
  itemStatus:     string
  valueLeaves: number | null
}

interface SerializedTrade {
  id:                string
  status:            string
  createdAt:         string
  updatedAt:         string
  offeredItem:       SerializedItem
  requestedItem:     SerializedItem
  sender:    { id: string; name: string; avatar: string | null }
  receiver:  { id: string; name: string; avatar: string | null }
  co2Saved:  number | null
  myItemLeaves:      number | null
  offeredLeaves:     number | null
  myReview:          { rating: number } | null
}

interface SerializedOffer {
  id:            string
  createdAt:     string
  post:          { id: string; title: string; image: string | null }
  sender:        { id: string; name: string; avatar: string | null; rating: number; totalTrades: number }
  offeredItems:  { id: string; title: string; image: string | null }[]
  offeredLeaves: number | null
  fairness:      "low" | "fair" | "generous" | null
}

interface Me {
  name:   string
  handle: string
  avatar: string | null
  leaves: number
}

// ── Icons (Lucide paths) ──────────────────────────────────────────────────────

const ICONS = {
  arrowLeftRight: "M3 9h18M16 5l4 4-4 4M21 15H3M8 19l-4-4 4-4",
  check:          "M4 12.5 9 17.5 20 6.5",
  clock:          "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  x:              "M18 6 6 18M6 6l12 12",
  refresh:        "M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15",
  inbox:          "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z",
  trophy:         "M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.29 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.29 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z",
  leaf:           "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10ZM2 21c0-3 1.85-5.4 5.1-6",
  leaves:         "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10ZM2 21c0-3 1.85-5.4 5.1-6M6.5 14.5c2.2-.5 3.6-1.9 4.3-4",
  plus:           "M12 5v14M5 12h14",
  star:           "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L4.5 9.7l5.9-.9L12 3.5Z",
  tag:            "M3 12V4h8l10 10-8 8L3 12ZM7.5 8.5h.01",
  arrowRight:     "M5 12h14M13 6l6 6-6 6",
  moreHorizontal: "M3 12h.01M12 12h.01M21 12h.01",
  messageSquare:  "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z",
  trash2:         "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  xCircle:        "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10ZM15 9l-6 6M9 9l6 6",
  eyeOff:         "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22",
  info:           "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10ZM12 8h.01M12 12v4",
  alertTriangle: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0ZM12 9v4M12 17h.01",
} as const

type IconName = keyof typeof ICONS

function Icon({ name, size = 18, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
         fill={filled ? "currentColor" : "none"}
         stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  )
}

// ── Avatar ────────────────────────────────────────────────────────────────────

const GRADS: [string, string][] = [
  ["#4CAF50", "#1A3520"], ["#FF6BA3", "#7A1F47"], ["#27E0B3", "#0C5B49"],
  ["#FFB23E", "#7A3E0C"], ["#5CA8FF", "#16356B"], ["#FF7A59", "#6B1F16"],
]
function seedGrad(s: string): [string, string] {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return GRADS[h % GRADS.length]
}
function initials(n: string) {
  return n.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()
}

function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const [err, setErr] = React.useState(false)
  const [a, b] = seedGrad(name)
  const base: React.CSSProperties = {
    width: size, height: size, borderRadius: "50%", flexShrink: 0, overflow: "hidden",
  }
  if (src && !err) {
    return (
      <div style={base}>
        <img src={src} alt={name} onError={() => setErr(true)}
             style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    )
  }
  return (
    <div style={{
      ...base, background: `linear-gradient(135deg,${a},${b})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontWeight: 700, fontSize: size * 0.35,
    }}>
      {initials(name)}
    </div>
  )
}

// ── ItemThumb (used in Offers + History) ──────────────────────────────────────

function ItemThumb({ title, image, size = 80 }: { title: string; image: string | null; size?: number }) {
  const [err, setErr] = React.useState(false)
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
      <div style={{
        width: size, height: size, borderRadius: 12, overflow: "hidden", flexShrink: 0,
        background: "#EEF2EB", border: "1.5px solid rgba(60,113,67,.14)",
        display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa",
      }}>
        {image && !err
          ? <img src={image} alt={title} onError={() => setErr(true)}
                 style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <Icon name="arrowLeftRight" size={Math.round(size * 0.3)} />
        }
      </div>
      <span style={{
        fontSize: 11, fontWeight: 600, color: "#555",
        textAlign: "center", lineHeight: 1.3,
        width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {title}
      </span>
    </div>
  )
}

// ── LeavesThumb (used in HistoryRow for Leaves-only trades) ──────────────────

function LeavesThumb({ leaves, size = 80 }: { leaves: number; size?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
      <div style={{
        width: size, height: size, borderRadius: 12, flexShrink: 0,
        background: "rgba(60,113,67,.1)", border: "1.5px solid rgba(60,113,67,.22)",
        display: "flex", alignItems: "center", justifyContent: "center", color: "#3C7143",
      }}>
        <Icon name="leaves" size={Math.round(size * 0.3)} />
      </div>
      <span style={{
        fontSize: 11, fontWeight: 700, color: "#3C7143",
        textAlign: "center", lineHeight: 1.3,
        width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {leaves.toLocaleString()} Leaves
      </span>
    </div>
  )
}

// ── Time helpers ──────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-PH", {
    month: "short", day: "numeric", year: "numeric",
  })
}

// ── Badge config for new card design ─────────────────────────────────────────

type BadgeKey = TradeStatus | "UNAVAILABLE"

const BADGE_CONFIG: Record<BadgeKey, { label: string; dot: string; text: string }> = {
  PENDING:     { label: "Awaiting",          dot: "#F59E0B", text: "#92400E" },
  ACCEPTED:    { label: "Accepted",          dot: "#3C7143", text: "#1A3520" },
  CONFIRMING:  { label: "Confirming",        dot: "#F59E0B", text: "#92400E" },
  COMPLETED:   { label: "Completed",         dot: "#9CA3AF", text: "#374151" },
  REJECTED:    { label: "Declined",          dot: "#EF4444", text: "#7F1D1D" },
  CANCELLED:   { label: "Cancelled",         dot: "#9CA3AF", text: "#374151" },
  UNAVAILABLE: { label: "No longer available", dot: "#EF4444", text: "#7F1D1D" },
}

// ── CardBadge ─────────────────────────────────────────────────────────────────

function CardBadge({ badgeKey }: { badgeKey: BadgeKey }) {
  const cfg = BADGE_CONFIG[badgeKey] ?? BADGE_CONFIG.CANCELLED
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: "#fff", borderRadius: 999, padding: "5px 12px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.14)", fontSize: 13, fontWeight: 500,
      color: cfg.text, userSelect: "none",
    }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: cfg.dot, flexShrink: 0 }} />
      {cfg.label}
    </div>
  )
}

// ── StatusBadge (legacy, used in OfferRow / HistoryRow) ───────────────────────

const STATUS_CONFIG: Record<TradeStatus, { label: string; bg: string; color: string; icon: IconName }> = {
  PENDING:    { label: "Awaiting response",         bg: "rgba(255,178,62,.12)", color: "#9A6208", icon: "clock"   },
  ACCEPTED:   { label: "Accepted — arrange meetup", bg: "rgba(60,113,67,.1)",   color: "#3C7143", icon: "check"   },
  CONFIRMING: { label: "Confirming",                bg: "rgba(60,113,67,.12)",  color: "#2A5B31", icon: "refresh" },
  COMPLETED:  { label: "Completed",                 bg: "rgba(60,113,67,.12)",  color: "#2A5B31", icon: "check"   },
  REJECTED:   { label: "Declined",                  bg: "rgba(190,30,30,.08)",  color: "#A01818", icon: "x"       },
  CANCELLED:  { label: "Cancelled",                 bg: "rgba(0,0,0,.06)",      color: "#777",    icon: "x"       },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as TradeStatus] ?? STATUS_CONFIG.CANCELLED
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px",
      borderRadius: 20, fontSize: 12, fontWeight: 600,
      background: cfg.bg, color: cfg.color,
    }}>
      <Icon name={cfg.icon} size={12} />
      {cfg.label}
    </span>
  )
}

// ── Confirm dialog ────────────────────────────────────────────────────────────

function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel, loading }: {
  title:        string
  body:         string
  confirmLabel: string
  onConfirm:    () => void
  onCancel:     () => void
  loading:      boolean
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onCancel}
        style={{
          position: "fixed", inset: 0, zIndex: 1040,
          background: "rgba(0,0,0,0.36)", backdropFilter: "blur(2px)",
        }}
      />
      {/* Dialog */}
      <div style={{
        position: "fixed", top: "50%", left: "50%", zIndex: 1050,
        transform: "translate(-50%,-50%)",
        background: "#fff", borderRadius: 16, padding: "28px 28px 24px",
        width: 360, maxWidth: "calc(100vw - 32px)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.22)",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
          <div style={{ color: "#EF4444", flexShrink: 0, marginTop: 1 }}>
            <Icon name="alertTriangle" size={22} />
          </div>
          <div>
            <p style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "#111" }}>{title}</p>
            <p style={{ margin: 0, fontSize: 14, color: "#555", lineHeight: 1.5 }}>{body}</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: "9px 18px", borderRadius: 10, border: "1px solid #E5E7EB",
              background: "#fff", color: "#374151", fontSize: 14, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit", opacity: loading ? 0.5 : 1,
            }}
          >
            Keep it
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              padding: "9px 18px", borderRadius: 10, border: "none",
              background: "#EF4444", color: "#fff", fontSize: 14, fontWeight: 600,
              cursor: loading ? "wait" : "pointer", fontFamily: "inherit", opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ msg, type, onDone }: { msg: string; type: "success" | "error"; onDone: () => void }) {
  React.useEffect(() => {
    const t = setTimeout(onDone, 3200)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <>
      <style>{`@keyframes _tSlide{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`}</style>
      <div style={{
        position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
        background: type === "success" ? "#3C7143" : "#A01818", color: "#fff",
        padding: "12px 22px", borderRadius: 10, fontSize: 14, fontWeight: 600,
        boxShadow: "0 4px 20px rgba(0,0,0,.18)", whiteSpace: "nowrap",
        fontFamily: "inherit", animation: "_tSlide .22s ease",
      }}>
        {msg}
      </div>
    </>
  )
}

// ── KebabMenu ─────────────────────────────────────────────────────────────────

interface KebabItem {
  icon:        IconName
  label:       string
  onClick:     () => void
  destructive?: boolean
  disabled?:   boolean
}

function KebabMenu({ items }: { items: KebabItem[] }) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const nonDestructive = items.filter((i) => !i.destructive)
  const destructive    = items.filter((i) => i.destructive)

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        style={{
          width: 40, height: 40, borderRadius: 10,
          border: "1px solid #E5E7EB", background: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", color: "#374151", flexShrink: 0,
          transition: "background .12s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#F9FAFB")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
        aria-label="More options"
      >
        <Icon name="moreHorizontal" size={18} />
      </button>

      {open && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", right: 0, zIndex: 200,
          background: "#fff", borderRadius: 14, width: 232,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: "8px 0",
          border: "1px solid rgba(0,0,0,0.06)",
        }}>
          {nonDestructive.map((item) => (
            <button
              key={item.label}
              onClick={(e) => { e.stopPropagation(); setOpen(false); if (!item.disabled) item.onClick() }}
              disabled={item.disabled}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "0 16px", height: 42, border: "none", background: "none",
                cursor: item.disabled ? "default" : "pointer", fontFamily: "inherit",
                fontSize: 15, fontWeight: 500, color: item.disabled ? "#9CA3AF" : "#111",
                textAlign: "left", transition: "background .1s",
              }}
              onMouseEnter={(e) => { if (!item.disabled) e.currentTarget.style.background = "#F9FAFB" }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none" }}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
            </button>
          ))}

          {destructive.length > 0 && (
            <>
              <div style={{ height: 1, background: "#F3F4F6", margin: "4px 0" }} />
              {destructive.map((item) => (
                <button
                  key={item.label}
                  onClick={(e) => { e.stopPropagation(); setOpen(false); item.onClick() }}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 10,
                    padding: "0 16px", height: 42, border: "none", background: "none",
                    cursor: "pointer", fontFamily: "inherit",
                    fontSize: 15, fontWeight: 500, color: "#EF4444",
                    textAlign: "left", transition: "background .1s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#FEF2F2")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                >
                  <Icon name={item.icon} size={18} />
                  {item.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── TradeCard — new two-zone design ──────────────────────────────────────────

function resolveBadgeKey(trade: SerializedTrade, myId: string): BadgeKey {
  if (trade.status === "REJECTED") {
    // If the "their item" is TRADED, it was claimed by someone else — show "No longer available"
    const isSender   = trade.sender.id === myId
    const theirItem  = isSender ? trade.requestedItem : trade.offeredItem
    if (theirItem.itemStatus === "TRADED") return "UNAVAILABLE"
  }
  return trade.status as BadgeKey
}

function TradeCard({ trade, myId, onConfirm, onCompleted, onCancel, onHide, onOpenChat }: {
  trade:       SerializedTrade
  myId:        string
  onConfirm:   (t: SerializedTrade) => void
  onCompleted: (t: SerializedTrade) => void
  onCancel:    (t: SerializedTrade) => void
  onHide:      (t: SerializedTrade) => void
  onOpenChat:  (name: string, partnerId: string) => void
}) {
  const [imgErr, setImgErr] = React.useState(false)

  const isSender  = trade.sender.id === myId
  const myItem    = isSender ? trade.offeredItem   : trade.requestedItem
  const theirItem = isSender ? trade.requestedItem : trade.offeredItem
  const partner   = isSender ? trade.receiver      : trade.sender

  const badgeKey  = resolveBadgeKey(trade, myId)
  const canConfirm = trade.status === "ACCEPTED" || trade.status === "CONFIRMING"
  const isDead     = ["COMPLETED", "REJECTED", "CANCELLED"].includes(trade.status)
  const isCancellable = ["PENDING", "ACCEPTED", "CONFIRMING"].includes(trade.status)

  const leavesOnly = isLeavesOnlyTrade(trade.offeredItem.id, trade.requestedItem.id)
  const titleStr   = formatTradeTitleStr(
    myItem.title,
    theirItem.title,
    trade.offeredLeaves,
    leavesOnly,
    isSender,
  )

  const kebabItems: KebabItem[] = [
    {
      icon: "messageSquare",
      label: "Open chat",
      onClick: () => onOpenChat(partner.name, partner.id),
    },
    ...(isCancellable ? [{
      icon: "xCircle" as IconName,
      label: "Cancel trade",
      onClick: () => onCancel(trade),
      destructive: true,
    }] : []),
    ...(isDead ? [{
      icon: "eyeOff" as IconName,
      label: trade.status === "COMPLETED" ? "Remove from history" : "Remove",
      onClick: () => onHide(trade),
      destructive: true,
    }] : []),
  ]

  return (
    <div style={{
      borderRadius: 16, overflow: "hidden",
      background: "#fff",
      boxShadow: "0 2px 12px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.04)",
      display: "flex", flexDirection: "column",
    }}>
      {/* Top: image zone */}
      <div style={{ position: "relative", height: 270, background: "#F0F0F2", flexShrink: 0 }}>
        {myItem.image && !imgErr ? (
          <img
            src={myItem.image}
            alt={myItem.title}
            onError={() => setImgErr(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div style={{
            width: "100%", height: "100%",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 8,
          }}>
            <svg width={40} height={40} viewBox="0 0 24 24" fill="none"
                 stroke="#9CA3AF" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              <path d="M17 3l4 4-4 4" /><path d="M21 7H11" />
              <circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#6B7280" }}>No image</span>
          </div>
        )}

        {/* Status badge — top left */}
        <div style={{ position: "absolute", top: 12, left: 12 }}>
          <CardBadge badgeKey={badgeKey} />
        </div>
      </div>

      {/* Bottom: info zone */}
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Title */}
        <p style={{
          margin: 0, fontSize: 17, fontWeight: 700, color: "#1A1A1A", lineHeight: 1.3,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }} title={titleStr}>
          {titleStr}
        </p>

        {/* Subline */}
        <p style={{ margin: 0, fontSize: 14, color: "#6B7280", lineHeight: 1.4 }}>
          with {partner.name} · {timeAgo(trade.createdAt)}
        </p>

        {/* Action row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4, gap: 8 }}>
          {/* Leaves value */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
            {trade.myItemLeaves != null && trade.myItemLeaves > 0 ? (
              <>
                <span style={{ fontSize: 22, fontWeight: 700, color: "#1A1A1A", lineHeight: 1 }}>
                  {trade.myItemLeaves.toLocaleString()}
                </span>
                <span style={{ fontSize: 13, color: "#6B7280", fontWeight: 500 }}>Leaves</span>
              </>
            ) : (
              <span style={{ fontSize: 13, color: "#D1D5DB" }}>—</span>
            )}
          </div>

          {/* Right: action buttons */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {canConfirm && (
              <button
                onClick={() => onConfirm(trade)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "0 14px", height: 38, borderRadius: 10,
                  border: "none", background: "#3C7143", color: "#fff",
                  fontSize: 13, fontWeight: 700, fontFamily: "inherit",
                  cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
                }}
              >
                <Icon name="check" size={14} />
                Confirm Swap
              </button>
            )}
            <KebabMenu items={kebabItems} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── OfferRow — Offers tab ─────────────────────────────────────────────────────

const FAIRNESS_CFG = {
  generous: { label: "Generous offer", bg: "rgba(60,113,67,.1)",   color: "#3C7143"  },
  fair:     { label: "Fair offer",     bg: "rgba(255,178,62,.12)", color: "#9A6208"  },
  low:      { label: "Low offer",      bg: "rgba(190,30,30,.08)",  color: "#A01818"  },
}

const CARD: React.CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  border: "1px solid rgba(45,47,34,.09)",
  padding: "20px",
  display: "flex",
  flexDirection: "column",
  gap: 14,
  boxShadow: "0 1px 3px rgba(0,0,0,.04)",
  transition: "box-shadow .15s, transform .15s",
}

function OfferRow({ offer, onAccept, onDecline, loadingId }: {
  offer:     SerializedOffer
  onAccept:  (id: string) => void
  onDecline: (id: string) => void
  loadingId: string | null
}) {
  const [hov, setHov] = React.useState(false)
  const busy = loadingId === offer.id
  const firstItem = offer.offeredItems[0] ?? null

  return (
    <div
      style={{
        ...CARD,
        boxShadow: hov ? "0 6px 20px rgba(0,0,0,.1)" : CARD.boxShadow,
        transform: hov ? "translateY(-2px)" : "none",
        outline: "1.5px solid rgba(60,113,67,.22)",
        outlineOffset: "-1.5px",
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
        {firstItem ? (
          <ItemThumb title={firstItem.title} image={firstItem.image} size={72} />
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 72, height: 72, borderRadius: 12, background: "#EEF2EB",
              display: "flex", alignItems: "center", justifyContent: "center", color: "#3C7143",
            }}>
              <Icon name="leaves" size={24} />
            </div>
            <span style={{ fontSize: 11, color: "#888" }}>Points only</span>
          </div>
        )}
        <div style={{ color: "#3C7143", flexShrink: 0 }}>
          <Icon name="arrowLeftRight" size={20} />
        </div>
        <ItemThumb title={offer.post.title} image={offer.post.image} size={72} />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Avatar name={offer.sender.name} src={offer.sender.avatar} size={28} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>{offer.sender.name}</div>
            <div style={{ marginTop: 2 }}>
              <CompactRepBadge
                rating={offer.sender.rating}
                totalTrades={offer.sender.totalTrades}
              />
            </div>
          </div>
        </div>
        <span style={{ fontSize: 12, color: "#bbb" }}>{timeAgo(offer.createdAt)}</span>
      </div>

      {(offer.fairness || (offer.offeredLeaves && offer.offeredLeaves > 0)) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {offer.fairness && (() => {
            const f = FAIRNESS_CFG[offer.fairness]
            return (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px",
                borderRadius: 20, fontSize: 11, fontWeight: 700, background: f.bg, color: f.color,
              }}>
                <Icon name="tag" size={10} />
                {f.label}
              </span>
            )
          })()}
          {offer.offeredLeaves && offer.offeredLeaves > 0 && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px",
              borderRadius: 20, fontSize: 11, fontWeight: 700,
              background: "rgba(60,113,67,.1)", color: "#3C7143",
            }}>
              <Icon name="leaves" size={10} />
              +{offer.offeredLeaves.toLocaleString()} Leaves
            </span>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => onDecline(offer.id)}
          disabled={!!loadingId}
          style={{
            flex: 1, padding: "9px 0", borderRadius: 10, fontFamily: "inherit",
            border: "1.5px solid rgba(45,47,34,.12)", background: "transparent",
            color: "#555", fontSize: 13, fontWeight: 600,
            cursor: loadingId ? "wait" : "pointer", opacity: loadingId ? 0.6 : 1,
            transition: "background .12s",
          }}
          onMouseEnter={(e) => { if (!loadingId) e.currentTarget.style.background = "rgba(0,0,0,.04)" }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
        >
          {busy ? "…" : "Decline"}
        </button>
        <button
          onClick={() => onAccept(offer.id)}
          disabled={!!loadingId}
          style={{
            flex: 2, padding: "9px 0", borderRadius: 10, fontFamily: "inherit",
            border: "none", background: "#3C7143", color: "#fff",
            fontSize: 13, fontWeight: 600,
            cursor: loadingId ? "wait" : "pointer", opacity: loadingId ? 0.6 : 1,
            transition: "filter .12s",
          }}
          onMouseEnter={(e) => { if (!loadingId) e.currentTarget.style.filter = "brightness(1.08)" }}
          onMouseLeave={(e) => { e.currentTarget.style.filter = "" }}
        >
          {busy ? "…" : "Accept"}
        </button>
      </div>
    </div>
  )
}

// ── HistoryRow — History tab ──────────────────────────────────────────────────

function HistoryRow({ trade, myId, onHide, onRate }: {
  trade:  SerializedTrade
  myId:   string
  onHide: (t: SerializedTrade) => void
  onRate: (t: SerializedTrade) => void
}) {
  const [hov, setHov] = React.useState(false)
  const partner = trade.sender.id === myId ? trade.receiver : trade.sender
  const isCompleted = trade.status === "COMPLETED"
  const alreadyRated = isCompleted && trade.myReview !== null

  return (
    <div
      style={{
        ...CARD,
        flexDirection: "row", alignItems: "center", gap: 16,
        boxShadow: hov ? "0 4px 16px rgba(0,0,0,.08)" : CARD.boxShadow,
        transform: hov ? "translateY(-1px)" : "none",
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div style={{ color: "#9A6208", flexShrink: 0 }}>
        <Icon name="trophy" size={28} />
      </div>

      {(() => {
        const histLeavesOnly = isLeavesOnlyTrade(trade.offeredItem.id, trade.requestedItem.id)
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            {histLeavesOnly && (trade.offeredLeaves ?? 0) > 0 ? (
              <LeavesThumb leaves={trade.offeredLeaves!} size={56} />
            ) : (
              <ItemThumb title={trade.offeredItem.title} image={trade.offeredItem.image} size={56} />
            )}
            <div style={{ color: "#3C7143", flexShrink: 0 }}>
              <Icon name="arrowLeftRight" size={16} />
            </div>
            <ItemThumb title={trade.requestedItem.title} image={trade.requestedItem.image} size={56} />
          </div>
        )
      })()}

      <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0, alignItems: "flex-end" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Avatar name={partner.name} src={partner.avatar} size={22} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#444" }}>{partner.name}</span>
        </div>
        <span style={{ fontSize: 11, color: "#bbb" }}>{formatDate(trade.updatedAt)}</span>

        {trade.co2Saved !== null && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px",
            borderRadius: 20, fontSize: 11, fontWeight: 700,
            background: "rgba(60,113,67,.1)", color: "#3C7143",
          }}>
            <Icon name="leaf" size={11} />
            {trade.co2Saved} kg CO₂ saved
          </span>
        )}

        {/* Rate / Rated button — only for COMPLETED trades */}
        {isCompleted && (
          alreadyRated ? (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px",
              borderRadius: 8, fontSize: 11, fontWeight: 700,
              color: "#9A6208", background: "rgba(154,98,8,.08)",
            }}>
              <Icon name="star" size={11} filled />
              Rated {trade.myReview!.rating}
            </span>
          ) : (
            <button
              onClick={() => onRate(trade)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(60,113,67,.25)",
                background: "rgba(60,113,67,.06)", color: "#3C7143",
                fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                transition: "background .12s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(60,113,67,.12)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(60,113,67,.06)")}
            >
              <Icon name="star" size={11} />
              Rate {partner.name.split(" ")[0]}
            </button>
          )
        )}

        <button
          onClick={() => onHide(trade)}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "3px 8px", borderRadius: 8, border: "none",
            background: "none", color: "#9CA3AF", fontSize: 11,
            cursor: "pointer", fontFamily: "inherit",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#EF4444")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#9CA3AF")}
        >
          <Icon name="eyeOff" size={11} />
          Remove
        </button>
      </div>
    </div>
  )
}

// ── EmptyState ────────────────────────────────────────────────────────────────

function EmptyState({ icon, title, sub }: { icon: IconName; title: string; sub: string }) {
  return (
    <div style={{
      border: "2px dashed rgba(60,113,67,.18)", borderRadius: 16,
      padding: "56px 32px", textAlign: "center",
    }}>
      <div style={{ color: "rgba(60,113,67,.28)", marginBottom: 14 }}>
        <Icon name={icon} size={40} />
      </div>
      <p style={{ fontSize: 15, fontWeight: 700, color: "#555", margin: "0 0 6px", fontFamily: "'Playfair Display', Georgia, serif", fontStyle: "italic" }}>
        {title}
      </p>
      <p style={{ fontSize: 13, color: "#aaa", margin: 0 }}>{sub}</p>
    </div>
  )
}

// ── TradesClient ──────────────────────────────────────────────────────────────

type TabKey = "active" | "offers" | "history"
type ActiveFilter = "all" | "awaiting" | "confirming"

interface DialogState {
  trade:         SerializedTrade
  action:        "cancel" | "hide"
}

export default function TradesClient({
  me, trades: initialTrades, initialOffers, myId, followReqCount, notifs, messages,
  weeklyTrades, weeklyCO2, trendingTags,
}: {
  me:             Me
  trades:         SerializedTrade[]
  initialOffers:  SerializedOffer[]
  myId:           string
  followReqCount: number
  notifs:         Notif[]
  messages:       Message[]
  weeklyTrades?:  number
  weeklyCO2?:     number
  trendingTags?:  string[]
}) {
  const router = useRouter()

  const [tab,            setTab]            = React.useState<TabKey>("active")
  const [filter,         setFilter]         = React.useState<ActiveFilter>("all")
  const [nudgeDismissed, setNudgeDismissed] = React.useState(false)
  const [offers,         setOffers]         = React.useState<SerializedOffer[]>(initialOffers)
  const [loadingOffer,   setLoadingOffer]   = React.useState<string | null>(null)
  const [toast,          setToast]          = React.useState<{ msg: string; type: "success" | "error" } | null>(null)
  const [dark,           setDark]           = React.useState(false)
  const [chatWindows,    setChatWindows]    = React.useState<ChatWindow[]>([])
  const [trades,         setTrades]         = React.useState<SerializedTrade[]>(initialTrades)
  const [dialog,         setDialog]         = React.useState<DialogState | null>(null)

  // Sync server-rendered initialTrades into state whenever router.refresh() re-renders the page.
  // Without this, useState(initialTrades) only uses the initial value; new trades from accepted
  // offers never appear unless the component fully remounts.
  React.useEffect(() => {
    setTrades(initialTrades)
  // initialTrades is a new reference on every server render — that's the signal we want.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTrades])
  const [dialogLoading,  setDialogLoading]  = React.useState(false)
  const [ratingTrade,    setRatingTrade]    = React.useState<SerializedTrade | null>(null)
  const [confirmTrade,   setConfirmTrade]   = React.useState<SerializedTrade | null>(null)
  const [completedByPartnerId, setCompletedByPartnerId] = React.useState<Record<string, { tradeId: string; partnerName: string }>>({})

  function clearCompletedForTrade(tradeId: string) {
    setCompletedByPartnerId(prev => {
      const next = { ...prev }
      for (const k of Object.keys(next)) { if (next[k].tradeId === tradeId) delete next[k] }
      return next
    })
  }

  // ── Pusher: real-time trade status updates ────────────────────────────────
  React.useEffect(() => {
    const ch = subscribeChannel(`private-user-${myId}`)
    if (!ch) return

    function handleStatusChanged(data: { tradeId: string; newStatus: string; reason?: string; itemIds?: string[] }) {
      setTrades((prev) =>
        prev.map((t) => {
          if (t.id !== data.tradeId) return t
          // Update status and, if item is now unavailable, reflect item statuses
          const updated: SerializedTrade = {
            ...t,
            status: data.newStatus,
          }
          if (data.newStatus === "COMPLETED" && data.itemIds) {
            updated.offeredItem   = { ...t.offeredItem,   itemStatus: data.itemIds.includes(t.offeredItem.id)   ? "TRADED" : t.offeredItem.itemStatus }
            updated.requestedItem = { ...t.requestedItem, itemStatus: data.itemIds.includes(t.requestedItem.id) ? "TRADED" : t.requestedItem.itemStatus }
          }
          return updated
        })
      )
    }

    ch.bind("trade-status-changed", handleStatusChanged)
    return () => {
      ch.unbind("trade-status-changed", handleStatusChanged)
      unsubscribeChannel(`private-user-${myId}`)
    }
  }, [myId])

  function openChat(name: string, partnerId: string) {
    setChatWindows((prev) => {
      const existing = prev.find((w) => w.partnerId === partnerId)
      if (existing) return prev.map((w) => w.partnerId === partnerId ? { ...w, minimized: false } : w)
      return [...prev, { name, partnerId, minimized: false }]
    })
  }

  const activeTrades  = trades.filter((t) => ["PENDING", "ACCEPTED", "CONFIRMING"].includes(t.status))
  const historyTrades = trades.filter((t) => ["COMPLETED", "REJECTED", "CANCELLED"].includes(t.status))

  const filteredActive = (() => {
    if (filter === "awaiting")   return activeTrades.filter((t) => t.status === "PENDING")
    if (filter === "confirming") return activeTrades.filter((t) => t.status === "ACCEPTED" || t.status === "CONFIRMING")
    return activeTrades
  })()

  const showNudge = tab !== "offers" && !nudgeDismissed && offers.length > 0

  // ── Offer actions ──────────────────────────────────────────────────────────

  async function handleOfferAction(offerId: string, action: "accept" | "decline") {
    setLoadingOffer(offerId)
    try {
      const res = await fetch(`/api/offers/${offerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error()
      setOffers((prev) => prev.filter((o) => o.id !== offerId))
      if (action === "accept") {
        setToast({ msg: "Offer accepted — arrange your meetup.", type: "success" })
        setTab("active")
        router.refresh()
      } else {
        setToast({ msg: "Offer declined.", type: "success" })
      }
    } catch {
      setToast({ msg: "Something went wrong. Please try again.", type: "error" })
    } finally {
      setLoadingOffer(null)
    }
  }

  // ── Dialog: confirm cancel / hide ─────────────────────────────────────────

  function openCancelDialog(trade: SerializedTrade) {
    setDialog({ trade, action: "cancel" })
  }

  function openHideDialog(trade: SerializedTrade) {
    setDialog({ trade, action: "hide" })
  }

  async function handleDialogConfirm() {
    if (!dialog) return
    setDialogLoading(true)
    const { trade, action } = dialog

    try {
      const res = await fetch(`/api/trades/${trade.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? "Request failed")
      }

      if (action === "cancel") {
        setTrades((prev) => prev.map((t) => t.id === trade.id ? { ...t, status: "CANCELLED" } : t))
        setToast({ msg: "Trade cancelled.", type: "success" })
      } else {
        setTrades((prev) => prev.filter((t) => t.id !== trade.id))
        setToast({
          msg: trade.status === "COMPLETED" ? "Removed from history." : "Removed.",
          type: "success",
        })
      }
      setDialog(null)
    } catch (err) {
      setToast({ msg: err instanceof Error ? err.message : "Something went wrong.", type: "error" })
      setDialog(null)
    } finally {
      setDialogLoading(false)
    }
  }

  // ── Rating callback ────────────────────────────────────────────────────────

  function handleRated(tradeId: string, stars: number) {
    setTrades((prev) =>
      prev.map((t) => t.id === tradeId ? { ...t, myReview: { rating: stars } } : t)
    )
    setRatingTrade(null)
    clearCompletedForTrade(tradeId)
    setToast({ msg: "Review submitted. Thank you!", type: "success" })
    router.refresh()
  }

  // ── Tab config ─────────────────────────────────────────────────────────────

  const TABS: { key: TabKey; icon: IconName; label: string; count: number }[] = [
    { key: "active",  icon: "arrowLeftRight", label: "Active",  count: activeTrades.length },
    { key: "offers",  icon: "inbox",          label: "Offers",  count: offers.length        },
    { key: "history", icon: "trophy",         label: "History", count: historyTrades.length  },
  ]

  const FILTERS: { key: ActiveFilter; label: string; count: number }[] = [
    { key: "all",        label: "All",              count: activeTrades.length },
    { key: "awaiting",   label: "Awaiting reply",   count: activeTrades.filter((t) => t.status === "PENDING").length },
    { key: "confirming", label: "Ready to confirm", count: activeTrades.filter((t) => ["ACCEPTED","CONFIRMING"].includes(t.status)).length },
  ]

  const rootStyle = {
    "--accent":     "#3C7143",
    "--accent-ink": "#F4EAEB",
    "--r-lg":       "16px",
    "--r-md":       "12px",
    "--r-sm":       "8px",
  } as React.CSSProperties

  return (
    <div className="baylo layout-classic" data-theme={dark ? "dark" : "light"} data-density="regular" style={rootStyle}>
      <TopNav
        me={{ name: me.name, handle: me.handle, avatar: me.avatar, greenScore: 0 }}
        dark={dark}
        onToggleTheme={() => setDark((d) => !d)}
        onOpenChat={openChat}
        followReqCount={followReqCount}
        unreadMsgsCount={messages.filter((m) => m.unread).length}
        unreadNotifsCount={notifs.filter((n) => n.unread).length}
        notifs={notifs}
        messages={messages}
      />
      <div className="shell">

        {/* ── Sidebar ───────────────────────────────────────────────────── */}
        <DashSidebar
          me={me}
          tradeBadge={activeTrades.length + offers.length}
          weeklyTrades={weeklyTrades}
          weeklyCO2={weeklyCO2}
          trendingTags={trendingTags}
        />

        {/* ── Main column ───────────────────────────────────────────────── */}
        <div style={{
          minWidth: 0, display: "flex", flexDirection: "column",
          height: "100%", background: "#F7F5F0",
          overflow: "hidden",
        }}>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", scrollbarWidth: "none" }}>

          {/* ── Tab bar (sticky) ────────────────────────────────────────── */}
          <div style={{
            position: "sticky", top: 0, zIndex: 20,
            background: "#F7F5F0",
            borderBottom: "1px solid rgba(45,47,34,.09)",
            display: "flex", alignItems: "stretch",
            padding: "0 32px", gap: 0,
          }}>
            <div style={{ display: "flex", alignItems: "stretch", flex: 1, gap: 0 }}>
              {TABS.map((t) => {
                const on = tab === t.key
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    style={{
                      display: "flex", alignItems: "center", gap: 7,
                      padding: "16px 14px",
                      background: "none", border: "none", cursor: "pointer",
                      fontFamily: "inherit", fontSize: 14, fontWeight: 600,
                      color: on ? "#3C7143" : "#777",
                      borderBottom: on ? "2.5px solid #3C7143" : "2.5px solid transparent",
                      marginBottom: -1,
                      transition: "color .12s, border-color .12s",
                    }}
                  >
                    <Icon name={t.icon} size={16} />
                    {t.label}
                    {t.count > 0 && (
                      <span style={{
                        minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999,
                        background: on ? "#3C7143" : "rgba(45,47,34,.1)",
                        color: on ? "#fff" : "#555",
                        fontSize: 11, fontWeight: 700,
                        display: "inline-grid", placeItems: "center",
                      }}>
                        {t.count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingLeft: 12 }}>
              <div className="leaves-pill" style={{ cursor: "default" }}>
                <Icon name="leaves" size={14} />
                <span>{me.leaves.toLocaleString("en-US")} Leaves</span>
              </div>
              <button
                onClick={() => router.push("/dashboard/tradeplace")}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 16px", borderRadius: 10, border: "none",
                  background: "#3C7143", color: "#fff",
                  fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                  transition: "filter .12s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.08)")}
                onMouseLeave={(e) => (e.currentTarget.style.filter = "")}
              >
                <Icon name="plus" size={14} />
                Add listing
              </button>
            </div>
          </div>

          {/* ── Nudge bar ─────────────────────────────────────────────────── */}
          {showNudge && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 32px",
              background: "rgba(60,113,67,.07)",
              borderBottom: "1px solid rgba(60,113,67,.1)",
            }}>
              <span style={{ color: "#3C7143" }}><Icon name="inbox" size={16} /></span>
              <span style={{ flex: 1, fontSize: 13, color: "#3C7143", fontWeight: 600 }}>
                {offers.length === 1 ? "1 new offer" : `${offers.length} new offers`} waiting on your listings — accept or decline before they expire.
              </span>
              <button
                onClick={() => setTab("offers")}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: "none", border: "none", fontFamily: "inherit",
                  fontSize: 13, fontWeight: 700, color: "#3C7143", cursor: "pointer",
                }}
              >
                Review <Icon name="arrowRight" size={14} />
              </button>
              <button
                onClick={() => setNudgeDismissed(true)}
                aria-label="Dismiss"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "#999", display: "flex", padding: 4,
                }}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          )}

          {/* ── Tab content ───────────────────────────────────────────────── */}
          <div style={{
            padding: "28px 32px 80px",
            maxWidth: 1240, width: "100%", margin: "0 auto",
            flexGrow: 1,
          }}>

            {/* ACTIVE */}
            {tab === "active" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {activeTrades.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {FILTERS.map((f) => {
                      const on = filter === f.key
                      return (
                        <button
                          key={f.key}
                          onClick={() => setFilter(f.key)}
                          style={{
                            display: "flex", alignItems: "center", gap: 5,
                            padding: "6px 14px", borderRadius: 20, border: "none",
                            fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                            cursor: "pointer", transition: "background .12s, color .12s",
                            background: on ? "#3C7143" : "rgba(45,47,34,.07)",
                            color: on ? "#fff" : "#555",
                          }}
                        >
                          {f.label}
                          {f.count > 0 && (
                            <span style={{
                              minWidth: 16, height: 16, padding: "0 4px", borderRadius: 999,
                              background: on ? "rgba(255,255,255,.22)" : "rgba(45,47,34,.1)",
                              fontSize: 10, fontWeight: 700,
                              display: "inline-grid", placeItems: "center",
                            }}>
                              {f.count}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}

                {filteredActive.length > 0 ? (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 330px))",
                    gap: 20,
                  }}>
                    {filteredActive.map((t) => (
                      <TradeCard
                        key={t.id}
                        trade={t}
                        myId={myId}
                        onConfirm={setConfirmTrade}
                        onCompleted={(t) => { setRatingTrade(t); router.refresh() }}
                        onCancel={openCancelDialog}
                        onHide={openHideDialog}
                        onOpenChat={openChat}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon="arrowLeftRight"
                    title="No active trades"
                    sub="Accept an offer on the Tradeplace to start one."
                  />
                )}
              </div>
            )}

            {/* OFFERS */}
            {tab === "offers" && (
              offers.length > 0 ? (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 16,
                }}>
                  {offers.map((o) => (
                    <OfferRow
                      key={o.id}
                      offer={o}
                      onAccept={(id) => handleOfferAction(id, "accept")}
                      onDecline={(id) => handleOfferAction(id, "decline")}
                      loadingId={loadingOffer}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon="inbox"
                  title="No pending offers"
                  sub="When someone makes an offer on your listings, it appears here."
                />
              )
            )}

            {/* HISTORY */}
            {tab === "history" && (
              historyTrades.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {historyTrades.map((t) => (
                    <HistoryRow
                      key={t.id}
                      trade={t}
                      myId={myId}
                      onHide={openHideDialog}
                      onRate={setRatingTrade}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon="trophy"
                  title="No completed trades yet"
                  sub="Finished swaps will be logged here with your eco-impact."
                />
              )
            )}
          </div>
          </div>{/* inner scroll */}
        </div>
      </div>


      {/* ── Cancel / hide confirmation dialog ───────────────────────────────── */}
      {dialog && (
        <ConfirmDialog
          title={
            dialog.action === "cancel"
              ? "Cancel this trade?"
              : dialog.trade.status === "COMPLETED"
              ? "Remove from history?"
              : "Remove this trade?"
          }
          body={
            dialog.action === "cancel"
              ? `This will notify ${
                  dialog.trade.sender.id === myId
                    ? dialog.trade.receiver.name
                    : dialog.trade.sender.name
                } and end the trade.`
              : dialog.trade.status === "COMPLETED"
              ? "This removes it from your view only and won’t undo the completed swap or affect your eco-impact score."
              : "This removes it from your list only."
          }
          confirmLabel={
            dialog.action === "cancel"
              ? "Cancel trade"
              : dialog.trade.status === "COMPLETED"
              ? "Remove from history"
              : "Remove"
          }
          onConfirm={handleDialogConfirm}
          onCancel={() => setDialog(null)}
          loading={dialogLoading}
        />
      )}

      {/* ── Swap confirm modal ──────────────────────────────────────────────── */}
      {confirmTrade && (() => {
        const ctLeavesOnly = isLeavesOnlyTrade(confirmTrade.offeredItem.id, confirmTrade.requestedItem.id)
        const ctOfferedTitle = ctLeavesOnly && (confirmTrade.offeredLeaves ?? 0) > 0
          ? `${confirmTrade.offeredLeaves!.toLocaleString()} Leaves`
          : confirmTrade.offeredItem.title
        return (
          <SwapConfirmModal
            tradeId={confirmTrade.id}
            offeredItemTitle={ctOfferedTitle}
            requestedItemTitle={confirmTrade.requestedItem.title}
            sender={confirmTrade.sender}
            receiver={confirmTrade.receiver}
            myId={myId}
            onClose={() => setConfirmTrade(null)}
            onCompleted={() => {
              const partner = confirmTrade.sender.id === myId ? confirmTrade.receiver : confirmTrade.sender
              setConfirmTrade(null)
              setRatingTrade(confirmTrade)
              setCompletedByPartnerId(prev => ({ ...prev, [partner.id]: { tradeId: confirmTrade.id, partnerName: partner.name } }))
            }}
          />
        )
      })()}

      {/* ── Rate trade modal ────────────────────────────────────────────────── */}
      {ratingTrade && (() => {
        const partner = ratingTrade.sender.id === myId ? ratingTrade.receiver : ratingTrade.sender
        return (
          <RateTradeModal
            tradeId={ratingTrade.id}
            partnerName={partner.name}
            onRated={handleRated}
            onClose={() => { setRatingTrade(null); router.refresh() }}
          />
        )
      })()}

      {/* ── Toast ───────────────────────────────────────────────────────────── */}
      {toast && (
        <Toast
          msg={toast.msg}
          type={toast.type}
          onDone={() => setToast(null)}
        />
      )}

      {/* ── Chat dock ───────────────────────────────────────────────────────── */}
      <ChatDock
        windows={chatWindows}
        myId={myId}
        onClose={(partnerId) => setChatWindows((prev) => prev.filter((w) => w.partnerId !== partnerId))}
        onMinimize={(partnerId) => setChatWindows((prev) => prev.map((w) => w.partnerId === partnerId ? { ...w, minimized: !w.minimized } : w))}
        completedByPartnerId={completedByPartnerId}
        onRateSwap={(tradeId) => {
          const trade = trades.find(t => t.id === tradeId)
          if (trade) setRatingTrade(trade)
        }}
      />
    </div>
  )
}
