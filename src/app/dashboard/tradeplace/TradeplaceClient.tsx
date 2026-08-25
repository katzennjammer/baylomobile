"use client";
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { CompactRepBadge, LeafRankBadge } from "@/components/RepBadge";
import toast from "react-hot-toast";

import dynamic from "next/dynamic";
import "../baylo-dashboard.css";
import "./tradeplace.css";
import type { ListingPin } from "./ListingsMap";
import PostWizard from "./PostWizard";
import TopNav from "../_shell/TopNav";
import type { Message, Notif } from "../_shell/TopNav";
import DashSidebar from "../_shell/DashSidebar";
import ChatDock from "../_shell/ChatDock";
import type { ChatWindow, ConfirmableTrade } from "../_shell/ChatDock";

import { getPusherClient } from "@/lib/pusher-client";
import { factorForCategory, computeGreenScore } from "@/lib/impact-constants";

const ListingsMap      = dynamic(() => import("./ListingsMap"),              { ssr: false });
const PickupMiniMap    = dynamic(() => import("./PickupMiniMap"),            { ssr: false });
const SwapConfirmModal = dynamic(() => import("@/components/SwapConfirmModal"), { ssr: false });
const RateTradeModal   = dynamic(() => import("@/components/RateTradeModal"),   { ssr: false });

const ICONS = {
  home:      "M3 11.5 12 4l9 7.5M5.5 9.8V20h13V9.8",
  user:      "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0",
  friends:   "M16 21v-1.5a4 4 0 0 0-4-4H6.5a4 4 0 0 0-4 4V21M9.25 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5M21.5 21v-1.5a4 4 0 0 0-3-3.87M15.5 4.24a4 4 0 0 1 0 7.52",
  community: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18",
  store:     "M3.5 9 5 4h14l1.5 5M4 9.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5M3.5 9h17M9 20v-5.5h6V20M7.8 9.2a2.3 2.3 0 0 0 4.2 0 2.3 2.3 0 0 0 4 0",
  swap:      "M7 7h12l-3-3M17 17H5l3 3",
  bookmark:  "M6 4h12v17l-6-4-6 4V4Z",
  search:    "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM16 16l5 5",
  grid:      "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  map:       "M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7ZM9 4v13M15 7v13",
  close:     "M18 6 6 18M6 6l12 12",
  plus:      "M12 5v14M5 12h14",
  star:      "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L4.5 9.7l5.9-.9L12 3.5Z",
  pin:       "M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  heart:     "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z",
  check:     "M20 6 9 17l-5-5",
  chevDown:  "M6 9l6 6 6-6",
  chevLeft:  "M15 18l-6-6 6-6",
  chevRight: "M9 18l6-6-6-6",
  bell:      "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
  flame:     "M12 22c3.9 0 7-2.8 7-7 0-3-2-5.3-3.4-6.6-.4 1.4-1.6 2.1-2.6 2 .9-2.5-.2-5.2-2.4-7.4-.2 3.1-2.2 4.6-3.6 6.4C5.6 11 5 12.9 5 15c0 4.2 3.1 7 7 7Z",
  moon:      "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9",
  message:   "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z",
  leaf:      "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10ZM2 21c0-3 1.85-5.4 5.1-6",
  recycle:   "M7 19H4.4a1 1 0 0 1-.8-1.6l2.2-3M17 19h2.6a1 1 0 0 0 .8-1.6l-2.2-3M12 2l2 3.5M12 2l-2 3.5M4.4 13.5L2 9l4-.5M19.6 13.5L22 9l-4-.5M4.4 13.5h15.2M12 22v-4",
  image:     "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5ZM3 14l4-4 4 4 3-3 4 4M9 9h.01",
  tag:       "M3 12V4h8l10 10-8 8L3 12ZM7.5 8.5h.01",
  layers:    "M12 2L2 7l10 5 10-5-10-5ZM2 12l10 5 10-5M2 17l10 5 10-5",
  target:    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
} as const;


const CATEGORIES = [
  { value: "ALL",          label: "All" },
  { value: "ELECTRONICS",  label: "Electronics" },
  { value: "CLOTHING",     label: "Clothing" },
  { value: "BAGS",         label: "Bags" },
  { value: "BEAUTY",       label: "Beauty" },
  { value: "ACCESSORIES",  label: "Accessories" },
  { value: "FURNITURE",    label: "Furniture" },
  { value: "BOOKS",        label: "Books & Media" },
  { value: "GAMING",       label: "Gaming" },
  { value: "SPORTS",       label: "Sports" },
  { value: "BIKES",        label: "Bikes" },
  { value: "TOYS",         label: "Toys & Kids" },
  { value: "TOOLS",        label: "Tools & DIY" },
  { value: "MUSIC",        label: "Music" },
  { value: "ART",          label: "Art & Crafts" },
  { value: "COLLECTIBLES", label: "Collectibles" },
  { value: "PETS",         label: "Pets" },
  { value: "PLANTS",       label: "Plants" },
  { value: "FOOD",         label: "Food" },
  { value: "SERVICES",     label: "Services" },
  { value: "OTHER",        label: "Other" },
];

const CONDITIONS = [
  { value: "",         label: "Any" },
  { value: "NEW",      label: "New" },
  { value: "LIKE_NEW", label: "Like New" },
  { value: "GOOD",     label: "Good" },
  { value: "FAIR",     label: "Fair" },
  { value: "POOR",     label: "Poor" },
];

const CAT_PH_LIGHT: Record<string, string> = {
  ELECTRONICS:  "linear-gradient(140deg, #dde8ff 0%, #b8c8ff 100%)",
  CLOTHING:     "linear-gradient(140deg, #fce8f8 0%, #f5c5f0 100%)",
  BAGS:         "linear-gradient(140deg, #fef2e8 0%, #fdd5a0 100%)",
  BEAUTY:       "linear-gradient(140deg, #ffe8f2 0%, #ffb5d8 100%)",
  ACCESSORIES:  "linear-gradient(140deg, #fdf8e5 0%, #faedb0 100%)",
  FURNITURE:    "linear-gradient(140deg, #fff4e8 0%, #ffd9b5 100%)",
  BOOKS:        "linear-gradient(140deg, #e8e5ff 0%, #c8c0ff 100%)",
  GAMING:       "linear-gradient(140deg, #ede5ff 0%, #cdb5ff 100%)",
  SPORTS:       "linear-gradient(140deg, #e5fff5 0%, #b5ffd8 100%)",
  BIKES:        "linear-gradient(140deg, #e5fffe 0%, #b5f5f0 100%)",
  TOYS:         "linear-gradient(140deg, #f2ffe5 0%, #ceffb5 100%)",
  TOOLS:        "linear-gradient(140deg, #fff2e5 0%, #ffc894 100%)",
  MUSIC:        "linear-gradient(140deg, #e5eeff 0%, #b5c8ff 100%)",
  ART:          "linear-gradient(140deg, #fff8e5 0%, #ffe8a0 100%)",
  COLLECTIBLES: "linear-gradient(140deg, #fff0e5 0%, #ffc8a0 100%)",
  PETS:         "linear-gradient(140deg, #e8ffe5 0%, #b5ffa0 100%)",
  PLANTS:       "linear-gradient(140deg, #e5ffe8 0%, #a8ffb0 100%)",
  FOOD:         "linear-gradient(140deg, #e5fff0 0%, #b5ffcc 100%)",
  SERVICES:     "linear-gradient(140deg, #f3e5ff 0%, #d9b5ff 100%)",
  OTHER:        "linear-gradient(140deg, #f0f0f8 0%, #d8d8ee 100%)",
};

