"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import "../baylo-dashboard.css"
import TopNav, { Icon } from "../_shell/TopNav"
import type { Notif, Message } from "../_shell/TopNav"
import DashSidebar from "../_shell/DashSidebar"
import ChatDock from "../_shell/ChatDock"
import type { ChatWindow } from "../_shell/ChatDock"

// ── Types ──────────────────────────────────────────────────────────────────

export interface ShelfItem {
  id:         string
  title:      string
  status:     "AVAILABLE" | "OWNED"
  image:      string | null
  condition:  string
  leaves:     number | null
  lifeNumber: number
  createdAt:  string
}

export interface ShelfClientProps {
  me:             { name: string; handle: string; avatar: string | null }
  myId:           string
  items:          ShelfItem[]
  followReqCount: number
  notifs:         Notif[]
  messages:       Message[]
  weeklyTrades?:  number
  weeklyCO2?:     number
  trendingTags?:  string[]
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// ── Empty state (matches Trades style) ────────────────────────────────────

function EmptyState({ tab }: { tab: "available" | "owned" }) {
  return (
    <div style={{
      border: "2px dashed rgba(60,113,67,.18)", borderRadius: 16,
      padding: "56px 32px", textAlign: "center",
    }}>
      <div style={{ color: "rgba(60,113,67,.28)", marginBottom: 14 }}>
        <Icon name={tab === "available" ? "store" : "bookmark"} size={40} />
      </div>
      {tab === "available" ? (
        <>
          <p style={{
            fontSize: 15, fontWeight: 700, color: "#555", margin: "0 0 6px",
            fontFamily: "'Playfair Display', Georgia, serif", fontStyle: "italic",
          }}>
            You haven&apos;t listed anything yet
          </p>
          <p style={{ fontSize: 13, color: "#aaa", margin: "0 0 20px" }}>
            Head to Tradeplace to post your first item.
          </p>
          <Link href="/dashboard/tradeplace" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "#3C7143", color: "#F4EAEB",
            borderRadius: 10, padding: "10px 20px",
            fontWeight: 700, fontSize: 13, textDecoration: "none",
          }}>
            <Icon name="store" size={15} />
            Go to Tradeplace
          </Link>
        </>
      ) : (
        <>
          <p style={{
            fontSize: 15, fontWeight: 700, color: "#555", margin: "0 0 6px",
            fontFamily: "'Playfair Display', Georgia, serif", fontStyle: "italic",
          }}>
            Your inventory is empty
          </p>
          <p style={{ fontSize: 13, color: "#aaa", margin: 0 }}>
            Items you receive through trades will appear here, ready to re-list.
          </p>
        </>
      )}
    </div>
  )
}

// ── Shelf card (mirrors TradeCard design) ─────────────────────────────────

