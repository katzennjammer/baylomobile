"use client";
// baylo-dashboard.tsx — full Baylo dashboard (single-file client component)
// All data flows in via BayloDashboard props from the server page.tsx.
// No hardcoded user data — new accounts start at zero everywhere.

import React from "react";
import { useRouter, usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import dynamic from "next/dynamic";
import "./baylo-dashboard.css";
import { getPusherClient, subscribeChannel, unsubscribeChannel } from "@/lib/pusher-client";

import type { PickupLocation } from "./PickupMap";

/**
 * Pickup as the server decided this viewer may see it. Distinct from
 * PickupMap's PickupLocation, which is the editor's own always-exact shape:
 * `address` is null and the coordinates are rounded to ~1 km for anyone who is
 * not the owner or an accepted trade counterparty.
 */
export type ViewerPickup = { lat: number; lng: number; address: string | null; precise: boolean };
const PickupMap = dynamic(() => import("./PickupMap"), { ssr: false });
const SwapConfirmModal = dynamic(() => import("@/components/SwapConfirmModal"), { ssr: false });
const RateTradeModal   = dynamic(() => import("@/components/RateTradeModal"),   { ssr: false });

import TopNav from "./_shell/TopNav";
import type { Notif, Message } from "./_shell/TopNav";
import DashSidebar from "./_shell/DashSidebar";
import ChatDock from "./_shell/ChatDock";
import type { ChatWindow, ChatMsg, ConfirmableTrade } from "./_shell/ChatDock";
import { type ImpactData } from "@/lib/impact-constants";
import { TASK_REWARDS, getLeafRank, type TaskKey, type TasksStatus } from "@/lib/task-constants";
import { CATEGORY_IMAGES } from "@/lib/category-images";


// ════════ DATA ════════

const ICONS = {
  home: "M3 11.5 12 4l9 7.5M5.5 9.8V20h13V9.8",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15.6 8.4l-1.9 5.3-5.3 1.9 1.9-5.3 5.3-1.9Z",
  swap: "M7 7h12l-3-3M17 17H5l3 3",
  chat: "M21 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-5.3A8 8 0 1 1 21 11.5Z",
  heart: "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z",
  bookmark: "M6 4h12v17l-6-4-6 4V4Z",
  bell: "M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6ZM9.5 20a2.5 2.5 0 0 0 5 0",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM16 16l5 5",
  plus: "M12 5v14M5 12h14",
  comment: "M21 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-5.3A8 8 0 1 1 21 11.5Z",
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L4.5 9.7l5.9-.9L12 3.5Z",
  pin: "M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  check: "M4 12.5 9 17.5 20 6.5",
  bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0",
  friends: "M16 21v-1.5a4 4 0 0 0-4-4H6.5a4 4 0 0 0-4 4V21M9.25 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5M21.5 21v-1.5a4 4 0 0 0-3-3.87M15.5 4.24a4 4 0 0 1 0 7.52",
  people: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  community: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18",
  shelf:     "M3 6h18v3H3zM5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M9 14h6",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  tag: "M3 12V4h8l10 10-8 8L3 12ZM7.5 8.5h.01",
  gift: "M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7S10.5 3 8 3 5 6 7 7h5ZM12 7s1.5-4 4-4 3 3 1 4h-5Z",
  settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-1.7-1l-.3-2.5h-4l-.3 2.5a7.6 7.6 0 0 0-1.7 1l-2.3-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7.6 7.6 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5Z",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  store: "M3.5 9 5 4h14l1.5 5M4 9.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5M3.5 9h17M9 20v-5.5h6V20M7.8 9.2a2.3 2.3 0 0 0 4.2 0 2.3 2.3 0 0 0 4 0",
  sun: "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2.5v2M12 19.5v2M5 5l1.4 1.4M17.6 17.6 19 19M2.5 12h2M19.5 12h2M5 19l1.4-1.4M17.6 6.4 19 5",
  moon: "M20.5 13.5A8 8 0 0 1 10.5 3.5a8 8 0 1 0 10 10Z",
  leaf: "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10ZM2 21c0-3 1.85-5.4 5.1-6",
  cycle: "M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5",
  droplet: "M12 21a7 7 0 0 0 7-7c0-4.5-7-11.5-7-11.5S5 9.5 5 14a7 7 0 0 0 7 7Z",
  sprout: "M7 20h10M12 20V9M12 9C12 6 9.5 4 6 4c0 3.5 2.5 5 6 5ZM12 10.6c0-2.4 2-4.3 4.8-4.3 0 2.7-2 4.3-4.8 4.3Z",
  cloud: "M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.3A3.5 3.5 0 0 1 18 18Z",
  x: "M18 6 6 18M6 6l12 12",
  image: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5ZM3 14l4-4 4 4 3-3 4 4M9 9h.01",
  mic: "M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8",
  play: "M5 3 19 12 5 21Z",
  pause: "M6 4H10V20H6ZM14 4H18V20H14Z",
  stop: "M5 5H19V19H5Z",
} as const;

type IconName = keyof typeof ICONS;

// ── Types ────────────────────────────────────────────────────────────────────
interface Me {
  id?: string;
  name: string; handle: string; avatar: string | null; rating: number; trades: number;
  streak: number; city: string; greenScore: number; tier: string; leaves: number;
}

interface ImpactMetric { icon: IconName; v: string; u: string; k: string }

interface Story { id: string; name: string; note: string }

interface SlideSpot {
  label: string; host: string[]; hostNote: string;
  bar?: number; facts: [string, string][];
}
interface Slide {
  kind: string; title: string; sub: string; cta: string;
  seed: string; stat: string; spot?: SlideSpot; href: string;
}

type PostType = "offer" | "want" | "complete";
interface Post {
  id: string; userId?: string; user: string; handle: string; time: string; city: string;
  type: PostType; text: string; item: string; wants: string; seed: string;
  tags: string[]; likes: number; liked?: boolean; comments: number; condition: string;
  with?: string; green?: number; lives?: number; co2?: string; match?: number;
  imageUrl?: string;
  /** Server-filtered pickup: coarse and address-less unless `precise`. */
  pickupLocation?: ViewerPickup | null;
}

type TradeTone = "wait" | "go" | "ship";
interface ActiveTrade {
  id: string; with: string; item: string; status: string; tone: TradeTone;
  rawStatus: string;
  offeredItemTitle:   string;
  requestedItemTitle: string;
  offeredLeaves:      number | null;
  sender:   { id: string; name: string };
  receiver: { id: string; name: string };
}
interface MatchSuggestion { name: string; reason: string; mutual: string; green: number }
// ── DashContext — per-render data, scoped to each request (no module-level mutable state) ──
interface DashContextValue {
  me: Me;
  activeTrades: ActiveTrade[];
  feed: Post[];
  stories: Story[];
  matches: MatchSuggestion[];
  categoryCounts: Record<string, number>;
  weeklyTrades: number;
  impactData: ImpactData;
  tasks: TasksStatus;
  trendingTags: string[];
  followingMap: Record<string, "PENDING" | "ACCEPTED">;
  setFollowingEntry: (userId: string, status: "PENDING" | "ACCEPTED") => void;
  openConfirmSwap: (trade: ConfirmableTrade) => void;
}

const DashContext = React.createContext<DashContextValue | null>(null);

function useDash(): DashContextValue {
  const ctx = React.useContext(DashContext);
  if (!ctx) throw new Error("useDash must be used inside BayloDashboard");
  return ctx;
}

// ── Static fallback slide (shown when user has no activity yet) ──────────────
const INTRO_SLIDE: Slide = {
  kind: "Featured", title: "Trade anything, waste nothing",
  sub: "Every swap keeps items out of landfill and builds your green score.",
  cta: "Post your first item", seed: "vinyl-collection", stat: "Start trading",
  href: "/dashboard/shelf",
  spot: { label: "How it works", host: ["I"], hostNote: "It’s free",
    facts: [["Post", "List what you have"], ["Match", "Find what you want"], ["Swap", "Meet and exchange"]] },
};

// ── Category definitions (real counts come from DB via CATEGORY_COUNTS) ───────
const CATEGORY_DEFS = [
  { name: "Fashion", key: "CLOTHING", seed: "cat-fashion" },
  { name: "Electronics", key: "ELECTRONICS", seed: "cat-elec" },
  { name: "Home & Garden", key: "FURNITURE", seed: "cat-home" },
  { name: "Books & Media", key: "BOOKS", seed: "cat-books" },
  { name: "Tools & DIY", key: "TOOLS", seed: "cat-tools" },
  { name: "Kids & Toys", key: "TOYS", seed: "cat-kids" },
];

// ── Post-creation helpers ─────────────────────────────────────────────────────
const CATEGORY_LABEL_MAP: Record<string, string> = {
  ELECTRONICS: "Electronics", CLOTHING: "Fashion", FURNITURE: "Home & Garden",
  BOOKS: "Books & Media", SPORTS: "Sports", TOYS: "Kids & Toys",
  TOOLS: "Tools & DIY", FOOD: "Food", SERVICES: "Services", OTHER: "Other",
};

function fmtCondition(c: string): string {
  return c.replace(/_/g, " ").toLowerCase().replace(/^\w/, (ch) => ch.toUpperCase());
}


// ════════ PRIMITIVES ════════

function Icon({
  name, size = 22, stroke = 2, fill = "none", className, style,
}: {
  name: IconName; size?: number; stroke?: number; fill?: string;
  className?: string; style?: React.CSSProperties;
}) {
  const d = ICONS[name] || "";
  const isFill = fill !== "none";
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24"
         fill={isFill ? "currentColor" : "none"}
         stroke={isFill ? "none" : "currentColor"} strokeWidth={stroke}
         strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const GRADS: [string, string][] = [
  ["#3C7143", "#2D2F22"], ["#FF6BA3", "#7A1F47"], ["#27E0B3", "#0C5B49"],
  ["#FFB23E", "#7A3E0C"], ["#5CA8FF", "#16356B"], ["#FF7A59", "#6B1F16"],
  ["#B86BFF", "#3A1A6B"], ["#3EE0FF", "#0C4A5B"], ["#C7FF3E", "#3E5B0C"],
  ["#FF5C8A", "#6B163A"], ["#8AFF9E", "#0C5B22"], ["#FFD23E", "#7A5B0C"],
];

function gradOf(seed: string | number): [string, string] {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return GRADS[h % GRADS.length];
}

function gradVars(seed: string): React.CSSProperties {
  const [a, b] = gradOf(seed);
  return { "--ph-a": a, "--ph-b": b } as React.CSSProperties;
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function Avatar({ name, src, size = 40, ring = false, style }: {
  name: string; src?: string | null; size?: number; ring?: boolean; style?: React.CSSProperties;
}) {
  const [a, b] = gradOf(name);
  const shared: React.CSSProperties = {
    width: size, height: size, borderRadius: "50%", flexShrink: 0,
    boxShadow: ring ? `0 0 0 2px var(--bg), 0 0 0 4px ${a}` : "none",
    ...style,
  };
  if (src) {
    return (
      <div style={{ ...shared, overflow: "hidden" }}>
        <img src={src} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    );
  }
  return (
    <div style={{
      ...shared,
      background: `linear-gradient(135deg, ${a}, ${b})`,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontWeight: 700, fontSize: size * 0.36, letterSpacing: "-.02em",
      fontFamily: "var(--font-body)", userSelect: "none",
    }}>{initials(name)}</div>
  );
}

function Photo({
  seed, src, aspect = "16 / 10", radius = "var(--r-md)", scrim = false,
  tag, badge, className, children, style,
}: {
  seed: string; src?: string; aspect?: string; radius?: string; scrim?: boolean;
  tag?: string | null; badge?: React.ReactNode; className?: string;
  children?: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div className={"photo" + (className ? " " + className : "")}
         style={{ aspectRatio: aspect, borderRadius: radius, ...style }}>
      {src
        ? <img className="photo-fill photo-img" src={src} alt="" />
        : <div className="photo-fill" style={gradVars(seed)} />}
      {!src && (
        <svg className="photo-motif" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <circle cx="80" cy="22" r="20" fill="none" stroke="#fff" strokeWidth="0.5" />
          <circle cx="20" cy="78" r="28" fill="none" stroke="#fff" strokeWidth="0.5" />
        </svg>
      )}
      {scrim && <div className="photo-scrim" />}
      {tag && <span className="photo-tag">{tag}</span>}
      {badge}
      {children}
    </div>
  );
}

function GreenScore({ score, tier }: { score: number; tier?: string }) {
  return (
    <span className="green-score" title={`Green Score ${score}/100`}>
      <Icon name="leaf" size={12} fill="x" />{score}{tier ? <em>{tier}</em> : null}
    </span>
  );
}

function LifecycleChip({ lives, co2 }: { lives: number; co2?: string }) {
  return (
    <span className="life-chip" title="Item lifecycle">
      <Icon name="cycle" size={12} />{ordinal(lives)} life{co2 ? <em>· {co2} kg CO₂ saved</em> : null}
    </span>
  );
}

function AvatarStack({ names }: { names: string[] }) {
  return (
    <span className="avatar-stack">
      {names.map((nm, k) => (
        <span key={nm} className="avatar-stack-item" style={{ zIndex: names.length - k }}>
          <Avatar name={nm} size={28} />
        </span>
      ))}
    </span>
  );
}


// ════════ STAGE ════════

function useAutoAdvance(length: number, ms: number, paused: boolean):
  [number, (n: number) => void] {
  const [i, setI] = React.useState(0);
  const go = React.useCallback((n: number) => setI(((n % length) + length) % length), [length]);
  React.useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setI((p) => (p + 1) % length), ms);
    return () => clearTimeout(t);
  }, [i, paused, length, ms]);
  return [i, go];
}