const CAT_BG: Record<string, string> = {
  ELECTRONICS:  "linear-gradient(140deg, #0e253f 0%, #051525 100%)",
  CLOTHING:     "linear-gradient(140deg, #3a0e32 0%, #200618 100%)",
  BAGS:         "linear-gradient(140deg, #3a2010 0%, #1e0e04 100%)",
  BEAUTY:       "linear-gradient(140deg, #3a0e22 0%, #20060e 100%)",
  ACCESSORIES:  "linear-gradient(140deg, #2e2608 0%, #181404 100%)",
  FURNITURE:    "linear-gradient(140deg, #2e1c06 0%, #180e02 100%)",
  BOOKS:        "linear-gradient(140deg, #1c1555 0%, #0e0a2c 100%)",
  GAMING:       "linear-gradient(140deg, #1e0c40 0%, #0e0620 100%)",
  SPORTS:       "linear-gradient(140deg, #0b2e1c 0%, #051810 100%)",
  BIKES:        "linear-gradient(140deg, #062e2c 0%, #021816 100%)",
  TOYS:         "linear-gradient(140deg, #252e00 0%, #121800 100%)",
  TOOLS:        "linear-gradient(140deg, #2e1400 0%, #180a00 100%)",
  MUSIC:        "linear-gradient(140deg, #0e1a3a 0%, #060e20 100%)",
  ART:          "linear-gradient(140deg, #2e2400 0%, #181200 100%)",
  COLLECTIBLES: "linear-gradient(140deg, #2e1800 0%, #180c00 100%)",
  PETS:         "linear-gradient(140deg, #0a2e0a 0%, #041804 100%)",
  PLANTS:       "linear-gradient(140deg, #082e0e 0%, #041806 100%)",
  FOOD:         "linear-gradient(140deg, #003e24 0%, #001e12 100%)",
  SERVICES:     "linear-gradient(140deg, #280442 0%, #14022a 100%)",
  OTHER:        "linear-gradient(140deg, #1c1c28 0%, #0e0e18 100%)",
};


const SORTS = [
  { id: "newest",     label: "Newest first"   },
  { id: "value_high", label: "Highest value"  },
  { id: "value_low",  label: "Lowest value"   },
];

function condLabel(c: string) {
  return CONDITIONS.find((x) => x.value === c)?.label ?? c;
}
function catLabel(c: string) {
  return CATEGORIES.find((x) => x.value === c)?.label ?? c;
}

export interface SerializedItem {
  id: string;
  title: string;
  description: string;
  images: string;
  category: string;
  condition: string;
  valueLeaves: number | null;
  /** Free text only. Pickup is a separate, server-filtered field. */
  wanted: string | null;
  /**
   * Pickup as this viewer is allowed to see it. `precise: false` means the
   * coordinates are the server's ~1 km rounding and `address` is null — the
   * exact point goes only to the owner and accepted trade counterparties.
   */
  pickup: { lat: number; lng: number; address: string | null; precise: boolean } | null;
  imageHash?: string | null;
  userId: string;
  tradeCount: number;
  user: { id: string; name: string; avatar: string | null; rating: number; totalTrades: number; lifetimeLeaves?: number };
}

interface ShelfItem {
  id: string;
  title: string;
  images: string;
  valueLeaves: number | null;
  category: string;
  condition: string;
}

interface Props {
  items: SerializedItem[];
  me: { id: string; name: string; avatar: string | null; leaves: number };
  followReqCount: number;
  notifs: Notif[];
  messages: Message[];
  weeklyTrades: number;
  initialOpen?: string | null;
  initialEdit?: string | null;
  traderOfWeek: { name: string; avatar: string | null; rating: number; tradeCount: number } | null;
  trendingCategory: { value: string; label: string; count: number } | null;
  recentTrades: Array<{ who: string; gave: string; got: string; t: string }>;
}