function ShelfCard({
  item, onRelist, relisting, onEdit, onClick,
}: {
  item:      ShelfItem
  onRelist:  (id: string) => void
  relisting: boolean
  onEdit:    (id: string) => void
  onClick?:  () => void
}) {
  const [imgErr, setImgErr] = useState(false)
  const isOwned = item.status === "OWNED"
  const conditionLabel = item.condition
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, c => c.toUpperCase())

  return (
    <div
      onClick={!isOwned ? onClick : undefined}
      style={{
        borderRadius: 16, overflow: "hidden",
        background: "#fff",
        boxShadow: "0 2px 12px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.04)",
        display: "flex", flexDirection: "column",
        cursor: !isOwned ? "pointer" : "default",
        transition: "box-shadow .15s, transform .15s",
      }}
      onMouseEnter={(e) => {
        if (!isOwned) {
          e.currentTarget.style.boxShadow = "0 6px 24px rgba(0,0,0,0.12)"
          e.currentTarget.style.transform = "translateY(-2px)"
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.04)"
        e.currentTarget.style.transform = "none"
      }}
    >
      {/* Image zone — same height as TradeCard */}
      <div style={{ position: "relative", height: 270, background: "#F0F0F2", flexShrink: 0 }}>
        {item.image && !imgErr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image}
            alt={item.title}
            onError={() => setImgErr(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div style={{
            width: "100%", height: "100%",
            background: "linear-gradient(135deg, #E8F0E4, #C7D9C2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#3C7143",
          }}>
            <Icon name="shelf" size={44} style={{ opacity: 0.28 }} />
          </div>
        )}

        {/* Nth-life badge */}
        <div style={{
          position: "absolute", top: 12, left: 12,
          background: "rgba(255,255,255,.92)",
          backdropFilter: "blur(6px)",
          color: "#3C7143", fontSize: 11, fontWeight: 700,
          borderRadius: 8, padding: "3px 8px",
          letterSpacing: ".3px",
        }}>
          {ordinal(item.lifeNumber)} life
        </div>

        {/* Status badge — matches CardBadge pill style from Trades */}
        <div style={{
          position: "absolute", top: 12, right: 12,
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "#fff", borderRadius: 999, padding: "5px 12px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.14)", fontSize: 13, fontWeight: 500,
          color: isOwned ? "#92400E" : "#1A3520",
          userSelect: "none",
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: isOwned ? "#F59E0B" : "#3C7143",
            flexShrink: 0,
          }} />
          {isOwned ? "In inventory" : "Available"}
        </div>
      </div>

      {/* Info zone */}
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{
          margin: 0, fontSize: 17, fontWeight: 700, color: "#1A1A1A", lineHeight: 1.3,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontFamily: "inherit",
        }}>
          {item.title}
        </p>

        <p style={{ margin: 0, fontSize: 14, color: "#6B7280", lineHeight: 1.4 }}>
          {conditionLabel}
        </p>

        <div style={{
          display: "flex", alignItems: "center",
          justifyContent: "space-between", marginTop: 4, gap: 8,
        }}>
          {item.leaves != null && item.leaves > 0 ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: "#1A1A1A", lineHeight: 1 }}>
                {item.leaves.toLocaleString()}
              </span>
              <span style={{ fontSize: 13, color: "#6B7280", fontWeight: 500 }}>Leaves</span>
            </div>
          ) : (
            <span style={{ fontSize: 13, color: "#D1D5DB" }}>—</span>
          )}

          {isOwned ? (
            <button
              onClick={(e) => { e.stopPropagation(); onRelist(item.id) }}
              disabled={relisting}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "0 14px", height: 40, borderRadius: 10,
                border: "1px solid #E5E7EB", background: "#fff",
                color: "#3C7143", fontSize: 13, fontWeight: 600,
                fontFamily: "inherit", cursor: relisting ? "wait" : "pointer",
                flexShrink: 0, transition: "background .12s",
                opacity: relisting ? 0.6 : 1,
              }}
              onMouseEnter={(e) => { if (!relisting) e.currentTarget.style.background = "#EFF7F0" }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff" }}
            >
              {relisting ? "Re-listing…" : "Re-list"}
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(item.id) }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "0 14px", height: 40, borderRadius: 10,
                border: "1px solid #E5E7EB", background: "#fff",
                color: "#374151", fontSize: 13, fontWeight: 600,
                fontFamily: "inherit", cursor: "pointer",
                flexShrink: 0, transition: "background .12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#F9FAFB" }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff" }}
            >
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function ShelfClient({
  me, myId, items, followReqCount, notifs, messages,
  weeklyTrades, weeklyCO2 = 0, trendingTags = [],
}: ShelfClientProps) {
  const router = useRouter()
  const [dark, setDark] = useState(false)
  const [chatWindows, setChatWindows] = useState<ChatWindow[]>([])
  const [tab, setTab] = useState<"available" | "owned">("available")
  const [relistingId, setRelistingId] = useState<string | null>(null)

  const available = items.filter(i => i.status === "AVAILABLE")
  const owned     = items.filter(i => i.status === "OWNED")
  const current   = tab === "available" ? available : owned

  const openChat = (name: string, partnerId: string) => {
    setChatWindows(prev => {
      if (prev.find(c => c.partnerId === partnerId)) return prev
      return [...prev, { name, partnerId, minimized: false }]
    })
  }

  const handleRelist = async (itemId: string) => {
    setRelistingId(itemId)
    try {
      const res = await fetch(`/api/items/${itemId}/relist`, { method: "POST" })
      if (res.ok) {
        router.refresh()
      } else {
        const { error } = await res.json().catch(() => ({ error: "Failed to re-list" }))
        alert(error ?? "Failed to re-list item")
      }
    } finally {
      setRelistingId(null)
    }
  }

  const TABS = [
    { key: "available" as const, icon: "store"    as const, label: "Available",         count: available.length },
    { key: "owned"     as const, icon: "bookmark" as const, label: "In your inventory", count: owned.length     },
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
        onToggleTheme={() => setDark(d => !d)}
        onOpenChat={openChat}
        followReqCount={followReqCount}
        unreadMsgsCount={messages.filter(m => m.unread).length}
        unreadNotifsCount={notifs.filter(n => n.unread).length}
        notifs={notifs}
        messages={messages}
      />

      <div className="shell">
        <DashSidebar
          me={me}
          weeklyTrades={weeklyTrades}
          weeklyCO2={weeklyCO2}
          trendingTags={trendingTags}
        />

        {/* ── Main column ───────────────────────────────────────────────── */}
        <div style={{
          minWidth: 0, display: "flex", flexDirection: "column",
          height: "100%", background: "#F7F5F0", overflow: "hidden",
        }}>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", scrollbarWidth: "none" }}>

            {/* Stats row */}
            <div style={{ padding: "32px 32px 0", maxWidth: 1240 }}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                {([
                  { icon: "shelf"    as const, label: "Total items",      value: items.length                      },
                  { icon: "store"    as const, label: "Available",        value: available.length                  },
                  { icon: "bookmark" as const, label: "In inventory",     value: owned.length                      },
                  { icon: "leaf"     as const, label: "CO₂ avoided (7d)", value: `${weeklyCO2.toFixed(1)} kg`     },
                ] as const).map(stat => (
                  <div key={stat.label} style={{
                    display: "flex", alignItems: "center", gap: 14,
                    background: "#fff",
                    borderRadius: 14,
                    padding: "14px 20px",
                    flex: "1 1 150px",
                    boxShadow: "0 1px 5px rgba(45,47,34,.07)",
                    border: "1px solid rgba(45,47,34,.06)",
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: "rgba(60,113,67,.08)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#3C7143", flexShrink: 0,
                    }}>
                      <Icon name={stat.icon} size={17} />
                    </div>
                    <div>
                      <div style={{
                        fontSize: 22, fontWeight: 700, lineHeight: 1.1,
                        color: "#1E3020",
                        fontFamily: "var(--font-display, 'Playfair Display', serif)",
                      }}>
                        {stat.value}
                      </div>
                      <div style={{ fontSize: 12, color: "#888", marginTop: 2, letterSpacing: ".01em" }}>
                        {stat.label}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tab bar (sticky) — matches Trades exactly */}
            <div style={{
              position: "sticky", top: 0, zIndex: 20,
              background: "#F7F5F0",
              borderBottom: "1px solid rgba(45,47,34,.09)",
              display: "flex", alignItems: "stretch",
              padding: "0 32px", gap: 0,
              marginTop: 28,
            }}>
              <div style={{ display: "flex", alignItems: "stretch", flex: 1, gap: 0 }}>
                {TABS.map(t => {
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

              {/* Right side — matches Trades' "Add listing" button */}
              <div style={{ display: "flex", alignItems: "center", paddingLeft: 12 }}>
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
                  Post to Tradeplace
                </button>
              </div>
            </div>

            {/* Card grid / empty state — matches Trades content padding */}
            <div style={{ padding: "28px 32px 80px", maxWidth: 1240, width: "100%", margin: "0 auto" }}>
              {current.length === 0 ? (
                <EmptyState tab={tab} />
              ) : (
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 20,
                }}>
                  {current.map(item => (
                    <ShelfCard
                      key={item.id}
                      item={item}
                      onRelist={handleRelist}
                      relisting={relistingId === item.id}
                      onEdit={(id) => router.push(`/dashboard/tradeplace?edit=${id}`)}
                      onClick={() => router.push(`/dashboard/tradeplace?open=${item.id}`)}
                    />
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      <ChatDock
        windows={chatWindows}
        myId={myId}
        onClose={(pid) => setChatWindows(prev => prev.filter(w => w.partnerId !== pid))}
        onMinimize={(pid) => setChatWindows(prev => prev.map(w => w.partnerId === pid ? { ...w, minimized: !w.minimized } : w))}
      />
    </div>
  )
}