function StageDots({ n, i, go }: { n: number; i: number; go: (n: number) => void }) {
  return (
    <div className="stage-dots" role="tablist">
      {Array.from({ length: n }).map((_, k) => (
        <button key={k} role="tab" aria-selected={k === i} aria-label={`Slide ${k + 1}`}
                className={"stage-dot" + (k === i ? " on" : "")}
                onClick={() => go(k)} />
      ))}
    </div>
  );
}

function StageArrows({ go, i }: { go: (n: number) => void; i: number }) {
  return (
    <div className="stage-arrows">
      <button className="stage-arrow" aria-label="Previous" onClick={() => go(i - 1)}>
        <Icon name="arrowRight" size={20} style={{ transform: "rotate(180deg)" }} />
      </button>
      <button className="stage-arrow" aria-label="Next" onClick={() => go(i + 1)}>
        <Icon name="arrowRight" size={20} />
      </button>
    </div>
  );
}

function KindBadge({ kind }: { kind: string }) {
  return <span className="stage-kind"><Icon name="bolt" size={13} fill="x" />{kind}</span>;
}

function SpotlightCard({ spot }: { spot: SlideSpot }) {
  return (
    <aside className="stage-spot">
      <span className="stage-spot-label">{spot.label}</span>
      <div className="stage-spot-host">
        <AvatarStack names={spot.host} />
        <span className="stage-spot-hostnote">{spot.hostNote}</span>
      </div>
      {typeof spot.bar === "number" && (
        <div className="stage-spot-bar"><span style={{ width: spot.bar + "%" }} /></div>
      )}
      <ul className="stage-spot-facts">
        {spot.facts.map(([k, v]) => (
          <li key={k}><span>{k}</span><strong>{v}</strong></li>
        ))}
      </ul>
    </aside>
  );
}

function StageCinematic({ s, i, n, go }: { s: Slide; i: number; n: number; go: (n: number) => void }) {
  const router = useRouter();
  return (
    <div className="stage-slide cinematic">
      <div className="stage-bg">
        <Photo seed={s.seed} radius="0" aspect="auto"
               style={{ position: "absolute", inset: 0, aspectRatio: "auto", height: "100%" }} />
      </div>
      <div className="stage-scrim" />
      <div className="stage-cine-inner">
        <div className="stage-copy">
          <KindBadge kind={s.kind} />
          <h2 className="stage-title">{s.title}</h2>
          <p className="stage-sub">{s.sub}</p>
          <div className="stage-actions">
            <button className="btn-accent" onClick={() => router.push(s.href)}>
              {s.cta}<Icon name="arrowRight" size={17} />
            </button>
            <span className="stage-stat"><Icon name="bolt" size={14} fill="x" />{s.stat}</span>
          </div>
        </div>
        {s.spot && <SpotlightCard spot={s.spot} />}
      </div>
      <StageArrows go={go} i={i} />
      <StageDots n={n} i={i} go={go} />
    </div>
  );
}

function FeatureStage() {
  const { me, impactData, trendingTags, categoryCounts } = useDash();
  const [paused, setPaused] = React.useState(false);

  const slides = React.useMemo<Slide[]>(() => {
    const result: Slide[] = [];

    // Slide 1 — personalised trading stats
    if (me.trades > 0) {
      result.push({
        kind: "Your stats",
        title: `${me.trades} trade${me.trades !== 1 ? "s" : ""} and counting`,
        sub: `You're a ${me.tier} trader with a green score of ${me.greenScore}. Every swap grows your record.`,
        cta: "See my impact",
        href: "/dashboard/impact",
        seed: me.handle || "user-stats",
        stat: `${me.greenScore} green score`,
        spot: {
          label: "Your trading record",
          host: [me.name],
          hostNote: me.tier + " tier",
          facts: [
            ["Trades", String(me.trades)],
            ["Green score", String(me.greenScore)],
            ["Leaves", me.leaves.toLocaleString() + " Leaves"],
          ],
        },
      });
    }

    // Slide 2 — real environmental impact (only if they have trades)
    if (impactData.itemsRehomed > 0) {
      result.push({
        kind: "Your impact",
        title: `${impactData.itemsRehomed} item${impactData.itemsRehomed !== 1 ? "s" : ""} rehomed`,
        sub: `You've kept ${impactData.co2Avoided.toFixed(1)} kg of CO₂ out of the atmosphere and diverted ${impactData.wasteDiverted.toFixed(1)} kg of waste from landfill.`,
        cta: "See full impact",
        href: "/dashboard/impact",
        seed: "eco-impact",
        stat: `${impactData.co2Avoided.toFixed(1)} kg CO₂ saved`,
        spot: {
          label: "Environmental impact",
          host: [me.name],
          hostNote: "Your contribution",
          facts: [
            ["CO₂ avoided", impactData.co2Avoided.toFixed(1) + " kg"],
            ["Items rehomed", String(impactData.itemsRehomed)],
            ["Waste diverted", impactData.wasteDiverted.toFixed(1) + " kg"],
          ],
        },
      });
    }

    // Slide 3 — trending category with real counts
    const topTag = trendingTags[0];
    const matchedCat = CATEGORY_DEFS.find((c) => trendingTags.some((t) => t.toLowerCase().includes(c.name.toLowerCase())));
    const featCat = matchedCat ?? CATEGORY_DEFS[0];
    const featCount = categoryCounts[featCat.key] ?? 0;
    const topThree = CATEGORY_DEFS.slice(0, 3).map((c) => [c.name, categoryCounts[c.key] ? `${categoryCounts[c.key]} items` : "—"] as [string, string]);
    result.push({
      kind: "Trending now",
      title: topTag ? `${topTag} is trending` : "Fresh listings this week",
      sub: featCount > 0
        ? `${featCount.toLocaleString()} listing${featCount !== 1 ? "s" : ""} available right now. Browse and make an offer.`
        : "New listings are added daily. Browse the tradeplace to find your next swap.",
      cta: "Browse listings",
      href: "/dashboard/tradeplace",
      seed: featCat.seed,
      stat: featCount > 0 ? `${featCount} listings` : "Browse now",
      spot: {
        label: "Top categories",
        host: ["G", "H", "I"],
        hostNote: "Available now",
        facts: topThree,
      },
    });

    // Always end with the static intro slide
    result.push(INTRO_SLIDE);
    return result;
  }, [me, impactData, trendingTags, categoryCounts]);

  const [i, go] = useAutoAdvance(slides.length, 5200, paused);
  const s = slides[i];
  return (
    <section className="stage" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
             aria-roledescription="carousel">
      <StageCinematic key={i} s={s} i={i} n={slides.length} go={go} />
      <div className="stage-progress"><span style={{ animationDuration: paused ? "0s" : "5.2s" }} key={i} /></div>
    </section>
  );
}