function parseImages(raw: string): string[] {
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

function cloudinaryDetail(url: string): string {
  return url.replace(/\/upload\//, "/upload/w_1200,q_auto,f_auto/");
}

// Pickup and wanted-text no longer travel inside one JSON blob: the server sends
// them as separate fields, with pickup already filtered for this viewer. These
// stay as named accessors so the call sites below read the same as before.
type ViewerPickup = { lat: number; lng: number; address: string | null; precise: boolean };

function parsePickup(item: { pickup: ViewerPickup | null }): ViewerPickup | null {
  return item.pickup ?? null;
}

function parseWanted(item: { wanted: string | null }): string | null {
  return item.wanted ?? null;
}

function parseDesc(desc: string): string {
  try {
    const parsed = JSON.parse(desc);
    if (Array.isArray(parsed)) return (parsed as string[]).join(" · ");
  } catch { /* plain text */ }
  return desc;
}

function fmtLeaves(valueLeaves: number | null): string | null {
  if (valueLeaves == null) return null;
  return `~${valueLeaves.toLocaleString("en-US")} Leaves`;
}

// ── Vivid gradient palette for no-photo covers ─────────────────────────────
const GRADS: [string, string][] = [
  ["#4CAF50", "#1A3520"], ["#FF6BA3", "#7A1F47"], ["#27E0B3", "#0C5B49"],
  ["#FFB23E", "#7A3E0C"], ["#5CA8FF", "#16356B"], ["#FF7A59", "#6B1F16"],
  ["#B86BFF", "#3A1A6B"], ["#3EE0FF", "#0C4A5B"], ["#FF5C8A", "#6B163A"],
];
function gradOf(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return GRADS[h % GRADS.length];
}
function itemGreen(category: string, tradeCount: number): number {
  // Use at least 1 so new (untraded) items show their category-based potential.
  const n = Math.max(1, Number(tradeCount) || 0);
  const f = factorForCategory(category);
  return computeGreenScore(f.co2Kg * n, f.waterL * n, n, f.wasteKg * n);
}
function lifeName(tradeCount: number): string {
  const n = (Number(tradeCount) || 0) + 1;
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]} life`;
}
function co2Potential(category: string, tradeCount: number): string {
  const n = Math.max(1, Number(tradeCount) || 0);
  return `~${(factorForCategory(category).co2Kg * n).toFixed(1)} kg`;
}
function itemTags(item: SerializedItem): string[] {
  const tags: string[] = [catLabel(item.category), condLabel(item.condition), "Trade"];
  if (parsePickup(item)) tags.push("Pickup");
  return tags.slice(0, 5);
}
function userHandle(name: string): string {
  return "@" + name.toLowerCase().replace(/\s+/g, "").slice(0, 20);
}

function Ico({ d, size = 18, fill, style }: { d: string; size?: number; fill?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ?? "none"}
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden style={style}>
      <path d={d} />
    </svg>
  );
}

function Avatar({ src, name, size }: { src: string | null; name: string; size: number }) {
  if (src) return <img src={src} alt={name} className="tp-av" style={{ width: size, height: size }} />;
  return (
    <div className="tp-av-ph" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {name.charAt(0)}
    </div>
  );
}

// ── Featured hero ─────────────────────────────────────────────────────────
function FeaturedHero({ item, onOffer, isOwner, traderOfWeek, trendingCategory }: {
  item: SerializedItem;
  onOffer: () => void;
  isOwner: boolean;
  traderOfWeek: { name: string; avatar: string | null; rating: number; tradeCount: number } | null;
  trendingCategory: { value: string; label: string; count: number } | null;
}) {
  const imgs   = parseImages(item.images);
  const wanted = parseWanted(item);
  const leavesStr = fmtLeaves(item.valueLeaves);
  const bg     = CAT_BG[item.category] ?? CAT_BG.OTHER;

  return (
    <section className="tp-hero">
      <div className="tp-hero-main">
        <div className="tp-hero-bg" style={imgs[0] ? undefined : { backgroundImage: "url(/tradeoftheday.png)", backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" }}>
          {imgs[0] && <img src={imgs[0]} alt="" />}
        </div>
        <div className="tp-hero-scrim" />
        <div className="tp-hero-inner">
          <span className="tp-hero-kicker">
            <Ico d={ICONS.flame} size={13} fill="currentColor" />
            Trade of the day
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 className="tp-hero-title">{item.title}</h2>
            {item.description && (
              <p className="tp-hero-sub">
                {(d => d.length > 120 ? d.slice(0, 120) + "…" : d)(parseDesc(item.description))}
              </p>
            )}
            <div className="tp-hero-give">
              <div className="tp-gg">
                <span>They&apos;re offering</span>
                <strong>{item.title}</strong>
              </div>
              <span className="tp-hero-swap"><Ico d={ICONS.swap} size={16} /></span>
              <div className="tp-gg want">
                <span>They want</span>
                <strong>{wanted ?? "Open to offers"}</strong>
              </div>
            </div>
          </div>
          <div className="tp-hero-foot">
            <div className="tp-hero-host">
              <Avatar src={item.user?.avatar ?? null} name={item.user?.name ?? "Unknown"} size={38} />
              <div className="tp-hero-host-id">
                <strong>{item.user?.name ?? "Unknown"}</strong>
                <CompactRepBadge
                  rating={item.user?.rating ?? 0}
                  totalTrades={item.user?.totalTrades ?? 0}
                />
              </div>
            </div>
            {leavesStr && (
              <div className="tp-hero-stats">
                <span className="tp-hero-stat">{leavesStr}</span>
              </div>
            )}
            {isOwner ? (
              <span className="tp-owner-pill" style={{ alignSelf: "center" }}>This is your listing</span>
            ) : (
              <button className="btn-accent" onClick={onOffer}>
                <Ico d={ICONS.swap} size={16} />Make an offer
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="tp-hero-side">
        {traderOfWeek ? (
          <div className="tp-spotlight tp-spotlight--trader">
            <div className="tp-spotlight-scrim" />
            <div className="tp-spotlight-deco" aria-hidden>
              <svg viewBox="0 0 24 24" fill="white" stroke="none"><path d={ICONS.star} /></svg>
            </div>
            <span className="tp-spotlight-label">
              <Ico d={ICONS.star} size={11} fill="currentColor" style={{ color: "#ffce6b" }} />
              Trader of the week
            </span>
            <div className="tp-spotlight-name">
              <Avatar src={traderOfWeek.avatar} name={traderOfWeek.name} size={36} />
              <div className="tp-spotlight-trader-id">
                <strong>{traderOfWeek.name}</strong>
                <span>
                  <Ico d={ICONS.swap} size={11} />
                  {traderOfWeek.tradeCount} trade{traderOfWeek.tradeCount !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
            <div className="tp-spotlight-meta">
              {traderOfWeek.rating > 0 && (
                <span>
                  <Ico d={ICONS.star} size={12} fill="currentColor" style={{ color: "#ffce6b" }} />
                  {traderOfWeek.rating.toFixed(1)}
                </span>
              )}
              <span className="tp-spotlight-badge">Top Trader</span>
            </div>
          </div>
        ) : null}
        {trendingCategory ? (
          <div
            className="tp-spotlight tp-spotlight--heating"
            style={{ background: CAT_BG[trendingCategory.value] ?? CAT_BG.OTHER }}
          >
            <div className="tp-spotlight-scrim" />
            <div className="tp-spotlight-deco" aria-hidden>
              <svg viewBox="0 0 24 24" fill="white" stroke="none"><path d={ICONS.flame} /></svg>
            </div>
            <span className="tp-spotlight-label">
              <Ico d={ICONS.flame} size={11} fill="currentColor" /> Heating up
            </span>
            <div className="tp-spotlight-name">
              <strong className="tp-spotlight-cat-name">{trendingCategory.label}</strong>
            </div>
            <div className="tp-spotlight-meta">
              <span><Ico d={ICONS.grid} size={13} />{trendingCategory.count} listing{trendingCategory.count !== 1 ? "s" : ""}</span>
              <span className="tp-spotlight-badge">Trending</span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ── Live ticker ───────────────────────────────────────────────────────────
function LiveTicker({ trades }: { trades: Array<{ who: string; gave: string; got: string; t: string }> }) {
  if (trades.length === 0) return null;
  const minLen = 6;
  const fill = trades.length < minLen
    ? Array.from({ length: Math.ceil(minLen / trades.length) }, () => trades).flat()
    : trades;
  const doubled = [...fill, ...fill];
  return (
    <div className="tp-ticker">
      <span className="tp-ticker-tag">
        <i className="tp-ticker-pulse" />
        Trading now
      </span>
      <div className="tp-ticker-mask">
        <div className="tp-ticker-track">
          {doubled.map((tk, i) => (
            <span className="tp-ticker-item" key={i}>
              <strong>{tk.who}</strong> traded <span>{tk.gave}</span>
              <span className="tp-tk-swap"><Ico d={ICONS.swap} size={13} /></span>
              <strong>{tk.got}</strong>
              <em>· {tk.t}</em>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Build Offer Modal ─────────────────────────────────────────────────────
function BuildOfferModal({
  listing,
  me,
  leafTotal,
  onClose,
  onOpenChat,
}: {
  listing: SerializedItem;
  me: { id: string; name: string; avatar: string | null };
  leafTotal: number;
  onClose: () => void;
  onOpenChat: (name: string, partnerId: string) => void;
}) {
  const [shelfItems, setShelfItems] = useState<ShelfItem[]>([]);
  const [loadingShelf, setLoadingShelf] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedItems, setSelectedItems] = useState<ShelfItem[]>([]);
  const [leaves, setLeaves] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [offerPartnerId, setOfferPartnerId] = useState<string | null>(null);
  const [offerPartnerName, setOfferPartnerName] = useState<string | null>(null);
  const [showLowLeavesAlert, setShowLowLeavesAlert] = useState(false);
  const [alertNeededLeaves, setAlertNeededLeaves] = useState(0);

  useEffect(() => {
    setLoadingShelf(true);
    fetch("/api/items?mine=true")
      .then((r) => r.json())
      .then((data: unknown) => setShelfItems(Array.isArray(data) ? (data as ShelfItem[]) : []))
      .catch(() => setShelfItems([]))
      .finally(() => setLoadingShelf(false));
  }, []);

  const imgs = parseImages(listing.images);
  const [ga, gb] = gradOf(listing.id);
  const green = itemGreen(listing.category, listing.tradeCount);
  const askLeaves = listing.valueLeaves ?? 0;
  const offerItemsLeaves = selectedItems.reduce(
    (s, i) => s + (i.valueLeaves ?? 0),
    0,
  );
  const offerTotal = offerItemsLeaves + leaves;
  const pct = askLeaves > 0 ? Math.min(1, offerTotal / askLeaves) : offerTotal > 0 ? 1 : 0;
  const gap = Math.max(0, askLeaves - offerTotal);
  const statusInfo =
    pct >= 0.95 ? { label: "Balanced", cls: "green" }
    : pct >= 0.7 ? { label: "Fair",     cls: "green" }
    :              { label: "A bit low", cls: "amber" };

  function toggleShelfItem(item: ShelfItem) {
    setSelectedItems((prev) =>
      prev.find((i) => i.id === item.id)
        ? prev.filter((i) => i.id !== item.id)
        : [...prev, item],
    );
  }

  function coverGap() {
    const needed = Math.max(0, askLeaves - offerItemsLeaves);
    if (leafTotal < needed) {
      setAlertNeededLeaves(needed);
      setShowLowLeavesAlert(true);
      return;
    }
    setLeaves(needed);
  }

  async function propose() {
    if (selectedItems.length === 0 && leaves === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: listing.id,
          offeredItems: selectedItems.map((i) => ({
            id: i.id,
            title: i.title,
            imageUrl: parseImages(i.images)[0] ?? null,
          })),
          offeredLeaves: leaves > 0 ? leaves : null,
          message: null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Failed to send offer");
      }
      const data = await res.json() as { offerId: string; messageId: string; partnerId: string; partnerName: string }
      setOfferPartnerId(data.partnerId)
      setOfferPartnerName(data.partnerName)
      setSuccess(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="tp-modal" style={{ zIndex: 1100 }} onClick={onClose}>
        <div className="bom-box" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
          <div className="bom-success">
            <div className="bom-success-icon">
              <Ico d={ICONS.check} size={28} />
            </div>
            <h3>Offer sent!</h3>
            <p>Your trade proposal has been sent to {listing.user?.name ?? "this trader"}.</p>
            {offerPartnerId && offerPartnerName && (
              <button
                onClick={() => { onOpenChat(offerPartnerName, offerPartnerId); onClose(); }}
                style={{ marginTop: 12, fontSize: 13, color: "#059669", textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }}
              >
                View in Messages →
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const leavesExceedTotal = leaves > leafTotal;
  const canPropose = (selectedItems.length > 0 || leaves > 0) && !submitting && !leavesExceedTotal;

  return (
    <div className="tp-modal" style={{ zIndex: 1100 }} onClick={onClose}>
      <div className="bom-box" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="bom-head">
          <div className="bom-head-icon">
            <Ico d={ICONS.layers} size={20} />
          </div>
          <div className="bom-head-title">
            <strong>Build your offer</strong>
            <span>Combine items from your shelf to match {listing.user?.name ?? "this trader"}&apos;s ask</span>
          </div>
          <button className="bom-close-btn" onClick={onClose} aria-label="Close">
            <Ico d={ICONS.close} size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="bom-body">
          {/* Left: YOU'LL RECEIVE */}
          <div>
            <p className="bom-col-label">You&apos;ll receive</p>
            <div className="bom-receive-card">
              <div className="bom-thumb">
                {imgs[0]
                  ? <img src={imgs[0]} alt={listing.title} />
                  : <div className="bom-thumb-ph" style={{ background: `linear-gradient(140deg, ${ga}, ${gb})` }} />
                }
              </div>
              <div className="bom-receive-info">
                <strong>{listing.title}</strong>
                <span className="bom-sub">
                  {listing.user?.name ?? "Unknown"}
                  {askLeaves > 0 ? ` · ~${askLeaves.toLocaleString("en-US")} Leaves value` : ""}
                </span>
                <span className="bom-green-pill">
                  <Ico d={ICONS.leaf} size={10} />
                  {green}
                </span>
              </div>
            </div>
          </div>

          {/* Center: swap badge */}
          <div className="bom-swap-col">
            <div className="bom-swap-badge">
              <Ico d={ICONS.swap} size={15} />
            </div>
          </div>

          {/* Right: YOUR OFFER */}
          <div className="bom-offer-col">
            <p className="bom-col-label">
              Your offer{selectedItems.length > 0
                ? ` · ${selectedItems.length} item${selectedItems.length > 1 ? "s" : ""}`
                : ""}
            </p>

            {/* Already-added items */}
            {selectedItems.length > 0 && (
              <div className="bom-offered-items">
                {selectedItems.map((item) => {
                  const itemImgs = parseImages(item.images);
                  const [ia, ib] = gradOf(item.id);
                  const itemLeaves = item.valueLeaves ?? 0;
                  return (
                    <div key={item.id} className="bom-offered-item">
                      <div className="bom-thumb sm">
                        {itemImgs[0]
                          ? <img src={itemImgs[0]} alt={item.title} />
                          : <div className="bom-thumb-ph" style={{ background: `linear-gradient(140deg, ${ia}, ${ib})` }} />
                        }
                      </div>
                      <strong>{item.title}</strong>
                      {itemLeaves > 0 && <span className="bom-item-pts">{itemLeaves.toLocaleString("en-US")} Leaves</span>}
                      <button
                        className="bom-rm-btn"
                        onClick={() => setSelectedItems((p) => p.filter((i) => i.id !== item.id))}
                        aria-label="Remove"
                      >
                        <Ico d={ICONS.close} size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add from shelf button */}
            <button className="bom-add-btn" onClick={() => setPickerOpen((o) => !o)}>
              <Ico d={ICONS.plus} size={15} />
              Add from my shelf
            </button>

            {/* Inline shelf picker */}
            {pickerOpen && (
              <div className="bom-shelf-picker">
                {loadingShelf ? (
                  <div className="bom-shelf-msg">Loading your shelf…</div>
                ) : shelfItems.length === 0 ? (
                  <div className="bom-shelf-msg">No items on your shelf yet</div>
                ) : (
                  shelfItems.map((item) => {
                    const itemImgs = parseImages(item.images);
                    const [ia, ib] = gradOf(item.id);
                    const isSelected = !!selectedItems.find((i) => i.id === item.id);
                    const itemLeaves = item.valueLeaves ?? 0;
                    return (
                      <button
                        key={item.id}
                        className={`bom-shelf-item${isSelected ? " on" : ""}`}
                        onClick={() => toggleShelfItem(item)}
                      >
                        <div className="bom-shelf-thumb">
                          {itemImgs[0]
                            ? <img src={itemImgs[0]} alt={item.title} />
                            : <div style={{ width: "100%", height: "100%", background: `linear-gradient(140deg, ${ia}, ${ib})`, borderRadius: 6 }} />
                          }
                        </div>
                        <div className="bom-shelf-info">
                          <strong>{item.title}</strong>
                          {itemLeaves > 0 && <span>~{itemLeaves.toLocaleString("en-US")} Leaves</span>}
                        </div>
                        <div className={`bom-shelf-check${isSelected ? " on" : ""}`}>
                          {isSelected && <Ico d={ICONS.check} size={11} />}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}

            {/* Pasa Leaves panel */}
            <div className="bom-pts-panel">
              <div className="bom-pts-head">
                <div className="bom-pts-head-left">
                  <span className="bom-pts-dot" />
                  Add Pasa Leaves
                </div>
                <span className="bom-pts-total">You have {leafTotal.toLocaleString("en-US")} Leaves</span>
              </div>
              <div className="bom-pts-stepper">
                <button className="bom-pts-step" onClick={() => setLeaves((p) => Math.max(0, p - 50))}>−</button>
                <div className="bom-pts-wrap">
                  <input
                    type="number"
                    min={0}
                    max={leafTotal}
                    value={leaves || ""}
                    placeholder="0"
                    className="bom-pts-input"
                    onChange={(e) => setLeaves(Math.min(leafTotal, Math.max(0, parseInt(e.target.value) || 0)))}
                  />
                  <span className="bom-pts-suffix">Leaves</span>
                </div>
                <button className="bom-pts-step" onClick={() => setLeaves((p) => Math.min(leafTotal, p + 50))}>+</button>
                {gap > 0 && (
                  <button className="bom-cover-btn" onClick={coverGap}>
                    Cover {gap.toLocaleString("en-US")} Leaves
                  </button>
                )}
              </div>
              {leavesExceedTotal && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#dc2626", display: "flex", alignItems: "center", gap: 6 }}>
                  <span>You only have {leafTotal.toLocaleString("en-US")} Leaves available.</span>
                  <button type="button"
                    style={{ color: "#059669", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: 0 }}
                    onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("baylo:openLeaves")); }}>
                    View my Leaves →
                  </button>
                </div>
              )}
              {leafTotal === 0 && !leavesExceedTotal && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#888" }}>
                  No Leaves yet.{" "}
                  <button type="button"
                    style={{ color: "#059669", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: 0 }}
                    onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("baylo:openLeaves")); }}>
                    Earn Leaves by trading →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bom-foot">
          <div className="bom-balance-sec">
            <div className="bom-balance-label">
              <Ico d={ICONS.target} size={13} style={{ flexShrink: 0 }} />
              Trade balance
            </div>
            <div className="bom-progress-bar">
              <div className="bom-progress-fill" style={{ width: `${Math.round(pct * 100)}%` }} />
            </div>
          </div>
          <div className="bom-status-sec">
            <div className={`bom-status-label ${statusInfo.cls}`}>{statusInfo.label}</div>
            <div className="bom-status-vs">your offer vs ~{askLeaves.toLocaleString("en-US")} Leaves</div>
            <div className="bom-status-pts">{offerTotal.toLocaleString("en-US")} Leaves</div>
          </div>
          <button className="bom-propose-btn" onClick={propose} disabled={!canPropose}>
            <Ico d={ICONS.swap} size={15} />
            Propose trade
          </button>
        </div>
      </div>
      {showLowLeavesAlert && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowLowLeavesAlert(false)}
        >
          <div
            style={{ background: "#fffef9", border: "1.5px solid #a7f3d0", borderRadius: 16, padding: "28px 28px 24px", maxWidth: 340, width: "90%", boxShadow: "0 8px 32px rgba(0,0,0,0.14)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: 16, color: "#064e3b", marginBottom: 10 }}>Not enough Pasa Leaves</div>
            <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.6, marginBottom: 22 }}>
              You need {alertNeededLeaves.toLocaleString("en-US")} Leaves but only have {leafTotal.toLocaleString("en-US")} Leaves. Earn more by completing trades.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                style={{ padding: "8px 16px", borderRadius: 8, border: "1.5px solid #d1fae5", background: "transparent", color: "#374151", cursor: "pointer", fontSize: 14 }}
                onClick={() => setShowLowLeavesAlert(false)}
              >
                Cancel
              </button>
              <button
                style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#059669", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 600 }}
                onClick={() => { setShowLowLeavesAlert(false); onClose(); window.dispatchEvent(new CustomEvent("baylo:openLeaves")); }}
              >
                View my Leaves
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────
export default function TradeplaceClient({ items: initialItems, me, followReqCount, notifs, messages, weeklyTrades, initialOpen, initialEdit, traderOfWeek, trendingCategory, recentTrades }: Props) {
  const [items, setItems]           = useState(initialItems);
  const [q, setQ]                   = useState("");
  const [cat, setCat]               = useState("ALL");
  const [cond, setCond]             = useState("");
  const [dist, setDist]             = useState(50);
  const [view, setView]             = useState<"grid" | "map">("grid");
  const [selectedId, setSelectedId] = useState<string | null>(initialOpen ?? null);
  const [showWizard, setShowWizard] = useState(false);
  const [sortBy, setSortBy]         = useState("newest");
  const [sortOpen, setSortOpen]     = useState(false);
  const [savedIds, setSavedIds]     = useState<Set<string>>(new Set());
  const [openOnly, setOpenOnly]     = useState(false);
  const [liveMsgs, setLiveMsgs]     = useState<Message[]>(messages);
  const [liveNotifs, setLiveNotifs] = useState<Notif[]>(notifs);
  const [chatWindows, setChatWindows] = useState<ChatWindow[]>([]);
  const [extraConfirmable, setExtraConfirmable] = useState<Record<string, ConfirmableTrade>>({});
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmableTrade | null>(null);
  const openConfirmFromChat = useCallback((trade: ConfirmableTrade) => setPendingConfirm(trade), []);
  const [completedByPartnerId, setCompletedByPartnerId] = useState<Record<string, { tradeId: string; partnerName: string }>>({});
  const [ratingTrade, setRatingTrade] = useState<{ tradeId: string; partnerName: string } | null>(null);
  const router = useRouter();
  const [editItem, setEditItem]     = useState<SerializedItem | null>(null);
  const [offerTarget, setOfferTarget] = useState<SerializedItem | null>(null);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => { setGalleryIdx(0); }, [selectedId]);

  // ── Open edit wizard from ?edit=<id> query param ───────────────────────
  useEffect(() => {
    if (!initialEdit) return;
    fetch(`/api/items/${initialEdit}`)
      .then(r => { if (!r.ok) throw new Error(r.status === 403 ? "forbidden" : "not_found"); return r.json() as Promise<SerializedItem>; })
      .then(item => {
        if (item.userId !== me.id) {
          toast.error("You can only edit your own listings.");
          return;
        }
        setEditItem(item);
        setShowWizard(true);
      })
      .catch((e: Error) => {
        if (e.message === "forbidden") toast.error("You don't have permission to edit this listing.");
        else toast.error("Listing not found.");
      });
  // Only run once on mount — initialEdit is stable from server props
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pusher real-time subscription ──────────────────────────────────────
  useEffect(() => {
    const pusherClient = getPusherClient();
    if (!pusherClient || !me.id) return;
    const channel = pusherClient.subscribe(`private-user-${me.id}`);
    channel.bind("new-message", (data: { content: string; senderId: string; senderName: string; id: string; createdAt: string }) => {
      window.dispatchEvent(new CustomEvent("baylo:msg", { detail: data }));
      setLiveMsgs((prev) => {
        const preview = (() => {
          try {
            const p = JSON.parse(data.content);
            if (p.type === "offer") return "Sent a trade offer";
            if (p.type === "offer_update") return "Updated offer status";
            if (p.type === "shared_post") return `Shared: ${p.postItem}`;
            if (p.type === "image") return "Sent an image";
            if (p.type === "voice") return "Sent a voice message";
          } catch { /* plain text */ }
          return data.content.slice(0, 60);
        })();
        const idx = prev.findIndex((m) => m.partnerId === data.senderId);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], preview, time: "just now", unread: true };
          return updated;
        }
        return [{ name: data.senderName, preview, time: "just now", unread: true, partnerId: data.senderId }, ...prev];
      });
    });
    channel.bind("offer-updated", (data: unknown) => {
      window.dispatchEvent(new CustomEvent("baylo:offer-updated", { detail: data }));
    });
    channel.bind("typing", (data: unknown) => {
      window.dispatchEvent(new CustomEvent("baylo:typing", { detail: data }));
    });
    let everConnected = false;
    pusherClient.connection.bind("state_change", ({ current }: { current: string }) => {
      if (current === "connected") {
        if (everConnected) window.dispatchEvent(new CustomEvent("baylo:reconnected"));
        everConnected = true;
      }
    });
    return () => { try { pusherClient.unsubscribe(`private-user-${me.id}`); } catch { /* ignore */ } };
  }, [me.id]);

  // Listen for trade-accepted events (fired by OfferCard and ChatDock) and open the modal.
  useEffect(() => {
    const onTradeAccepted = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        tradeId: string; offeredItemTitle: string; requestedItemTitle: string;
        senderId: string; senderName: string; receiverId: string; receiverName: string;
      };
      const iAmSender = d.senderId === me.id;
      const partnerId = iAmSender ? d.receiverId : d.senderId;
      if (d.tradeId && partnerId) {
        setExtraConfirmable((prev) => ({
          ...prev,
          [partnerId]: {
            id: d.tradeId,
            offeredItemTitle: d.offeredItemTitle,
            requestedItemTitle: d.requestedItemTitle,
            sender:   { id: d.senderId,   name: d.senderName   },
            receiver: { id: d.receiverId, name: d.receiverName },
          },
        }));
      }
    };
    window.addEventListener("baylo:trade-accepted", onTradeAccepted);
    return () => window.removeEventListener("baylo:trade-accepted", onTradeAccepted);
  }, [me.id]);

  const openChat = useCallback((name: string, partnerId: string) => {
    setChatWindows((prev) => {
      const exists = prev.find((w) => w.partnerId === partnerId);
      if (exists) return prev.map((w) => w.partnerId === partnerId ? { ...w, minimized: false } : w);
      return [...prev, { name, partnerId, minimized: false }];
    });
  }, []);
  const closeChat = useCallback((partnerId: string) => {
    setChatWindows((prev) => prev.filter((w) => w.partnerId !== partnerId));
  }, []);
  const minimizeChat = useCallback((partnerId: string) => {
    setChatWindows((prev) => prev.map((w) => w.partnerId === partnerId ? { ...w, minimized: !w.minimized } : w));
  }, []);

  const meNav = {
    name: me.name,
    handle: me.name.toLowerCase().replace(/\s+/g, "").slice(0, 20),
    avatar: me.avatar,
    greenScore: 0,
  };

  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) counts[item.category] = (counts[item.category] ?? 0) + 1;
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    const qLow = q.toLowerCase();
    return items.filter((item) => {
      if (cat !== "ALL" && item.category !== cat) return false;
      if (cond && item.condition !== cond) return false;
      if (q && !item.title.toLowerCase().includes(qLow) && !item.description.toLowerCase().includes(qLow)) return false;
      return true;
    });
  }, [items, cat, cond, q]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === "value_high") arr.sort((a, b) => (b.valueLeaves ?? 0) - (a.valueLeaves ?? 0));
    if (sortBy === "value_low")  arr.sort((a, b) => (a.valueLeaves ?? 0) - (b.valueLeaves ?? 0));
    return arr;
  }, [filtered, sortBy]);

  const mapPins = useMemo<ListingPin[]>(() =>
    filtered.flatMap((item) => {
      if (!item.user) return [];
      const pickup = parsePickup(item);
      if (!pickup) return [];
      const imgs = parseImages(item.images);
      const wanted = parseWanted(item);
      return [{
        id: item.id, title: item.title, imageUrl: imgs[0] ?? null,
        valueLeaves: item.valueLeaves, lat: pickup.lat, lng: pickup.lng,
        userName: item.user.name, ownerId: item.userId, condition: item.condition,
        wantedLabel: wanted ?? null, userRating: item.user.rating,
        category: item.category,
        greenScore: itemGreen(item.category, item.tradeCount),
      }];
    }),
  [filtered]);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  function handlePosted(newItem: SerializedItem) {
    const itemWithUser: SerializedItem = {
      ...newItem,
      tradeCount: newItem.tradeCount ?? 0,
      user: newItem.user ?? { id: me.id, name: me.name, avatar: me.avatar, rating: 0, totalTrades: 0 },
    };
    setItems((prev) => {
      const existing = prev.findIndex((i) => i.id === itemWithUser.id);
      if (existing !== -1) {
        const next = [...prev];
        next[existing] = itemWithUser;
        return next;
      }
      return [itemWithUser, ...prev];
    });
    setShowWizard(false);
    setEditItem(null);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this listing? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setItems((prev) => prev.filter((i) => i.id !== id));
      setSelectedId(null);
    } catch {
      alert("Failed to delete listing. Please try again.");
    }
  }

  function toggleSave(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSavedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const heroItem    = items[0] ?? null;
  const currentSort = SORTS.find((s) => s.id === sortBy) ?? SORTS[0];

  return (
    <div
      className="tp-standalone baylo"
      data-theme="light"
      style={{
        "--accent": "#4CAF50", "--accent-ink": "#1A3520",
        "--r-lg": "16px", "--r-md": "12px", "--r-sm": "8px",
      } as React.CSSProperties}
    >
      <TopNav
        me={meNav}
        dark={false}
        onToggleTheme={() => {}}
        onOpenChat={openChat}
        followReqCount={followReqCount}
        unreadMsgsCount={liveMsgs.filter((m) => m.unread).length}
        unreadNotifsCount={liveNotifs.filter((n) => n.unread).length}
        notifs={liveNotifs}
        messages={liveMsgs}
      />
      <div className="tp-shell">
        <DashSidebar
          me={{ name: me.name, handle: meNav.handle, avatar: me.avatar }}
          showPostCta={true}
          onPost={() => setShowWizard(true)}
          weeklyTrades={weeklyTrades}
          weeklyGoal={3}
        />

        {/* ── Content ── */}
        <div className="content">
          <div className="tp-main">

            {/* Hero */}
            {heroItem && (
              <FeaturedHero item={heroItem} onOffer={() => setOfferTarget(heroItem)} isOwner={heroItem.userId === me.id} traderOfWeek={traderOfWeek} trendingCategory={trendingCategory} />
            )}

            {/* Live ticker */}
            <LiveTicker trades={recentTrades} />

            {/* Toolbar */}
            <div className="tp-toolbar">
              <span className="tp-toolbar-count">
                {sorted.length} trades <em>near you</em>
              </span>
              <div className="tp-toolbar-left">
                <div className="tp-searchbar">
                  <Ico d={ICONS.search} size={14} />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search items…"
                    aria-label="Search"
                  />
                  {q && (
                    <button onClick={() => setQ("")} aria-label="Clear">
                      <Ico d={ICONS.close} size={13} />
                    </button>
                  )}
                </div>
              </div>
              <div className="tp-toolbar-right">
                <div className="tp-sort">
                  <button className="tp-sort-btn" onClick={() => setSortOpen((v) => !v)}>
                    Sort: <span className="tp-sort-val">{currentSort.label}</span>
                    <Ico d={ICONS.chevDown} size={14} />
                  </button>
                  {sortOpen && (
                    <div className="tp-sort-menu">
                      {SORTS.map((s) => (
                        <button
                          key={s.id}
                          className={`tp-sort-opt${s.id === sortBy ? " on" : ""}`}
                          onClick={() => { setSortBy(s.id); setSortOpen(false); }}
                        >
                          {s.label}
                          <span className="tp-sort-check"><Ico d={ICONS.check} size={14} /></span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="tp-segmented" role="tablist">
                  <button
                    className={`tp-seg-btn${view === "grid" ? " on" : ""}`}
                    onClick={() => setView("grid")}
                    aria-label="Grid view"
                  >
                    <Ico d={ICONS.grid} size={17} />
                  </button>
                  <button
                    className={`tp-seg-btn${view === "map" ? " on" : ""}`}
                    onClick={() => setView("map")}
                    aria-label="Map view"
                  >
                    <Ico d={ICONS.map} size={17} />
                  </button>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="tp-body">
              {/* Filter rail */}
              <aside className="tp-filters">
                {/* Category */}
                <div className="tp-filter-card">
                  <div className="tp-filter-block">
                    <div className="tp-filter-h">
                      <span>Category</span>
                      {cat !== "ALL" && (
                        <button className="link-btn" onClick={() => setCat("ALL")}>Reset</button>
                      )}
                    </div>
                    {CATEGORIES.filter((c) => c.value !== "ALL").map(({ value, label }) => (
                      <label key={value} className="tp-check">
                        <input
                          type="checkbox"
                          checked={cat === value}
                          onChange={() => setCat(cat === value ? "ALL" : value)}
                        />
                        <span className="tp-check-box"><Ico d={ICONS.check} size={13} /></span>
                        {label}
                        <span className="tp-check-n">{catCounts[value] ?? 0}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Condition + distance + toggle */}
                <div className="tp-filter-card">
                  <div className="tp-filter-block">
                    <div className="tp-filter-h"><span>Condition</span></div>
                    <div className="tp-pillset">
                      {CONDITIONS.filter((c) => c.value !== "").map(({ value, label }) => (
                        <button
                          key={value}
                          className={`tp-pill${cond === value ? " on" : ""}`}
                          onClick={() => setCond(cond === value ? "" : value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="tp-filter-block">
                    <div className="tp-range">
                      <div className="tp-range-val">
                        <span>Within distance</span>
                        <span>{dist} km</span>
                      </div>
                      <input
                        type="range" min={1} max={100} value={dist}
                        onChange={(e) => setDist(Number(e.target.value))}
                      />
                    </div>
                    <p style={{ fontSize: 11, color: "var(--muted)", margin: 0 }}>
                      Approximate — exact distance coming soon
                    </p>
                  </div>

                  <div className="tp-filter-block">
                    <div className="tp-switch-row" onClick={() => setOpenOnly((v) => !v)}>
                      <div className="tp-switch-tx">
                        <strong>Open to offers</strong>
                        <span>Any item, flexible trade</span>
                      </div>
                      <span className={`tp-switch${openOnly ? " on" : ""}`} />
                    </div>
                  </div>
                </div>

                {/* Saved searches */}
                <div className="tp-filter-card">
                  <div className="tp-filter-block">
                    <div className="tp-filter-h">
                      <span>
                        <Ico d={ICONS.bell} size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                        Saved searches
                      </span>
                    </div>
                    <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5, margin: 0 }}>
                      Save your current filters for quick access.
                    </p>
                    <button className="btn-soft sm" style={{ width: "100%" }} disabled>
                      Save this search
                    </button>
                  </div>
                </div>
              </aside>

              {/* Results */}
              <div className="tp-results">
                {view === "grid" ? (
                  <div className="tp-grid">
                    {sorted.length === 0 ? (
                      <div className="tp-empty">
                        <Ico d={ICONS.store} size={40} />
                        <strong>No items found</strong>
                        <p>Try adjusting your filters or be the first to post a trade!</p>
                        <button className="btn-accent sm" onClick={() => setShowWizard(true)}>
                          <Ico d={ICONS.plus} size={14} />Post a trade
                        </button>
                      </div>
                    ) : (
                      sorted.map((item) => {
                        const imgs   = parseImages(item.images);
                        const leavesStr = fmtLeaves(item.valueLeaves);
                        const wanted = parseWanted(item);
                        const saved  = savedIds.has(item.id);
                        const green  = itemGreen(item.category, item.tradeCount);
                        const life   = lifeName(item.tradeCount);
                        const [ga, gb] = gradOf(item.id);
                        const isCardOwner = item.userId === me.id;
                        return (
                          <article
                            key={item.id}
                            className="tp-card"
                            onClick={() => setSelectedId(item.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === "Enter") setSelectedId(item.id); }}
                          >
                            {/* ── Cover ── */}
                            <div className="tp-card-media">
                              {imgs[0]
                                ? <img src={imgs[0]} alt={item.title} />
                                : (
                                  <div
                                    className="tp-card-media-ph"
                                    style={{ background: `linear-gradient(140deg, ${ga}, ${gb})` }}
                                  >
                                    <Ico d={ICONS.image} size={28} style={{ color: "rgba(255,255,255,0.5)" }} />
                                    <span className="tp-card-ph-text">
                                      Add a photo<br />
                                      <span>or browse files</span>
                                    </span>
                                  </div>
                                )
                              }
                              {/* "Open to offers" pill — top-left */}
                              <span className="tp-open-pill">Open to offers</span>
                              {/* Heart/save — top-right */}
                              <button
                                className={`tp-save${saved ? " on" : ""}`}
                                onClick={(e) => toggleSave(item.id, e)}
                                aria-label={saved ? "Unsave" : "Save"}
                              >
                                <Ico d={ICONS.heart} size={16} fill={saved ? "currentColor" : "none"} />
                              </button>
                              {/* Bottom pills */}
                              {leavesStr && (
                                <div className="tp-media-foot">
                                  <span className="tp-val-pill">{leavesStr}</span>
                                </div>
                              )}
                            </div>

                            {/* ── Body ── */}
                            <div className="tp-card-body">
                              <h3 className="tp-card-title">{item.title}</h3>
                              <div className="tp-card-want">
                                <span className="tp-want-ic"><Ico d={ICONS.swap} size={13} /></span>
                                <span>{wanted ? `Wants: ${wanted}` : "Open to offers"}</span>
                              </div>
                              {/* Meta row */}
                              <div className="tp-card-meta">
                                <span><Ico d={ICONS.pin} size={12} />2 mi</span>
                                <span className="eco"><Ico d={ICONS.leaf} size={12} />Green {green}</span>
                                <span><Ico d={ICONS.recycle} size={12} />{life}</span>
                              </div>
                              <div className="tp-card-foot">
                                <div className="tp-trader">
                                  <Avatar src={item.user?.avatar ?? null} name={item.user?.name ?? "Unknown"} size={26} />
                                  <div className="tp-trader-id">
                                    <strong>{(item.user?.name ?? "Unknown").split(" ")[0]}</strong>
                                    <CompactRepBadge
                                      rating={item.user?.rating ?? 0}
                                      totalTrades={item.user?.totalTrades ?? 0}
                                    />
                                  </div>
                                </div>
                                {isCardOwner ? (
                                  <span className="tp-owner-pill" style={{ fontSize: 11 }}>Your listing</span>
                                ) : (
                                  <button
                                    className="btn-accent sm"
                                    onClick={(e) => { e.stopPropagation(); setSelectedId(item.id); }}
                                    aria-label={`Offer on ${item.title}`}
                                  >
                                    Offer
                                  </button>
                                )}
                              </div>
                            </div>
                          </article>
                        );
                      })
                    )}
                  </div>
                ) : (
                  <div className="tp-map-outer">
                    <ListingsMap listings={mapPins} onSelect={setSelectedId} currentUserId={me.id} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Detail modal ── */}
      {selected && (() => {
        const isOwner = me.id === selected.userId;
        const imgs    = parseImages(selected.images);
        const pickup  = parsePickup(selected);
        const leavesStr  = fmtLeaves(selected.valueLeaves);
        const green   = itemGreen(selected.category, selected.tradeCount);
        const life    = lifeName(selected.tradeCount);
        const co2     = co2Potential(selected.category, selected.tradeCount);
        const tags    = itemTags(selected);
        const handle  = userHandle(selected.user?.name ?? "Unknown");
        const [ga, gb] = gradOf(selected.id);
        return (
          <div className="tp-modal" onClick={() => setSelectedId(null)}>
            <div className="tp-detail" onClick={(e) => e.stopPropagation()}>

              {/* LEFT: gallery carousel */}
              <div className="tp-detail-gallery">
                <div
                  className="tp-detail-photo"
                  onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
                  onTouchEnd={(e) => {
                    if (touchStartX.current === null) return;
                    const delta = e.changedTouches[0].clientX - touchStartX.current;
                    touchStartX.current = null;
                    if (Math.abs(delta) < 40) return;
                    if (delta < 0 && galleryIdx < imgs.length - 1) setGalleryIdx(galleryIdx + 1);
                    if (delta > 0 && galleryIdx > 0) setGalleryIdx(galleryIdx - 1);
                  }}
                >
                  {imgs.length > 0
                    ? <img src={cloudinaryDetail(imgs[galleryIdx])} alt={selected.title} style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: "inherit" }} />
                    : (
                      <div
                        className="tp-detail-photo-ph"
                        style={{ background: `linear-gradient(140deg, ${ga}, ${gb})` }}
                      >
                        <Ico d={ICONS.image} size={52} style={{ color: "rgba(255,255,255,0.5)" }} />
                      </div>
                    )
                  }
                  {/* Arrow buttons */}
                  {imgs.length > 1 && galleryIdx > 0 && (
                    <button
                      className="tp-gallery-arrow tp-gallery-arrow-left"
                      onClick={(e) => { e.stopPropagation(); setGalleryIdx(galleryIdx - 1); }}
                      aria-label="Previous photo"
                    >
                      <Ico d={ICONS.chevLeft} size={20} />
                    </button>
                  )}
                  {imgs.length > 1 && galleryIdx < imgs.length - 1 && (
                    <button
                      className="tp-gallery-arrow tp-gallery-arrow-right"
                      onClick={(e) => { e.stopPropagation(); setGalleryIdx(galleryIdx + 1); }}
                      aria-label="Next photo"
                    >
                      <Ico d={ICONS.chevRight} size={20} />
                    </button>
                  )}
                  {/* Photo count */}
                  {imgs.length > 1 && (
                    <span className="tp-gallery-count">{galleryIdx + 1} / {imgs.length}</span>
                  )}
                  {/* "Open to offers" pill overlay */}
                  <span className="tp-gallery-open-pill">Open to offers</span>
                </div>
                {/* Thumbnail strip */}
                {imgs.length > 1 && (
                  <div className="tp-detail-thumbs">
                    {imgs.map((url, i) => (
                      <button
                        key={i}
                        className={"tp-detail-thumb" + (i === galleryIdx ? " active" : "")}
                        onClick={() => setGalleryIdx(i)}
                        aria-label={`Photo ${i + 1}`}
                      >
                        <img src={url} alt="" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* RIGHT: body */}
              <div className="tp-detail-body">
                {/* Category row + close X */}
                <div className="tp-detail-topbar">
                  <span className="tp-detail-cat">{catLabel(selected.category).toUpperCase()}</span>
                  <button className="tp-detail-x" onClick={() => setSelectedId(null)} aria-label="Close">
                    <Ico d={ICONS.close} size={20} />
                  </button>
                </div>

                {/* Owner pill */}
                {isOwner && (
                  <span className="tp-owner-pill">This is your listing</span>
                )}

                {/* Title */}
                <h2 className="tp-detail-name">{selected.title}</h2>

                {/* Meta row */}
                <div className="tp-detail-metarow">
                  <span><Ico d={ICONS.recycle} size={13} />{life}</span>
                  <span className="eco"><Ico d={ICONS.leaf} size={13} />Green {green}</span>
                  <span className="eco"><Ico d={ICONS.leaf} size={13} />{co2} CO₂ if traded</span>
                </div>

                {/* Value block */}
                {leavesStr && (
                  <div className="tp-detail-valuebar">
                    <div className="tp-detail-value">
                      <span className="tp-detail-value-label">Estimated value</span>
                      <strong>{leavesStr}</strong>
                    </div>
                  </div>
                )}

                {/* They're offering / They want */}
                <div className="tp-detail-give">
                  <div className="tp-detail-gg">
                    <span>THEY&apos;RE OFFERING</span>
                    <strong>{selected.title}</strong>
                    <em>{condLabel(selected.condition)}</em>
                  </div>
                  <span className="tp-detail-swap">
                    <Ico d={ICONS.swap} size={16} />
                  </span>
                  <div className="tp-detail-gg want">
                    <span>THEY WANT</span>
                    <strong>{parseWanted(selected) ?? "Open to offers"}</strong>
                  </div>
                </div>

                {/* Tags */}
                <div className="tp-tags-row">
                  {tags.map((tag) => (
                    <span key={tag} className="tp-tag">
                      <Ico d={ICONS.tag} size={11} />{tag}
                    </span>
                  ))}
                </div>

                {/* Description */}
                {selected.description && (
                  <p className="tp-detail-desc">{parseDesc(selected.description)}</p>
                )}

                {/* Trader row */}
                <div className="tp-detail-trader">
                  <Avatar src={selected.user?.avatar ?? null} name={selected.user?.name ?? "Unknown"} size={44} />
                  <div className="tp-detail-trader-id">
                    <strong>{selected.user?.name ?? "Unknown"}</strong>
                    <span className="tp-detail-handle">{handle}</span>
                    <CompactRepBadge
                      rating={selected.user?.rating ?? 0}
                      totalTrades={selected.user?.totalTrades ?? 0}
                      size="md"
                    />
                    <LeafRankBadge lifetimeLeaves={selected.user?.lifetimeLeaves ?? 0} size="sm" />
                  </div>
                  {!isOwner && (
                    <button
                      className="btn-soft sm"
                      style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6 }}
                      onClick={() => openChat(selected.user?.name ?? "Unknown", selected.userId)}
                    >
                      <Ico d={ICONS.message} size={14} />
                      Message
                    </button>
                  )}
                </div>

                {/* Pickup address + mini-map */}
                {pickup && (
                  <div>
                    {/* The address is present only when the server decided this
                        viewer may have it — owner, or accepted into a trade.
                        Otherwise the map shows the ~1 km approximate area. */}
                    <p className="tp-pickup-addr">
                      <Ico d={ICONS.pin} size={12} style={{ flexShrink: 0 }} />
                      {pickup.precise && pickup.address
                        ? pickup.address
                        : "Approximate area — exact pickup point is shared once a trade is accepted"}
                    </p>
                    <div className="tp-detail-minimap">
                      <PickupMiniMap key={`${pickup.lat},${pickup.lng}`} lat={pickup.lat} lng={pickup.lng} />
                    </div>
                  </div>
                )}

                {/* Bottom bar */}
                <div className="tp-detail-foot">
                  {isOwner ? (
                    <>
                      <button
                        className="btn-soft"
                        style={{ flex: 1, justifyContent: "center" }}
                        onClick={() => {
                          setSelectedId(null);
                          setEditItem(selected);
                          setShowWizard(true);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="tp-btn-danger"
                        onClick={() => handleDelete(selected.id)}
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className={`tp-save lg${savedIds.has(selected.id) ? " on" : ""}`}
                        onClick={(e) => toggleSave(selected.id, e)}
                        aria-label="Save"
                      >
                        <Ico d={ICONS.heart} size={18} fill={savedIds.has(selected.id) ? "currentColor" : "none"} />
                      </button>
                      <button
                        className="btn-accent"
                        style={{ flex: 1, justifyContent: "center" }}
                        onClick={() => { setSelectedId(null); setOfferTarget(selected); }}
                      >
                        Make an offer
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Post wizard ── */}
      {showWizard && (
        <PostWizard
          onClose={() => { setShowWizard(false); setEditItem(null); }}
          onPosted={handlePosted}
          initialItem={editItem ?? undefined}
          me={me}
        />
      )}

      {/* ── Build offer modal ── */}
      {offerTarget && (
        <BuildOfferModal
          listing={offerTarget}
          me={me}
          leafTotal={me.leaves}
          onClose={() => setOfferTarget(null)}
          onOpenChat={openChat}
        />
      )}

      {pendingConfirm && (
        <SwapConfirmModal
          tradeId={pendingConfirm.id}
          offeredItemTitle={pendingConfirm.offeredItemTitle}
          requestedItemTitle={pendingConfirm.requestedItemTitle}
          sender={pendingConfirm.sender}
          receiver={pendingConfirm.receiver}
          myId={me.id}
          onClose={() => setPendingConfirm(null)}
          onCompleted={() => {
            const partner = pendingConfirm.sender.id === me.id ? pendingConfirm.receiver : pendingConfirm.sender;
            setCompletedByPartnerId(prev => ({ ...prev, [partner.id]: { tradeId: pendingConfirm.id, partnerName: partner.name } }));
            setPendingConfirm(null);
            setRatingTrade({ tradeId: pendingConfirm.id, partnerName: partner.name });
            router.refresh();
          }}
        />
      )}

      {/* ── Rate trade modal ── */}
      {ratingTrade && (
        <RateTradeModal
          tradeId={ratingTrade.tradeId}
          partnerName={ratingTrade.partnerName}
          onRated={(tradeId) => {
            setCompletedByPartnerId(prev => {
              const next = { ...prev };
              for (const k of Object.keys(next)) { if (next[k].tradeId === tradeId) delete next[k]; }
              return next;
            });
            setRatingTrade(null);
            router.refresh();
          }}
          onClose={() => { setRatingTrade(null); router.refresh(); }}
        />
      )}

      {/* ── Floating chat windows ── */}
      <ChatDock
        windows={chatWindows}
        myId={me.id}
        onClose={closeChat}
        onMinimize={minimizeChat}
        confirmableByPartnerId={extraConfirmable}
        onConfirmSwap={openConfirmFromChat}
        completedByPartnerId={completedByPartnerId}
        onRateSwap={(tradeId, partnerName) => setRatingTrade({ tradeId, partnerName })}
      />
    </div>
  );
}