function Stories() {
  const { stories } = useDash();
  return (
    <div className="stories">
      <button className="story add">
        <span className="story-ring add"><Icon name="plus" size={22} /></span>
        <span className="story-name">Your shelf</span>
      </button>
      {stories.length === 0 ? (
        <span className="stories-empty">No traders nearby yet</span>
      ) : stories.map((st) => (
        <button key={st.name} className="story">
          <span className="story-ring"><Avatar name={st.name} size={50} /></span>
          <span className="story-name">{st.name.split(" ")[0]}</span>
          <span className="story-note">{st.note}</span>
        </button>
      ))}
    </div>
  );
}


// ════════ FEED ════════

// ── Composer modal ────────────────────────────────────────────────────────────
interface VerifiedItem {
  id: string; title: string; category: string; condition: string; imageUrl?: string | null;
}
type ReturnPreference = "leaves" | "item" | "both";

function ComposerModal({ onClose, onPosted }: {
  onClose: () => void;
  onPosted: (p: Post) => void;
}) {
  const { me } = useDash();
  const [description, setDescription] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [myItems, setMyItems] = React.useState<VerifiedItem[]>([]);
  const [itemsLoading, setItemsLoading] = React.useState(false);
  const [selectedItem, setSelectedItem] = React.useState<VerifiedItem | null>(null);
  const [returnType, setReturnType] = React.useState<ReturnPreference>("item");
  const [returnLeaves, setReturnLeaves] = React.useState(0);
  const [returnItemText, setReturnItemText] = React.useState("");
  const [localPickup, setLocalPickup] = React.useState(false);
  const [pickupLocation, setPickupLocation] = React.useState<PickupLocation | null>(null);

  React.useEffect(() => {
    setItemsLoading(true);
    fetch("/api/items?mine=true&status=VERIFIED")
      .then((r) => r.json())
      .then((data: unknown) => { setMyItems(Array.isArray(data) ? (data as VerifiedItem[]) : []); })
      .catch(() => setMyItems([]))
      .finally(() => setItemsLoading(false));
  }, []);

  const submit = async () => {
    setError("");
    if (!selectedItem) { setError("Please select an item to offer"); return; }
    if (returnType === "leaves" && returnLeaves <= 0) { setError("Enter the number of Leaves you want"); return; }
    if (returnType === "item" && !returnItemText.trim()) { setError("Describe what you’re looking for"); return; }
    if (returnType === "both" && (returnLeaves <= 0 || !returnItemText.trim())) {
      setError("Fill in both the item description and the Leaves amount"); return;
    }
    if (localPickup && !pickupLocation) { setError("Please select a pickup location on the map"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: selectedItem.id,
          title: selectedItem.title,
          description: description.trim() || null,
          category: selectedItem.category,
          condition: selectedItem.condition,
          returnType,
          returnLeaves: returnType !== "item" ? returnLeaves : null,
          wantedItems: returnType !== "leaves" ? returnItemText.trim() || null : null,
          localPickup,
          pickupLat: pickupLocation?.lat ?? null,
          pickupLng: pickupLocation?.lng ?? null,
          pickupAddress: pickupLocation?.address ?? null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to post");
      }
      const item = await res.json() as { id: string };
      const wantsLabel =
        returnType === "leaves" ? `${returnLeaves} Leaves`
        : returnType === "both" ? `${returnItemText} · ${returnLeaves} Leaves`
        : returnItemText;
      const tags = [CATEGORY_LABEL_MAP[selectedItem.category] ?? selectedItem.category];
      if (localPickup && pickupLocation) tags.push("Local pickup");
      onPosted({
        id: item.id, user: me.name, handle: me.handle,
        time: "just now", city: me.city, type: "offer",
        text: description.trim() || selectedItem.title,
        item: selectedItem.title, wants: wantsLabel,
        seed: item.id,
        tags,
        likes: 0, comments: 0,
        condition: fmtCondition(selectedItem.condition),
        // Optimistic local echo of a post the viewer just created: they are the
        // owner, so the exact point is theirs to see.
        pickupLocation: localPickup && pickupLocation
          ? { ...pickupLocation, precise: true as const }
          : null,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Offer an item</h2>
          <button className="icon-btn ghost modal-close" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </div>

        {/* A. Item picker */}
        <div className="modal-field">
          <label>What are you offering?</label>
          {itemsLoading ? (
            <div className="item-picker-loading">Loading your items…</div>
          ) : myItems.length === 0 ? (
            <div className="item-picker-empty">
              <Icon name="grid" size={32} />
              <p>No items on your shelf yet</p>
              <button className="btn-soft sm">Add &amp; verify an item first</button>
            </div>
          ) : (
            <div className="item-picker">
              {myItems.map((it) => (
                <button key={it.id}
                        className={"item-card" + (selectedItem?.id === it.id ? " selected" : "")}
                        onClick={() => setSelectedItem(it)}>
                  <div className="item-card-photo">
                    {it.imageUrl
                      ? <img src={it.imageUrl} alt={it.title} />
                      : <div className="item-card-ph" style={gradVars(it.id)} />}
                    <span className="item-verified-badge" title="Verified">
                      <Icon name="check" size={10} />
                    </span>
                  </div>
                  <span className="item-card-name">{it.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* B. Auto-filled category / condition chips */}
        {selectedItem && (
          <div className="auto-chips">
            <span className="auto-chip">
              <Icon name="tag" size={12} />
              {CATEGORY_LABEL_MAP[selectedItem.category] ?? selectedItem.category}
            </span>
            <span className="auto-chip">
              <Icon name="check" size={12} />
              {fmtCondition(selectedItem.condition)}
            </span>
          </div>
        )}

        {/* C. Return preference */}
        <div className="modal-field">
          <label>What are you looking for in return?</label>
          <div className="return-seg">
            {(["item", "leaves", "both"] as ReturnPreference[]).map((t) => (
              <button key={t} className={"return-seg-btn" + (returnType === t ? " on" : "")}
                      onClick={() => setReturnType(t)}>
                {t === "leaves" ? "Leaves" : t === "item" ? "Item" : "Both"}
              </button>
            ))}
          </div>
          <div className="return-fields">
            {(returnType === "item" || returnType === "both") && (
              <input value={returnItemText} onChange={(e) => setReturnItemText(e.target.value)}
                placeholder="e.g. Plants, cookware" className="modal-input" />
            )}
            {(returnType === "leaves" || returnType === "both") && (
              <div className="points-input">
                <button type="button" className="points-step"
                        onClick={() => setReturnLeaves((p) => Math.max(0, p - 10))}>−</button>
                <input type="number" min={0} value={returnLeaves || ""}
                  onChange={(e) => setReturnLeaves(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="0 Leaves" className="modal-input points-field" />
                <button type="button" className="points-step"
                        onClick={() => setReturnLeaves((p) => p + 10)}>+</button>
              </div>
            )}
          </div>
        </div>

        {/* D. Description (optional) */}
        <div className="modal-field">
          <label>Description <span className="modal-optional">(optional)</span></label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Add any extra details about the trade…"
            className="modal-textarea" rows={3} />
        </div>

        {/* E. Local pickup toggle + map */}
        <div className="modal-toggle-row">
          <span className="modal-toggle-label">
            <Icon name="pin" size={15} />Available for local pickup
          </span>
          <button type="button" role="switch" aria-checked={localPickup}
                  className={"toggle-switch" + (localPickup ? " on" : "")}
                  onClick={() => { setLocalPickup((v) => !v); if (localPickup) setPickupLocation(null); }} />
        </div>
        {localPickup && (
          <div className="modal-field">
            <PickupMap value={pickupLocation} onChange={setPickupLocation} />
          </div>
        )}

        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions">
          <button className="btn-soft" onClick={onClose}>Cancel</button>
          <button className="btn-accent" onClick={submit} disabled={loading}>
            {loading ? "Posting…" : <><Icon name="send" size={16} />Post</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function WantModal({ onClose, onPosted }: {
  onClose: () => void;
  onPosted: (p: Post) => void;
}) {
  const { me } = useDash();
  const [wantedItem, setWantedItem] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [returnType, setReturnType] = React.useState<ReturnPreference>("item");
  const [returnLeaves, setReturnLeaves] = React.useState(0);
  const [returnItemText, setReturnItemText] = React.useState("");
  const [localPickup, setLocalPickup] = React.useState(false);
  const [pickupLocation, setPickupLocation] = React.useState<PickupLocation | null>(null);
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [imagePreview, setImagePreview] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const removeImage = () => {
    setImageFile(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = async () => {
    setError("");
    if (!wantedItem.trim()) { setError("Describe what you're looking for"); return; }
    if (returnType === "item" && !returnItemText.trim()) { setError("Describe what you'll offer in return"); return; }
    if (returnType === "leaves" && returnLeaves <= 0) { setError("Enter the number of Leaves you'll offer"); return; }
    if (returnType === "both" && (returnLeaves <= 0 || !returnItemText.trim())) {
      setError("Fill in both the item and the Leaves amount"); return;
    }
    if (localPickup && !pickupLocation) { setError("Please select a pickup location on the map"); return; }
    setLoading(true);
    try {
      let uploadedImageUrl: string | undefined;
      if (imageFile) {
        const fd = new FormData();
        fd.append("file", imageFile);
        const upRes = await fetch("/api/upload", { method: "POST", body: fd });
        if (!upRes.ok) throw new Error("Image upload failed");
        const upData = await upRes.json() as { url: string };
        uploadedImageUrl = upData.url;
      }

      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: wantedItem.trim(),
          description: description.trim() || wantedItem.trim(),
          category: "OTHER",
          condition: "GOOD",
          images: uploadedImageUrl ? [uploadedImageUrl] : [],
          wantedItems: returnType !== "leaves" ? returnItemText.trim() || null : null,
          localPickup,
          pickupLat: pickupLocation?.lat ?? null,
          pickupLng: pickupLocation?.lng ?? null,
          pickupAddress: pickupLocation?.address ?? null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Failed to post");
      }
      const item = await res.json() as { id: string };
      const givesLabel =
        returnType === "leaves" ? `${returnLeaves} Leaves`
        : returnType === "both" ? `${returnItemText} · ${returnLeaves} Leaves`
        : returnItemText;
      const tags: string[] = [];
      if (localPickup && pickupLocation) tags.push("Local pickup");
      onPosted({
        id: item.id, user: me.name, handle: me.handle,
        time: "just now", city: me.city, type: "want",
        text: description.trim() || wantedItem.trim(),
        item: wantedItem.trim(), wants: givesLabel,
        seed: item.id,
        imageUrl: uploadedImageUrl,
        tags,
        likes: 0, comments: 0,
        condition: "—",
        // Optimistic local echo of a post the viewer just created: they are the
        // owner, so the exact point is theirs to see.
        pickupLocation: localPickup && pickupLocation
          ? { ...pickupLocation, precise: true as const }
          : null,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Post a want</h2>
          <button className="icon-btn ghost modal-close" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </div>

        <div className="modal-field">
          <label>What are you looking for?</label>
          <input value={wantedItem} onChange={(e) => setWantedItem(e.target.value)}
            placeholder="e.g. Vintage camera, road bike, sofa…"
            className="modal-input" />
        </div>

        <div className="modal-field">
          <label>What will you offer in return?</label>
          <div className="return-seg">
            {(["item", "leaves", "both"] as ReturnPreference[]).map((t) => (
              <button key={t} className={"return-seg-btn" + (returnType === t ? " on" : "")}
                      onClick={() => setReturnType(t)}>
                {t === "leaves" ? "Leaves" : t === "item" ? "Item" : "Both"}
              </button>
            ))}
          </div>
          <div className="return-fields">
            {(returnType === "item" || returnType === "both") && (
              <input value={returnItemText} onChange={(e) => setReturnItemText(e.target.value)}
                placeholder="e.g. Vinyl records, cookware" className="modal-input" />
            )}
            {(returnType === "leaves" || returnType === "both") && (
              <div className="points-input">
                <button type="button" className="points-step"
                        onClick={() => setReturnLeaves((p) => Math.max(0, p - 10))}>−</button>
                <input type="number" min={0} value={returnLeaves || ""}
                  onChange={(e) => setReturnLeaves(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="0 Leaves" className="modal-input points-field" />
                <button type="button" className="points-step"
                        onClick={() => setReturnLeaves((p) => p + 10)}>+</button>
              </div>
            )}
          </div>
        </div>

        <div className="modal-field">
          <label>Description <span className="modal-optional">(optional)</span></label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Size, color, condition preference, or any other details…"
            className="modal-textarea" rows={3} />
        </div>

        <div className="modal-field">
          <label>Reference photo <span className="modal-optional">(optional)</span></label>
          <input ref={fileInputRef} type="file" accept="image/*" className="sr-only"
                 onChange={handleImageChange} />
          {imagePreview ? (
            <div className="want-photo-preview">
              <img src={imagePreview} alt="Preview" />
              <div className="want-photo-actions">
                <button type="button" className="btn-soft sm" onClick={() => fileInputRef.current?.click()}>
                  Change photo
                </button>
                <button type="button" className="icon-btn ghost" aria-label="Remove photo" onClick={removeImage}>
                  <Icon name="x" size={18} />
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="want-photo-add" onClick={() => fileInputRef.current?.click()}>
              <Icon name="droplet" size={20} />
              <span>Add a photo</span>
            </button>
          )}
        </div>

        <div className="modal-toggle-row">
          <span className="modal-toggle-label">
            <Icon name="pin" size={15} />Available for local pickup
          </span>
          <button type="button" role="switch" aria-checked={localPickup}
                  className={"toggle-switch" + (localPickup ? " on" : "")}
                  onClick={() => { setLocalPickup((v) => !v); if (localPickup) setPickupLocation(null); }} />
        </div>
        {localPickup && (
          <div className="modal-field">
            <PickupMap value={pickupLocation} onChange={setPickupLocation} />
          </div>
        )}

        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions">
          <button className="btn-soft" onClick={onClose}>Cancel</button>
          <button className="btn-accent" onClick={submit} disabled={loading}>
            {loading ? "Posting…" : <><Icon name="search" size={16} />Post want</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function Composer({ onNewPost }: { onNewPost: (p: Post) => void }) {
  const { me } = useDash();
  const [offerOpen, setOfferOpen] = React.useState(false);
  const [wantOpen, setWantOpen] = React.useState(false);

  return (
    <>
      <div className="composer card">
        <div className="composer-row">
          <Avatar name={me.name} size={44} />
          <button className="composer-input" onClick={() => setOfferOpen(true)}>
            What are you trading today, {me.name.split(" ")[0]}?
          </button>
        </div>
        <div className="composer-chips">
          <button className="composer-chip" onClick={() => setOfferOpen(true)}>
            <Icon name="tag" size={17} /><span>Offer an item</span>
          </button>
          <button className="composer-chip" onClick={() => setWantOpen(true)}>
            <Icon name="search" size={17} /><span>Post a want</span>
          </button>
        </div>
      </div>
      {offerOpen && (
        <ComposerModal onClose={() => setOfferOpen(false)} onPosted={onNewPost} />
      )}
      {wantOpen && (
        <WantModal onClose={() => setWantOpen(false)} onPosted={onNewPost} />
      )}
    </>
  );
}

function TypePill({ type }: { type: PostType }) {
  const map: Record<PostType, { label: string; icon: IconName; cls: string }> = {
    offer: { label: "Offering", icon: "tag", cls: "offer" },
    want: { label: "Looking for", icon: "search", cls: "want" },
    complete: { label: "Trade complete", icon: "check", cls: "complete" },
  };
  const t = map[type];
  return <span className={"type-pill " + t.cls}><Icon name={t.icon} size={13} />{t.label}</span>;
}

function TradeDeck({ post }: { post: Post }) {
  const give = post.type === "want"
    ? { label: "They’re seeking", icon: "search" as IconName }
    : { label: "They’re offering", icon: "tag" as IconName };
  const get = post.type === "want"
    ? { label: "They’ll give", icon: "gift" as IconName }
    : { label: "They want", icon: "swap" as IconName };
  return (
    <div className="trade-deck">
      <div className="trade-side">
        <span className="trade-side-label"><Icon name={give.icon} size={12} />{give.label}</span>
        <strong>{post.item}</strong>
      </div>
      <span className="trade-swap" aria-hidden="true"><Icon name="swap" size={16} /></span>
      <div className="trade-side want">
        <span className="trade-side-label"><Icon name={get.icon} size={12} />{get.label}</span>
        <strong>{post.wants}</strong>
      </div>
    </div>
  );
}

function MatchMeter({ value }: { value: number }) {
  return (
    <span className="match-meter" title={value + "% match with your shelf"}>
      <span className="match-bar"><span style={{ width: value + "%" }} /></span>
      <em>{value}% match with your shelf</em>
    </span>
  );
}

const PickupPreviewMap = dynamic(() => import("./PickupMap").then((m) => {
  const C = ({ loc }: { loc: ViewerPickup }) => (
    <m.default value={{ lat: loc.lat, lng: loc.lng, address: loc.address ?? "" }} onChange={() => {}} />
  );
  C.displayName = "PickupPreviewMap";
  return C;
}), { ssr: false });

function PickupBadge({ location }: { location: ViewerPickup }) {
  const [open, setOpen] = React.useState(false);
  // No address means the server withheld it — show the area label instead of
  // slicing a string that is not there.
  const area = location.precise && location.address
    ? location.address.split(",")[0]
    : "nearby";
  return (
    <>
      <button className="pickup-badge" onClick={() => setOpen(true)}>
        <Icon name="pin" size={12} />Local pickup · {area}
      </button>
      {open && (
        <div className="pickup-preview" onClick={() => setOpen(false)}>
          <div className="pickup-preview-box" onClick={(e) => e.stopPropagation()}>
            <div className="pickup-preview-head">
              <span><Icon name="pin" size={14} /> Pickup location</span>
              <button className="icon-btn ghost" onClick={() => setOpen(false)}>
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="pickup-preview-addr">
              <span>
                {location.precise && location.address
                  ? location.address
                  : "Approximate area — the exact pickup point is shared once a trade is accepted"}
              </span>
            </div>
            <div className="pickup-preview-map">
              <PickupPreviewMap loc={location} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FollowButton({ targetUserId }: { targetUserId: string }) {
  const { me, followingMap, setFollowingEntry } = useDash();
  const initial = followingMap[targetUserId];
  const [state, setState] = React.useState<"none" | "PENDING" | "ACCEPTED">(initial ?? "none");
  const [loading, setLoading] = React.useState(false);

  if (targetUserId === (me.id ?? "")) return null;
  if (state === "ACCEPTED") return (
    <span className="follow-btn following">Following</span>
  );

  const sendRequest = async () => {
    if (loading || state !== "none") return;
    setLoading(true);
    try {
      const res = await fetch("/api/follows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followeeId: targetUserId }),
      });
      if (res.ok) {
        setFollowingEntry(targetUserId, "PENDING");
        setState("PENDING");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <button className={"follow-btn" + (state === "PENDING" ? " requested" : "")}
            disabled={loading || state === "PENDING"}
            onClick={sendRequest}>
      {state === "PENDING" ? "Requested" : loading ? "…" : "+ Follow"}
    </button>
  );
}

// ── Comment types ─────────────────────────────────────────────────────────────
interface CommentUser { id: string; name: string; avatar: string | null }
interface CommentData {
  id: string; content: string; createdAt: string;
  user: CommentUser; likeCount: number; liked: boolean;
  replies: Omit<CommentData, "replies">[];
}

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function CommentBubble({ c, postId, onReply, isReply = false }: {
  c: Omit<CommentData, "replies"> & { replies?: CommentData["replies"] };
  postId: string; onReply?: (id: string, name: string) => void; isReply?: boolean;
}) {
  const [liked, setLiked] = React.useState(c.liked);
  const [likeCount, setLikeCount] = React.useState(c.likeCount);
  const [liking, setLiking] = React.useState(false);

  const toggleLike = async () => {
    if (liking) return;
    setLiking(true);
    setLiked((v) => !v);
    setLikeCount((n) => liked ? n - 1 : n + 1);
    try {
      await fetch(`/api/posts/${postId}/comments/${c.id}/like`, { method: "POST" });
    } finally {
      setLiking(false);
    }
  };

  return (
    <div className={"comment-item" + (isReply ? " reply" : "")}>
      <Avatar name={c.user.name} size={isReply ? 28 : 34} />
      <div className="comment-body">
        <div className="comment-bubble">
          <span className="comment-author">{c.user.name}</span>
          <span className="comment-text">{c.content}</span>
        </div>
        <div className="comment-meta">
          <span className="comment-time">{relTime(c.createdAt)}</span>
          <button className={"comment-like-btn" + (liked ? " liked" : "")} onClick={toggleLike}>
            <Icon name="heart" size={12} fill={liked ? "x" : "none"} />
            {likeCount > 0 && <span>{likeCount}</span>}
          </button>
          {!isReply && onReply && (
            <button className="comment-reply-btn" onClick={() => onReply(c.id, c.user.name)}>Reply</button>
          )}
        </div>
      </div>
    </div>
  );
}

function CommentsSection({ postId, initialCount, open, onCountChange }: {
  postId: string; initialCount: number; open: boolean;
  onCountChange?: (n: number) => void;
}) {
  const { me } = useDash();
  const [comments, setComments] = React.useState<CommentData[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [count, setCount] = React.useState(initialCount);
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [replyTo, setReplyTo] = React.useState<{ id: string; name: string } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const loadedRef = React.useRef(false);

  const load = React.useCallback(async (cursor?: string) => {
    setLoading(true);
    try {
      const url = `/api/posts/${postId}/comments` + (cursor ? `?cursor=${cursor}` : "");
      const r = await fetch(url);
      const data = await r.json() as { comments: CommentData[]; hasMore: boolean; nextCursor: string | null };
      setComments((prev) => cursor ? [...prev, ...data.comments] : data.comments);
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  React.useEffect(() => {
    if (open && !loadedRef.current) {
      loadedRef.current = true;
      load();
    }
  }, [open, load]);

  const handleReply = (id: string, name: string) => {
    setReplyTo({ id, name });
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const send = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setText("");
    try {
      const body: Record<string, unknown> = { content };
      if (replyTo) body.parentId = replyTo.id;
      const r = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        const newComment = await r.json() as CommentData;
        if (replyTo) {
          setComments((prev) => prev.map((c) =>
            c.id === replyTo.id ? { ...c, replies: [...(c.replies ?? []), newComment] } : c
          ));
        } else {
          setComments((prev) => [...prev, newComment]);
        }
        const newCount = count + 1;
        setCount(newCount);
        onCountChange?.(newCount);
        setReplyTo(null);
      }
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === "Escape") setReplyTo(null);
  };

  if (!open) return null;

  return (
    <div className="comments-section">
      {loading && comments.length === 0 ? (
        <div className="comments-loading">Loading comments…</div>
      ) : comments.length === 0 ? (
        <div className="comments-empty">No comments yet — be the first!</div>
      ) : (
        <div className="comment-list">
          {comments.map((c) => (
            <React.Fragment key={c.id}>
              <CommentBubble c={c} postId={postId} onReply={handleReply} />
              {c.replies?.map((r) => (
                <CommentBubble key={r.id} c={r} postId={postId} isReply />
              ))}
            </React.Fragment>
          ))}
          {hasMore && (
            <button className="load-more-btn" onClick={() => load(nextCursor ?? undefined)} disabled={loading}>
              {loading ? "Loading…" : "View more comments"}
            </button>
          )}
        </div>
      )}

      {replyTo && (
        <div className="reply-to-bar">
          Replying to <strong>{replyTo.name}</strong>
          <button className="reply-to-cancel" onClick={() => setReplyTo(null)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      <div className="comment-input-row">
        <Avatar name={me.name} size={32} />
        <input
          ref={inputRef}
          className="comment-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={replyTo ? `Reply to ${replyTo.name}…` : "Write a comment…"}
          disabled={sending}
        />
        <button className="comment-send" onClick={send} disabled={sending || !text.trim()}>
          <Icon name="send" size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Share dropdown ─────────────────────────────────────────────────────────────
function ShareDropdown({ post, onClose, onOpenChat }: {
  post: Post; onClose: () => void;
  onOpenChat: (name: string, partnerId: string) => void;
}) {
  const [copied, setCopied] = React.useState(false);

  const copyLink = async () => {
    const url = `${window.location.origin}/post/${post.id}`;
    try { await navigator.clipboard.writeText(url); } catch { /* fallback */ }
    setCopied(true);
    setTimeout(() => { setCopied(false); onClose(); }, 1800);
  };

  const shareToFeed = async () => {
    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiverId: post.userId,
          content: JSON.stringify({
            type: "shared_post",
            postId: post.id,
            postItem: post.item,
            postUser: post.user,
            postType: post.type,
            imageUrl: post.imageUrl || null,
          }),
        }),
      });
    } catch { /* silent */ }
    onClose();
  };

  return (
    <div className="share-dropdown" onClick={(e) => e.stopPropagation()}>
      <button className="share-option" onClick={shareToFeed}>
        <Icon name="chat" size={16} />Share to friends
      </button>
      <button className="share-option" onClick={() => {
        // community share — just a toast for now
        import("react-hot-toast").then((m) => m.default.success("Shared to community feed!"));
        onClose();
      }}>
        <Icon name="community" size={16} />Share to community
      </button>
      <button className="share-option" onClick={copyLink}>
        <Icon name="send" size={16} />{copied ? "Link copied!" : "Copy link"}
      </button>
    </div>
  );
}

// ── Make an Offer modal ────────────────────────────────────────────────────────
function MakeOfferModal({ post, onClose, onOpenChat }: {
  post: Post; onClose: () => void;
  onOpenChat: (name: string, partnerId: string) => void;
}) {
  const { me } = useDash();
  const leafTotal = me.leaves ?? 0;
  const [myItems, setMyItems] = React.useState<VerifiedItem[]>([]);
  const [itemsLoading, setItemsLoading] = React.useState(false);
  const [selectedItem, setSelectedItem] = React.useState<VerifiedItem | null>(null);
  const [offerType, setOfferType] = React.useState<"item" | "leaves" | "both">("item");
  const [leaves, setLeaves] = React.useState(0);
  const [message, setMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [showLowLeavesAlert, setShowLowLeavesAlert] = React.useState(false);

  React.useEffect(() => {
    setItemsLoading(true);
    fetch("/api/items?mine=true")
      .then((r) => r.json())
      .then((data: unknown) => setMyItems(Array.isArray(data) ? (data as VerifiedItem[]) : []))
      .catch(() => setMyItems([]))
      .finally(() => setItemsLoading(false));
  }, []);

  const submit = async () => {
    setError("");
    if (offerType !== "leaves" && !selectedItem) { setError("Select an item to offer"); return; }
    if (offerType !== "item" && leaves <= 0) { setError("Enter the number of Leaves"); return; }
    setLoading(true);
    try {
      const offeredItems = selectedItem
        ? [{ id: selectedItem.id, title: selectedItem.title, imageUrl: selectedItem.imageUrl }]
        : [];
      const res = await fetch("/api/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: post.id,
          offeredItems,
          offeredLeaves: offerType !== "item" ? leaves : null,
          message: message.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to send offer");
      }
      const { partnerName, partnerId } = await res.json() as { partnerName: string; partnerId: string };
      onClose();
      if (partnerId) onOpenChat(partnerName, partnerId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Make an offer</h2>
          <button className="icon-btn ghost modal-close" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </div>

        {/* What they're offering */}
        <div className="offer-for-row">
          <span className="offer-for-label">Offering for</span>
          <div className="offer-for-item">
            <div className="offer-for-photo">
              {post.imageUrl
                ? <img src={post.imageUrl} alt={post.item} />
                : <div className="item-card-ph" style={gradVars(post.seed)} />}
            </div>
            <div className="offer-for-info">
              <strong>{post.item}</strong>
              <span>{post.user}</span>
            </div>
          </div>
        </div>

        {/* What you're offering */}
        <div className="modal-field">
          <label>What are you offering?</label>
          <div className="return-seg" style={{ marginBottom: 10 }}>
            {(["item", "leaves", "both"] as const).map((t) => (
              <button key={t} className={"return-seg-btn" + (offerType === t ? " on" : "")}
                      onClick={() => setOfferType(t)}>
                {t === "item" ? "Item" : t === "leaves" ? "Leaves" : "Both"}
              </button>
            ))}
          </div>

          {(offerType === "item" || offerType === "both") && (
            <>
              {itemsLoading ? (
                <div className="item-picker-loading">Loading your items…</div>
              ) : myItems.length === 0 ? (
                <div className="item-picker-empty">
                  <Icon name="grid" size={32} />
                  <p>You need an item on your shelf to make an offer</p>
                  <button className="btn-soft sm" onClick={onClose}>Add an item first</button>
                </div>
              ) : (
                <div className="item-picker">
                  {myItems.map((it) => (
                    <button key={it.id}
                            className={"item-card" + (selectedItem?.id === it.id ? " selected" : "")}
                            onClick={() => setSelectedItem(it)}>
                      <div className="item-card-photo">
                        {it.imageUrl
                          ? <img src={it.imageUrl} alt={it.title} />
                          : <div className="item-card-ph" style={gradVars(it.id)} />}
                        <span className="item-verified-badge" title="Verified">
                          <Icon name="check" size={10} />
                        </span>
                      </div>
                      <span className="item-card-name">{it.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {(offerType === "leaves" || offerType === "both") && (
            <div style={{ marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, fontSize: 12, color: "var(--ink-3, #888)" }}>
                <span>Pasa Leaves to offer</span>
                <span>You have <strong>{leafTotal.toLocaleString("en-US")} Leaves</strong></span>
              </div>
              <div className="points-input">
                <button type="button" className="points-step"
                        onClick={() => setLeaves((p) => Math.max(0, p - 10))}>−</button>
                <input type="number" min={0} max={leafTotal} value={leaves || ""}
                  onChange={(e) => setLeaves(Math.min(leafTotal, Math.max(0, parseInt(e.target.value) || 0)))}
                  placeholder="0 Leaves" className="modal-input points-field" />
                <button type="button" className="points-step"
                        onClick={() => {
                          if (leafTotal === 0) { setShowLowLeavesAlert(true); return; }
                          setLeaves((p) => Math.min(leafTotal, p + 10));
                        }}>+</button>
              </div>
              {leaves > leafTotal && (
                <p style={{ marginTop: 6, fontSize: 12, color: "#dc2626" }}>
                  You only have {leafTotal.toLocaleString("en-US")} Leaves.{" "}
                  <button type="button" style={{ color: "#059669", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: 0 }}
                    onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("baylo:openLeaves")); }}>
                    View my Leaves →
                  </button>
                </p>
              )}
              {leafTotal === 0 && (
                <p style={{ marginTop: 6, fontSize: 12, color: "#888" }}>
                  No Leaves yet.{" "}
                  <button type="button" style={{ color: "#059669", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: 0 }}
                    onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("baylo:openLeaves")); }}>
                    Earn Leaves by trading →
                  </button>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="modal-field">
          <label>Message <span className="modal-optional">(optional)</span></label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="Add a message…" className="modal-textarea" rows={3} />
        </div>

        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions">
          <button className="btn-soft" onClick={onClose}>Cancel</button>
          <button className="btn-accent" onClick={submit}
            disabled={loading || (offerType !== "item" && leaves > leafTotal)}>
            {loading ? "Sending…" : <><Icon name="send" size={15} />Send offer</>}
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
              You have 0 Pasa Leaves. Leaves are earned by completing trades — you can still offer an item.
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

function FeedCard({ post, onOpenChat }: { post: Post; onOpenChat: (name: string, partnerId: string) => void }) {
  const { me } = useDash();
  const router = useRouter();
  const [liked, setLiked] = React.useState(!!post.liked);
  const [likeCount, setLikeCount] = React.useState(post.likes);
  const [liking, setLiking] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [offerOpen, setOfferOpen] = React.useState(false);
  const [commentsOpen, setCommentsOpen] = React.useState(false);
  const [commentCount, setCommentCount] = React.useState(post.comments);
  const shareRef = React.useRef<HTMLDivElement>(null);
  const done = post.type === "complete";
  const isOwn = post.userId === (me.id ?? "");

  const goToListing = () => router.push(`/dashboard/tradeplace?open=${post.id}`);

  React.useEffect(() => {
    if (!shareOpen) return;
    const h = (e: PointerEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShareOpen(false);
    };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [shareOpen]);

  const toggleLike = async () => {
    if (liking) return;
    setLiking(true);
    const wasLiked = liked;
    setLiked((v) => !v);
    setLikeCount((n) => wasLiked ? n - 1 : n + 1);
    try {
      const res = await fetch(`/api/posts/${post.id}/like`, { method: "POST" });
      if (res.ok) {
        const data = await res.json() as { liked: boolean; count: number };
        setLiked(data.liked);
        setLikeCount(data.count);
      }
    } finally {
      setLiking(false);
    }
  };

  return (
    <>
      <article className={"card post" + (done ? " post-done" : "")}>
        <header className="post-head">
          <Avatar name={post.user} size={44} />
          <div className="post-id">
            <div className="post-name">
              {post.user}
              {post.userId && <FollowButton targetUserId={post.userId} />}
              <TypePill type={post.type} />
            </div>
            <div className="post-meta">
              @{post.handle}{post.city && post.city !== "—" ? <> · <Icon name="pin" size={12} />{post.city}</> : null} · {post.time}
              {post.green ? <GreenScore score={post.green} /> : null}
            </div>
          </div>
          <button className="icon-btn ghost" aria-label="More"><Icon name="more" size={20} /></button>
        </header>

        <p className="post-text">{post.text}</p>

        {done ? (
          <div className="post-media">
            <Photo seed={post.seed} aspect="16 / 9" scrim
                   badge={<span className="deal-stamp"><Icon name="check" size={14} />Deal closed</span>} />
            <div className="swap-done">
              <div className="swap-party"><Avatar name={post.user} size={34} /><span>{post.user.split(" ")[0]}</span></div>
              <span className="swap-arrows"><Icon name="swap" size={18} /></span>
              <div className="swap-party"><Avatar name={post.with || ""} size={34} /><span>{(post.with || "").split(" ")[0]}</span></div>
              <strong className="swap-item">{post.item}</strong>
            </div>
          </div>
        ) : (
          <div className={"post-trade" + (!post.imageUrl ? " post-trade-text" : "")}>
            <div
              className="post-trade-main"
              role="button"
              tabIndex={0}
              onClick={goToListing}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") goToListing(); }}
            >
              {post.imageUrl && (
                <Photo seed={post.seed} src={post.imageUrl} aspect="16 / 9"
                       tag={post.condition && post.condition !== "—" ? post.condition : null}
                       badge={post.match ? <span className="match-chip"><Icon name="bolt" size={12} fill="x" />{post.match}% match</span> : null} />
              )}
              <TradeDeck post={post} />
            </div>
            {(post.match || !isOwn) && (
              <div className="trade-cta">
                {post.match ? <MatchMeter value={post.match} /> : null}
                {!isOwn && (
                  <button className="btn-accent sm offer-btn" onClick={() => setOfferOpen(true)}>
                    <Icon name="swap" size={15} />{post.type === "want" ? "I can help" : "Make an offer"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="post-tags">
          {post.lives ? <LifecycleChip lives={post.lives} co2={post.co2} /> : null}
          {post.pickupLocation && <PickupBadge location={post.pickupLocation} />}
          {post.tags.filter((t) => t !== "Local pickup").map((t) => (
            <span key={t} className="tagchip"><Icon name="tag" size={12} />{t}</span>
          ))}
        </div>

        <footer className="post-actions">
          <button className={"act like" + (liked ? " liked" : "")} onClick={toggleLike} disabled={liking}>
            <span className="like-ico"><Icon name="heart" size={20} fill={liked ? "x" : "none"} /></span>
            {likeCount > 0 ? likeCount : ""}
          </button>
          <button className={"act comment-toggle" + (commentsOpen ? " on" : "")} onClick={() => setCommentsOpen((v) => !v)}>
            <Icon name="comment" size={20} />{commentCount > 0 ? commentCount : ""}
          </button>
          <div className="share-anchor" ref={shareRef}>
            <button className="act" onClick={() => setShareOpen((v) => !v)}>
              <Icon name="share" size={20} />Share
            </button>
            {shareOpen && (
              <ShareDropdown post={post} onClose={() => setShareOpen(false)} onOpenChat={onOpenChat} />
            )}
          </div>
          <button className={"act save" + (saved ? " on" : "")} onClick={() => setSaved((v) => !v)}>
            <Icon name="bookmark" size={20} fill={saved ? "x" : "none"} />{saved ? "Saved" : "Save"}
          </button>
        </footer>
        <CommentsSection
          postId={post.id}
          initialCount={post.comments}
          open={commentsOpen}
          onCountChange={setCommentCount}
        />
      </article>

      {offerOpen && post.userId && (
        <MakeOfferModal post={post} onClose={() => setOfferOpen(false)} onOpenChat={onOpenChat} />
      )}
    </>
  );
}

function FeedMatchCard() {
  const { matches } = useDash();
  return (
    <section className="card match-strip">
      <div className="match-strip-head">
        <h3><Icon name="bolt" size={15} fill="x" />Traders who want what you have</h3>
        <button className="link-btn">See all</button>
      </div>
      <div className="match-strip-row">
        {matches.map((m) => (
          <div key={m.name} className="match-mini">
            <Avatar name={m.name} size={46} />
            <strong>{m.name}</strong>
            <span className="match-mini-reason">{m.reason}</span>
            <div className="match-mini-foot"><GreenScore score={m.green} /><button className="btn-soft sm">Offer</button></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Feed({ extraPosts, onNewPost, onOpenChat }: {
  extraPosts: Post[]; onNewPost: (p: Post) => void;
  onOpenChat: (name: string, partnerId: string) => void;
}) {
  const { feed, matches } = useDash();
  const allPosts = [...extraPosts, ...feed];
  return (
    <div className="feed">
      <Composer onNewPost={onNewPost} />
      <div className="feed-list">
        {allPosts.length === 0 ? (
          <div className="card feed-empty">
            <Icon name="swap" size={36} />
            <h3>No posts yet</h3>
            <p>Be the first to offer an item or post a want in your area!</p>
          </div>
        ) : allPosts.map((p, idx) => (
          <React.Fragment key={p.id}>
            <FeedCard post={p} onOpenChat={onOpenChat} />
            {idx === 1 && matches.length > 0 && <FeedMatchCard />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}


// ════════ CHROME ════════

interface NavItem { icon: IconName; label: string; href: string }
const NAV: NavItem[] = [
  { icon: "home", label: "Home", href: "/dashboard" },
  { icon: "user", label: "Profile", href: "/dashboard/profile" },
  { icon: "friends", label: "Friends", href: "/dashboard/friends" },
  { icon: "shelf",     label: "My Shelf",  href: "/dashboard/shelf" },
  { icon: "store", label: "Tradeplace", href: "/dashboard/tradeplace" },
  { icon: "swap", label: "My Trades", href: "/dashboard/trades" },
  { icon: "bookmark", label: "Wishlist", href: "/dashboard/wishlist" },
];

function Sidebar() {
  const { me, activeTrades, weeklyTrades, impactData, trendingTags } = useDash();
  return (
    <DashSidebar
      me={{ name: me.name, handle: me.handle, avatar: me.avatar ?? null }}
      showPostCta={false}
      tradeBadge={activeTrades.length}
      weeklyTrades={weeklyTrades}
      weeklyGoal={3}
      weeklyCO2={impactData.weeklyCO2}
      trendingTags={trendingTags}
    />
  );
}


function MobileBar({ onPost }: { onPost: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const items: (NavItem & { big?: boolean })[] = [
    NAV[0], NAV[4], { icon: "plus", label: "Post", big: true, href: "" }, NAV[5], NAV[1],
  ];
  return (
    <nav className="mobilebar">
      {items.map((n) => {
        const big = !!(n as { big?: boolean }).big;
        const on = !big && n.href ? pathname === n.href : false;
        return (
          <button key={n.label}
                  className={"mb-item" + (big ? " big" : "") + (on ? " on" : "")}
                  onClick={() => big ? onPost() : router.push(n.href)}
                  aria-label={n.label}>
            <Icon name={n.icon} size={24} fill={on ? "x" : "none"} />
          </button>
        );
      })}
    </nav>
  );
}


// ════════ RIGHT RAIL ════════

function StatStrip() {
  const { me } = useDash();
  const stats: { k: string; v: string | number; icon: IconName }[] = [
    { k: "Trades", v: me.trades, icon: "swap" },
    { k: "Rating", v: me.rating > 0 ? me.rating.toFixed(1) : "—", icon: "star" },
    { k: "Streak", v: me.streak > 0 ? `${me.streak}d` : "—", icon: "bolt" },
  ];
  return (
    <div className="card statstrip">
      <div className="stat-hero">
        <Avatar name={me.name} size={48} />
        <div>
          <div className="row-name"><strong>{me.name}</strong><GreenScore score={me.greenScore} /></div>
          {me.city && me.city !== "—" && (
            <span className="muted"><Icon name="pin" size={12} />{me.city}</span>
          )}
        </div>
      </div>
      <div className="stat-grid">
        {stats.map((s) => (
          <div key={s.k} className="stat-cell">
            <Icon name={s.icon} size={16} className="stat-ico" />
            <strong>{s.v}</strong>
            <span>{s.k}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Task reward checklist — reward system, not gamification: wording is
// strictly "Leaves" and "tasks", never XP/quests/levels/achievements.
const TASK_UI: Record<TaskKey, { label: string; repeatable: boolean; hint?: string }> = {
  VERIFY_ACCOUNT:   { label: "Verify your account",       repeatable: false, hint: "Link your Google account to verify." },
  COMPLETE_PROFILE: { label: "Complete your profile",     repeatable: false },
  FIRST_LISTING:    { label: "List your first item",      repeatable: false },
  VERIFIED_SWAP:    { label: "Complete a verified swap",  repeatable: true },
  SAFEZONE_MEETUP:  { label: "Confirm a Safe-Zone meetup", repeatable: true },
};

function TasksCard() {
  const { tasks } = useDash();
  // Rank is keyed on lifetimeLeaves so spending never costs a rank.
  const rank = getLeafRank(tasks.lifetimeLeaves);
  return (
    <div className="card railcard leaftasks">
      <div className="railcard-head">
        <h3><Icon name="leaf" size={16} fill="x" />Tasks</h3>
        <span className="leaftasks-total">{tasks.lifetimeLeaves} earned</span>
      </div>
      <p className="leaftasks-rank">
        <strong>{rank.label}</strong>
        {rank.next ? ` — ${rank.next.toNext} Leaves to ${rank.next.label}` : " — top rank"}
      </p>
      <p className="leaftasks-sub">Earn Pasa Leaves by completing tasks.</p>
      <ul className="rail-list leaftasks-list">
        {tasks.tasks.map((t) => {
          const ui = TASK_UI[t.task];
          const showHint = t.task === "VERIFY_ACCOUNT" && !t.done && !tasks.googleVerified;
          return (
            <li key={t.task} className={"leaftask-row" + (t.done ? " done" : "")}>
              <span className="leaftask-check" aria-hidden="true">
                {t.done && <Icon name="check" size={12} />}
              </span>
              <div className="leaftask-body">
                <span className="leaftask-label">
                  {ui.label}
                  {ui.repeatable && t.count > 1 && <em className="leaftask-count">×{t.count}</em>}
                </span>
                {showHint && <span className="leaftask-hint">{ui.hint}</span>}
              </div>
              <span className="leaftask-pts">
                {t.done ? `+${t.leavesEarned}` : `+${TASK_REWARDS[t.task]}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ImpactCard() {
  const { me, impactData } = useDash();
  const C = 2 * Math.PI * 26;
  const score = me.greenScore;
  const tier = me.tier || "Seedling";
  const pct = Math.max(0, Math.min(1, score / 100));
  const { co2Avoided, waterSaved, itemsRehomed, wasteDiverted, treesEquiv, co2Given, co2Received } = impactData;

  const metrics: ImpactMetric[] = [
    { icon: "cloud",   v: co2Avoided.toFixed(1),           u: "kg", k: "CO₂ avoided" },
    { icon: "droplet", v: waterSaved.toLocaleString(),      u: "L",  k: "Water saved" },
    { icon: "cycle",   v: String(itemsRehomed),             u: "",   k: "Items rehomed" },
    { icon: "sprout",  v: wasteDiverted.toFixed(1),         u: "kg", k: "Waste diverted" },
  ];

  const circulationPct = co2Given > 0 ? Math.min(100, Math.round((co2Received / co2Given) * 100)) : 0;

  return (
    <div className="card impactcard">
      <div className="railcard-head">
        <h3><Icon name="leaf" size={16} fill="x" />Your impact</h3>
        <span className="impact-year">{new Date().getFullYear()}</span>
      </div>
      <div className="impact-hero">
        <div className="score-ring">
          <svg viewBox="0 0 60 60">
            <circle className="ring-bg" cx="30" cy="30" r="26" />
            <circle className="ring-fg" cx="30" cy="30" r="26"
                    style={{ strokeDasharray: C, strokeDashoffset: C * (1 - pct) }} />
          </svg>
          <div className="score-num"><strong>{score}</strong><span>Green</span></div>
        </div>
        <div className="impact-hero-meta">
          <span className="tier-badge"><Icon name="leaf" size={12} fill="x" />{tier} tier</span>
          {itemsRehomed > 0
            ? <p>You&apos;ve rehomed {itemsRehomed} item{itemsRehomed !== 1 ? "s" : ""} and kept them out of landfill.</p>
            : <p>Start trading to build your environmental impact record!</p>}
        </div>
      </div>
      <div className="impact-grid">
        {metrics.map((m) => (
          <div key={m.k} className="impact-cell">
            <Icon name={m.icon} size={16} className="impact-ico" />
            <strong>{m.v}{m.u && <i>{m.u}</i>}</strong>
            <span>{m.k}</span>
          </div>
        ))}
      </div>
      <div className="impact-goal">
        <div className="impact-goal-top">
          <span>CO₂ kept in circulation</span>
          <span>{co2Given > 0 ? `${co2Received.toFixed(1)} / ${co2Given.toFixed(1)} kg` : "0 / 0 kg"}</span>
        </div>
        <div className="impact-bar"><span style={{ width: `${circulationPct}%` }} /></div>
        <span className="impact-foot">
          <Icon name="sprout" size={13} />
          ≈ {treesEquiv === 0 ? "< 1" : treesEquiv} tree{treesEquiv !== 1 ? "s" : ""} planted this year
          <em className="impact-estimated"> (estimated)</em>
        </span>
      </div>
    </div>
  );
}

function RailCard({ title, action, actionHref, onAction, children }: { title: string; action?: string; actionHref?: string; onAction?: () => void; children: React.ReactNode }) {
  return (
    <div className="card railcard">
      <div className="railcard-head">
        <h3>{title}</h3>
        {action && (actionHref
          ? <a href={actionHref} className="link-btn">{action}</a>
          : <button className="link-btn" onClick={onAction}>{action}</button>)}
      </div>
      {children}
    </div>
  );
}

function ActiveTrades() {
  const { openConfirmSwap } = useDash();
  const { activeTrades, me } = useDash();
  const router = useRouter();

  if (activeTrades.length === 0) {
    return (
      <RailCard title="Active trades">
        <p className="rail-empty">No active trades yet — make an offer to start!</p>
      </RailCard>
    );
  }
  return (
    <RailCard title="Active trades" action="All" actionHref="/dashboard/trades">
      <ul className="rail-list">
        {activeTrades.map((t) => {
          const canConfirm = t.rawStatus === "ACCEPTED" || t.rawStatus === "CONFIRMING";
          return (
            <li key={t.id} className="trade-row" style={{ alignItems: "flex-start" }}>
              <Avatar name={t.with} size={38} />
              <div className="trade-body">
                <strong>{t.item}</strong>
                <span className={"trade-status " + t.tone}>
                  <i className={"sdot " + (t.tone as TradeTone)} />{t.status}
                </span>
                {canConfirm && (
                  <div style={{ marginTop: 6 }}>
                    <button
                      onClick={() => openConfirmSwap({
                        id: t.id,
                        offeredItemTitle:   t.offeredItemTitle,
                        requestedItemTitle: t.requestedItemTitle,
                        sender:   t.sender,
                        receiver: t.receiver,
                      })}
                      style={{
                        padding: "6px 12px", background: "#3C7143", color: "#fff",
                        border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700,
                        cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      Confirm Swap
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </RailCard>
  );
}

function Matches() {
  const { matches: initialMatches } = useDash();
  const [matches, setMatches] = React.useState<MatchSuggestion[]>(initialMatches);
  const [refreshing, setRefreshing] = React.useState(false);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch("/api/matches");
      if (res.ok) setMatches(await res.json() as MatchSuggestion[]);
    } finally {
      setRefreshing(false);
    }
  };

  if (matches.length === 0) {
    return (
      <RailCard title="Suggested matches" action="Refresh" onAction={refresh}>
        <p className="rail-empty">{refreshing ? "Finding matches…" : "Post your first item to get matched with traders nearby."}</p>
      </RailCard>
    );
  }
  return (
    <RailCard title="Suggested matches" action={refreshing ? "…" : "Refresh"} onAction={refresh}>
      <ul className="rail-list">
        {matches.map((m) => (
          <li key={m.name} className="match-row">
            <Avatar name={m.name} size={38} />
            <div className="trade-body">
              <div className="row-name"><strong>{m.name}</strong><GreenScore score={m.green} /></div>
              <span className="muted small">{m.reason}</span>
              <span className="mutual">{m.mutual}</span>
            </div>
            <button className="btn-soft sm">View</button>
          </li>
        ))}
      </ul>
    </RailCard>
  );
}

function CategoryRail() {
  const { categoryCounts } = useDash();
  return (
    <RailCard title="Explore categories" action="All">
      <div className="cat-grid">
        {CATEGORY_DEFS.map((c) => {
          const count = categoryCounts[c.key] ?? 0;
          const imgUrl = CATEGORY_IMAGES[c.key];
          return (
            <button key={c.name} className="cat-cell cat-cell-img"
                    style={{ backgroundImage: imgUrl ? `url(${imgUrl})` : undefined }}>
              <div className="cat-img-overlay" />
              <div className="cat-img-label">
                <strong>{c.name}</strong>
                <span>{count > 0 ? count.toLocaleString() : "—"}</span>
              </div>
            </button>
          );
        })}
      </div>
    </RailCard>
  );
}

function RightRail() {
  return (
    <aside className="rail">
      <StatStrip />
      <TasksCard />
      <ImpactCard />
      <ActiveTrades />
      <Matches />
      <CategoryRail />
      <p className="rail-foot">Baylo · trade anything, waste nothing</p>
    </aside>
  );
}


// ════════ DASHBOARD ════════

const THEME_KEY = "baylo:theme";

interface BayloDashboardProps {
  user: Me;
  impactData: ImpactData;
  tasks: TasksStatus;
  trendingTags: string[];
  activeTrades: ActiveTrade[];
  messages: Message[];
  notifications: Notif[];
  feedPosts: Post[];
  stories: Story[];
  categoryCounts: Record<string, number>;
  weeklyTrades: number;
  followRequestCount: number;
  followingMap: Record<string, "PENDING" | "ACCEPTED">;
  matches?: MatchSuggestion[];
}

export default function BayloDashboard({
  user, impactData, tasks, trendingTags, activeTrades, messages, notifications,
  feedPosts, stories, categoryCounts, weeklyTrades,
  followRequestCount, followingMap, matches: matchesProp = [],
}: BayloDashboardProps) {
  const router = useRouter();
  const [dark, setDark] = React.useState(false);
  const [liveFollowingMap, setLiveFollowingMap] = React.useState<Record<string, "PENDING" | "ACCEPTED">>(() => ({ ...followingMap }));
  const [extraPosts, setExtraPosts] = React.useState<Post[]>([]);
  const [composerOpen, setComposerOpen] = React.useState(false);
  const [chatWindows, setChatWindows] = React.useState<ChatWindow[]>([]);
  const [liveMsgs, setLiveMsgs] = React.useState<Message[]>(messages);
  const [liveNotifs, setLiveNotifs] = React.useState<Notif[]>(notifications);
  const [extraConfirmable, setExtraConfirmable] = React.useState<Record<string, ConfirmableTrade>>({});
  const [pendingConfirm, setPendingConfirm] = React.useState<ConfirmableTrade | null>(null);
  const openConfirmSwap = React.useCallback((trade: ConfirmableTrade) => setPendingConfirm(trade), []);
  const [completedByPartnerId, setCompletedByPartnerId] = React.useState<Record<string, { tradeId: string; partnerName: string }>>({});
  const [ratingTrade, setRatingTrade] = React.useState<{ tradeId: string; partnerName: string } | null>(null);

  // If the component instance is reused across account switches (client-side nav),
  // force-sync state to the new user's server-fetched data so no prior user's
  // messages bleed into the new session.
  React.useEffect(() => {
    setLiveMsgs(messages);
    setLiveNotifs(notifications);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  React.useEffect(() => {
    try {
      if (localStorage.getItem(THEME_KEY) === "dark") setDark(true);
    } catch { /* storage unavailable */ }
  }, []);

  const toggleTheme = () => {
    setDark((v) => {
      const next = !v;
      try { localStorage.setItem(THEME_KEY, next ? "dark" : "light"); } catch { /* ignore */ }
      return next;
    });
  };

  // ── Pusher real-time subscription ──────────────────────────────────────────
  React.useEffect(() => {
    const myId = user.id;
    if (!myId) return;
    const pusherClient = getPusherClient();
    if (!pusherClient) return;

    const channel = subscribeChannel(`private-user-${myId}`);
    if (!channel) return;

    channel.bind("new-message", (data: ChatMsg & { senderName: string; senderAvatar: string | null }) => {
      window.dispatchEvent(new CustomEvent("baylo:msg", { detail: data }));
      setLiveMsgs((prev) => {
        const partnerId = data.senderId;
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
        const idx = prev.findIndex((m) => m.partnerId === partnerId);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], preview, time: "just now", unread: true };
          return updated;
        }
        return [{ name: data.senderName, preview, time: "just now", unread: true, partnerId }, ...prev];
      });
    });

    channel.bind("offer-updated", (data: { offerId: string; status: string; actorName: string; systemMessage: ChatMsg }) => {
      window.dispatchEvent(new CustomEvent("baylo:offer-updated", { detail: data }));
    });

    channel.bind("typing", (data: { senderId: string; name: string }) => {
      window.dispatchEvent(new CustomEvent("baylo:typing", { detail: data }));
    });

    let everConnected = false;
    pusherClient.connection.bind("state_change", ({ current }: { current: string }) => {
      if (current === "connected") {
        if (everConnected) window.dispatchEvent(new CustomEvent("baylo:reconnected"));
        everConnected = true;
      }
    });

    return () => {
      unsubscribeChannel(`private-user-${myId}`);
    };
  }, [user.id]);

  React.useEffect(() => {
    const onTradeAccepted = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        tradeId: string; offeredItemTitle: string; requestedItemTitle: string;
        senderId: string; senderName: string; receiverId: string; receiverName: string;
      };
      // Make the chat-dock "Confirm swap" button appear immediately (without needing a page refresh).
      const iAmSender = d.senderId === user.id;
      const partnerId = iAmSender ? d.receiverId : d.senderId;
      if (d.tradeId && partnerId) {
        setExtraConfirmable((prev) => ({
          ...prev,
          [partnerId]: {
            id:                 d.tradeId,
            offeredItemTitle:   d.offeredItemTitle,
            requestedItemTitle: d.requestedItemTitle,
            sender:             { id: d.senderId,   name: d.senderName   },
            receiver:           { id: d.receiverId, name: d.receiverName },
          },
        }));
      }
    };
    window.addEventListener("baylo:trade-accepted", onTradeAccepted);
    return () => window.removeEventListener("baylo:trade-accepted", onTradeAccepted);
  }, []);

  const handleNewPost = React.useCallback((p: Post) => {
    setExtraPosts((prev) => [p, ...prev]);
  }, []);

  const openComposer = React.useCallback(() => setComposerOpen(true), []);

  const openChat = React.useCallback((name: string, partnerId: string) => {
    setChatWindows((prev) => {
      const exists = prev.find((w) => w.partnerId === partnerId);
      if (exists) return prev.map((w) => w.partnerId === partnerId ? { ...w, minimized: false } : w);
      return [...prev, { name, partnerId, minimized: false }];
    });
    // Optimistically clear the unread dot for this conversation
    setLiveMsgs((prev) => prev.map((m) => m.partnerId === partnerId ? { ...m, unread: false } : m));
  }, []);

  const closeChat = React.useCallback((partnerId: string) => {
    setChatWindows((prev) => prev.filter((w) => w.partnerId !== partnerId));
  }, []);

  const minimizeChat = React.useCallback((partnerId: string) => {
    setChatWindows((prev) =>
      prev.map((w) => w.partnerId === partnerId ? { ...w, minimized: !w.minimized } : w)
    );
  }, []);

  const setFollowingEntry = React.useCallback((userId: string, status: "PENDING" | "ACCEPTED") => {
    setLiveFollowingMap((prev) => ({ ...prev, [userId]: status }));
  }, []);

  const dashCtx = React.useMemo<DashContextValue>(() => ({
    me: user,
    activeTrades,
    feed: feedPosts,
    stories,
    matches: matchesProp,
    categoryCounts,
    weeklyTrades,
    impactData,
    tasks,
    trendingTags,
    followingMap: liveFollowingMap,
    setFollowingEntry,
    openConfirmSwap,
  }), [user, activeTrades, feedPosts, stories, matchesProp, categoryCounts, weeklyTrades, impactData, tasks, trendingTags, liveFollowingMap, setFollowingEntry, openConfirmSwap]);

  const rootStyle = {
    "--accent": "#3C7143",
    "--accent-ink": "#F4EAEB",
    "--r-lg": "16px",
    "--r-md": "12px",
    "--r-sm": "8px",
  } as React.CSSProperties;

  const myId = user.id ?? "";

  // Build a lookup of confirmable trades (ACCEPTED or CONFIRMING) keyed by partner's user ID.
  // extraConfirmable merges in trades accepted in this session without a page refresh.
  const confirmableByPartnerId = React.useMemo<Record<string, ConfirmableTrade>>(() => {
    const map: Record<string, ConfirmableTrade> = { ...extraConfirmable };
    for (const t of activeTrades) {
      if (t.rawStatus !== "ACCEPTED" && t.rawStatus !== "CONFIRMING") continue;
      const partnerId = t.sender.id === myId ? t.receiver.id : t.sender.id;
      map[partnerId] = {
        id:                 t.id,
        offeredItemTitle:   t.offeredItemTitle,
        requestedItemTitle: t.requestedItemTitle,
        sender:             t.sender,
        receiver:           t.receiver,
      };
    }
    return map;
  }, [activeTrades, myId, extraConfirmable]);

  return (
    <DashContext.Provider value={dashCtx}>
    <div className="baylo layout-classic" data-theme={dark ? "dark" : "light"}
         data-density="regular" style={rootStyle}>
      <TopNav
        me={{ name: user.name, handle: user.handle, avatar: user.avatar ?? null, greenScore: user.greenScore }}
        dark={dark}
        onToggleTheme={toggleTheme}
        onOpenChat={openChat}
        followReqCount={followRequestCount}
        unreadMsgsCount={liveMsgs.filter((m) => m.unread).length}
        unreadNotifsCount={liveNotifs.filter((n) => n.unread).length}
        notifs={liveNotifs}
        messages={liveMsgs}
      />
      <div className="shell">
        <Sidebar />
        <main className="content">
          <div className="content-split">
            <div className="center-col">
              <FeatureStage />
              <Stories />
              <Feed extraPosts={extraPosts} onNewPost={handleNewPost} onOpenChat={openChat} />
            </div>
            <RightRail />
          </div>
        </main>
      </div>
      <MobileBar onPost={openComposer} />
      {composerOpen && (
        <ComposerModal onClose={() => setComposerOpen(false)} onPosted={handleNewPost} />
      )}
      {pendingConfirm && (
        <SwapConfirmModal
          tradeId={pendingConfirm.id}
          offeredItemTitle={pendingConfirm.offeredItemTitle}
          requestedItemTitle={pendingConfirm.requestedItemTitle}
          sender={pendingConfirm.sender}
          receiver={pendingConfirm.receiver}
          myId={myId}
          onClose={() => setPendingConfirm(null)}
          onCompleted={() => {
            const partner = pendingConfirm.sender.id === myId ? pendingConfirm.receiver : pendingConfirm.sender;
            setCompletedByPartnerId(prev => ({ ...prev, [partner.id]: { tradeId: pendingConfirm.id, partnerName: partner.name } }));
            setPendingConfirm(null);
            router.refresh();
          }}
        />
      )}
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
      <ChatDock windows={chatWindows} myId={myId}
                onClose={closeChat} onMinimize={minimizeChat}
                confirmableByPartnerId={confirmableByPartnerId}
                onConfirmSwap={openConfirmSwap}
                completedByPartnerId={completedByPartnerId}
                onRateSwap={(tradeId, partnerName) => setRatingTrade({ tradeId, partnerName })} />
    </div>
    </DashContext.Provider>
  );
}
