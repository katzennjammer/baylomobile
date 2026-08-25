"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { disconnectPusherClient } from "@/lib/pusher-client";
import LeavesModal from "@/app/dashboard/leaves/LeavesModal";

// ── Icons ────────────────────────────────────────────────────────────────
const ICONS = {
  search:     "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM16 16l5 5",
  moon:       "M20.5 13.5A8 8 0 0 1 10.5 3.5a8 8 0 1 0 10 10Z",
  sun:        "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2.5v2M12 19.5v2M5 5l1.4 1.4M17.6 17.6 19 19M2.5 12h2M19.5 12h2M5 19l1.4-1.4M17.6 6.4 19 5",
  people:     "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  chat:       "M21 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-5.3A8 8 0 1 1 21 11.5Z",
  bell:       "M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6ZM9.5 20a2.5 2.5 0 0 0 5 0",
  leaf:       "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10ZM2 21c0-3 1.85-5.4 5.1-6",
  user:       "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0",
  grid:       "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  leaves:     "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10ZM2 21c0-3 1.85-5.4 5.1-6M6.5 14.5c2.2-.5 3.6-1.9 4.3-4",
  settings:   "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-1.7-1l-.3-2.5h-4l-.3 2.5a7.6 7.6 0 0 0-1.7 1l-2.3-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7.6 7.6 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5Z",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  x:          "M18 6 6 18M6 6l12 12",
  check:      "M4 12.5 9 17.5 20 6.5",
  swap:       "M7 7h12l-3-3M17 17H5l3 3",
  bolt:       "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
  star:       "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L4.5 9.7l5.9-.9L12 3.5Z",
  pin:        "M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  play:       "M5 3 19 12 5 21Z",
  pause:      "M6 4H10V20H6ZM14 4H18V20H14Z",
  stop:       "M5 5H19V19H5Z",
  send:       "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z",
  image:      "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5ZM3 14l4-4 4 4 3-3 4 4M9 9h.01",
  mic:        "M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3ZM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8",
  clock:      "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  home:       "M3 11.5 12 4l9 7.5M5.5 9.8V20h13V9.8",
  friends:    "M16 21v-1.5a4 4 0 0 0-4-4H6.5a4 4 0 0 0-4 4V21M9.25 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5M21.5 21v-1.5a4 4 0 0 0-3-3.87M15.5 4.24a4 4 0 0 1 0 7.52",
  community:  "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18",
  store:      "M3.5 9 5 4h14l1.5 5M4 9.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5M3.5 9h17M9 20v-5.5h6V20M7.8 9.2a2.3 2.3 0 0 0 4.2 0 2.3 2.3 0 0 0 4 0",
  bookmark:   "M6 4h12v17l-6-4-6 4V4Z",
  shelf:      "M3 6h18v3H3zM5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M9 14h6",
  plus:       "M12 5v14M5 12h14",
} as const;

export type IconName = keyof typeof ICONS;

// ── Shared utilities ──────────────────────────────────────────────────────
const GRADS: [string, string][] = [
  ["#4CAF50", "#1A3520"], ["#FF6BA3", "#7A1F47"], ["#27E0B3", "#0C5B49"],
  ["#FFB23E", "#7A3E0C"], ["#5CA8FF", "#16356B"], ["#FF7A59", "#6B1F16"],
  ["#B86BFF", "#3A1A6B"], ["#3EE0FF", "#0C4A5B"], ["#C7FF3E", "#3E5B0C"],
  ["#FF5C8A", "#6B163A"], ["#8AFF9E", "#0C5B22"], ["#FFD23E", "#7A5B0C"],
];

export function gradOf(seed: string | number): [string, string] {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return GRADS[h % GRADS.length];
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

// ── Exported primitives (also used by ChatDock) ───────────────────────────
export function Icon({
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

export function Avatar({ name, src, size = 40, ring = false, style }: {
  name: string; src?: string | null; size?: number; ring?: boolean; style?: React.CSSProperties;
}) {
  const [imgError, setImgError] = React.useState(false);
  const [a, b] = gradOf(name);
  const shared: React.CSSProperties = {
    width: size, height: size, borderRadius: "50%", flexShrink: 0,
    boxShadow: ring ? `0 0 0 2px var(--bg), 0 0 0 4px ${a}` : "none",
    ...style,
  };
  if (src && !imgError) {
    return (
      <div style={{ ...shared, overflow: "hidden" }}>
        <img src={src} alt={name} onError={() => setImgError(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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

// ── Types (exported for callers) ──────────────────────────────────────────
export interface Notif {
  id: string; who: string; avatar: string | null; icon: string;
  text: string; link: string | null; time: string; unread: boolean;
  actorId: string | null;
}

export interface Message {
  name: string; preview: string; time: string; unread: boolean; partnerId?: string;
}

export interface NavMe {
  name: string; handle: string; avatar: string | null; greenScore: number;
}

// ── Logo ─────────────────────────────────────────────────────────────────
function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <button className="brand"
            style={{ background: "none", border: 0, cursor: onClick ? "pointer" : "default", padding: 0 }}
            onClick={onClick} aria-label="Go to home">
      <img className="brand-img" src="/logo.png" alt="Baylo logo" style={{ height: 36 }} />
      <span className="brand-word">Baylo</span>
    </button>
  );
}

// ── GreenScore ────────────────────────────────────────────────────────────
function GreenScore({ score }: { score: number }) {
  return (
    <span className="green-score" title={`Green Score ${score}/100`}>
      <Icon name="leaf" size={12} fill="x" />{score}
    </span>
  );
}

// ── Dropdown ──────────────────────────────────────────────────────────────
function Dropdown({ title, action, onAction, footer, onFooter, width = 332, children }: {
  title?: string; action?: string | null; onAction?: () => void;
  footer?: string; onFooter?: () => void; width?: number; children: React.ReactNode;
}) {
  return (
    <div className="dropdown" style={{ width }}>
      {title && (
        <div className="dd-head">
          <h3>{title}</h3>
          {action && <button className="link-btn" onClick={onAction}>{action}</button>}
        </div>
      )}
      {children}
      {footer && <div className="dd-foot"><button className="dd-foot-btn" onClick={onFooter}>{footer}</button></div>}
    </div>
  );
}

// ── NotifPanel ────────────────────────────────────────────────────────────
function NotifPanel({
  notifs, read, onReadAll, onReadOne, onClose, onOpenChat,
}: {
  notifs: Notif[]; read: boolean; onReadAll: () => void;
  onReadOne: (id: string) => void; onClose: () => void;
  onOpenChat: (name: string, partnerId: string) => void;
}) {
  const router = useRouter();

  const handleClick = (n: Notif) => {
    if (n.unread) {
      onReadOne(n.id);
      fetch(`/api/notifications/${n.id}`, { method: "PATCH" }).catch(() => {});
    }
    onClose();
    if (n.link?.includes("?partner=") && n.actorId) {
      onOpenChat(n.who, n.actorId);
    } else if (n.link) {
      router.push(n.link);
    }
  };

  return (
    <Dropdown title="Notifications" action={read ? null : "Mark all read"} onAction={onReadAll} footer="See all activity">
      {notifs.length === 0 ? (
        <p className="dd-empty">No notifications yet</p>
      ) : (
        <ul className="dd-list">
          {notifs.map((n) => (
            <li
              key={n.id}
              className={"dd-row" + (n.unread && !read ? " unread" : "") + " clickable"}
              onClick={() => handleClick(n)}
              style={{ cursor: "pointer" }}
            >
              <span className="dd-av">
                <Avatar name={n.who} src={n.avatar} size={40} />
                <span className="dd-chip">
                  <Icon name={(n.icon in ICONS ? n.icon : "bell") as IconName} size={11} />
                </span>
              </span>
              <span className="dd-body">
                <span className="dd-text"><strong>{n.who}</strong> {n.text}</span>
                <span className="dd-time">{n.time} ago</span>
              </span>
              {n.unread && !read && <i className="dd-dot" />}
            </li>
          ))}
        </ul>
      )}
    </Dropdown>
  );
}

// ── FollowRequestsPanel ───────────────────────────────────────────────────
interface FollowRequest {
  id: string;
  follower: { id: string; name: string; avatar: string | null; location: string | null };
}

function FollowRequestsPanel({ onResolved }: { onResolved: () => void }) {
  const [requests, setRequests] = React.useState<FollowRequest[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [acting, setActing] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/follows")
      .then((r) => r.json())
      .then((data: unknown) => setRequests(Array.isArray(data) ? (data as FollowRequest[]) : []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, []);

  const act = async (id: string, action: "accept" | "decline") => {
    setActing(id);
    try {
      await fetch(`/api/follows/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setRequests((prev) => prev.filter((r) => r.id !== id));
      onResolved();
    } finally {
      setActing(null);
    }
  };

  return (
    <Dropdown title="Follow requests" width={320}>
      {loading ? (
        <p className="dd-empty">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="dd-empty">No follow requests</p>
      ) : (
        <ul className="dd-list">
          {requests.map((r) => (
            <li key={r.id} className="dd-row" style={{ alignItems: "center" }}>
              <span className="dd-av"><Avatar name={r.follower.name} size={40} /></span>
              <span className="dd-body">
                <span className="dd-text"><strong>{r.follower.name}</strong></span>
                <span className="dd-time">
                  @{r.follower.name.toLowerCase().replace(/\s+/g, "").slice(0, 20)}
                  {r.follower.location ? ` · ${r.follower.location}` : ""}
                </span>
              </span>
              <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button className="btn-accent sm" disabled={acting === r.id}
                        onClick={() => act(r.id, "accept")}>Accept</button>
                <button className="btn-soft sm" disabled={acting === r.id}
                        onClick={() => act(r.id, "decline")}>Decline</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dropdown>
  );
}

// ── MsgPanel ──────────────────────────────────────────────────────────────
function MsgPanel({ messages, onOpenChat, onOpenInbox }: {
  messages: Message[];
  onOpenChat: (name: string, partnerId: string) => void;
  onOpenInbox: () => void;
}) {
  return (
    <Dropdown title="Messages" action="New" footer="Open inbox" onFooter={onOpenInbox}>
      {messages.length === 0 ? (
        <p className="dd-empty">No messages yet</p>
      ) : (
        <ul className="dd-list">
          {messages.map((m) => (
            <li key={m.name} className={"dd-row" + (m.unread ? " unread" : "")}
                style={{ cursor: "pointer" }}
                onClick={() => m.partnerId && onOpenChat(m.name, m.partnerId)}>
              <span className="dd-av">
                <Avatar name={m.name} size={40} />
                {m.unread && <span className="dd-chip live" />}
              </span>
              <span className="dd-body">
                <span className="dd-toprow"><strong>{m.name}</strong><span className="dd-time">{m.time}</span></span>
                <span className="dd-preview">{m.preview}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dropdown>
  );
}

// ── ProfileMenu ───────────────────────────────────────────────────────────
function ProfileMenu({ me, onClose, onOpenLeaves }: { me: NavMe; onClose: () => void; onOpenLeaves: () => void }) {
  const router = useRouter();
  const items: { icon: IconName; label: string; href?: string; action?: () => void }[] = [
    { icon: "user",     label: "View profile",  href: "/dashboard/profile"  },
    { icon: "leaves",   label: "My Leaves",      action: () => { onClose(); onOpenLeaves(); } },
    { icon: "leaf",     label: "Impact report", href: "/dashboard/impact"   },
    { icon: "settings", label: "Settings",      href: "/dashboard/settings" },
  ];
  const navigate = (href: string) => { onClose(); router.push(href); };
  const handleLogout = async () => {
    onClose();
    disconnectPusherClient();
    await signOut({ callbackUrl: "/auth/login" });
  };
  return (
    <Dropdown width={252}>
      <button className="dd-profile"
              style={{ all: "unset", display: "flex", alignItems: "center", gap: 11, padding: "14px 14px 11px", borderBottom: "1px solid var(--border)", cursor: "pointer", width: "100%", boxSizing: "border-box" }}
              onClick={() => navigate("/dashboard/profile")}>
        <Avatar name={me.name} src={me.avatar} size={44} />
        <div className="dd-profile-id">
          <strong>{me.name}</strong>
          <span>@{me.handle}</span>
        </div>
        <GreenScore score={me.greenScore} />
      </button>
      <div className="dd-menu">
        {items.map((it) => (
          <button key={it.label} className="dd-item" onClick={it.action ?? (() => navigate(it.href!))}>
            <Icon name={it.icon} size={18} />{it.label}
          </button>
        ))}
        <div className="dd-sep" />
        <button className="dd-item danger" onClick={handleLogout}>
          <Icon name="arrowRight" size={18} />Log out
        </button>
      </div>
    </Dropdown>
  );
}

// ── TopNav (default export) ───────────────────────────────────────────────
export default function TopNav({
  me, dark, onToggleTheme, onOpenChat,
  followReqCount: initialFollowReqCount,
  unreadMsgsCount, unreadNotifsCount,
  notifs, messages,
}: {
  me: NavMe;
  dark: boolean;
  onToggleTheme: () => void;
  onOpenChat: (name: string, partnerId: string) => void;
  followReqCount: number;
  unreadMsgsCount: number;
  unreadNotifsCount: number;
  notifs: Notif[];
  messages: Message[];
}) {
  const router = useRouter();
  const [menu, setMenu] = React.useState<"bell" | "chat" | "people" | "me" | null>(null);
  const [notifsRead, setNotifsRead] = React.useState(false);
  const [followReqCount, setFollowReqCount] = React.useState(initialFollowReqCount);
  const [localNotifs, setLocalNotifs] = React.useState<Notif[]>(notifs);

  // ── Leaves state ──────────────────────────────────────────────────────────
  const [leavesOpen, setLeavesOpen] = React.useState(false);
  const [leafTotal, setLeafTotal] = React.useState<number | null>(null);

  React.useEffect(() => {
    fetch("/api/leaves")
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { total?: number };
        setLeafTotal(data.total ?? 0);
      })
      .catch(() => setLeafTotal(0));
  }, []);

  React.useEffect(() => {
    const handler = () => setLeavesOpen(true);
    window.addEventListener("baylo:openLeaves", handler);
    return () => window.removeEventListener("baylo:openLeaves", handler);
  }, []);

  React.useEffect(() => { setLocalNotifs(notifs); }, [notifs]);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const h = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, []);

  const toggle = (m: "bell" | "chat" | "people" | "me") => setMenu((v) => (v === m ? null : m));
  const [localUnread, setLocalUnread] = React.useState(unreadNotifsCount);
  React.useEffect(() => { setLocalUnread(unreadNotifsCount); }, [unreadNotifsCount]);
  const unreadNotifs = notifsRead ? 0 : localUnread;

  const handleReadOne = (id: string) => {
    setLocalNotifs((prev) => prev.map((n) => n.id === id ? { ...n, unread: false } : n));
    setLocalUnread((c) => Math.max(0, c - 1));
  };

  return (
    <>
    <header className="topnav">
      <div className="topnav-zone left">
        <Logo onClick={() => router.push("/dashboard")} />
      </div>
      <div className="topnav-search center">
        <Icon name="search" size={19} />
        <input placeholder="Search items, wants, traders…" />
      </div>
      <div className="topnav-zone right" ref={wrapRef}>
        <button className="topnav-icon"
                aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
                onClick={onToggleTheme}>
          <Icon name={dark ? "sun" : "moon"} size={20} />
        </button>
        <div className="menu-anchor">
          <button className={"topnav-icon" + (menu === "people" ? " on" : "")}
                  aria-label="Follow requests" aria-expanded={menu === "people"}
                  onClick={() => toggle("people")}>
            <Icon name="people" size={21} />
            {followReqCount > 0 && (
              <span className="nav-badge dot">{followReqCount > 9 ? "9+" : followReqCount}</span>
            )}
          </button>
          {menu === "people" && (
            <FollowRequestsPanel onResolved={() => setFollowReqCount((c) => Math.max(0, c - 1))} />
          )}
        </div>
        <div className="menu-anchor">
          <button className={"topnav-icon" + (menu === "chat" ? " on" : "")}
                  aria-label="Messages" aria-expanded={menu === "chat"}
                  onClick={() => toggle("chat")}>
            <Icon name="chat" size={21} />
            {unreadMsgsCount > 0 && (
              <span className="nav-badge dot">{unreadMsgsCount > 9 ? "9+" : unreadMsgsCount}</span>
            )}
          </button>
          {menu === "chat" && (
            <MsgPanel
              messages={messages}
              onOpenChat={(name, id) => { onOpenChat(name, id); setMenu(null); }}
              onOpenInbox={() => { setMenu(null); router.push("/dashboard/messages"); }}
            />
          )}
        </div>
        <div className="menu-anchor">
          <button className={"topnav-icon" + (menu === "bell" ? " on" : "")}
                  aria-label="Notifications" aria-expanded={menu === "bell"}
                  onClick={() => toggle("bell")}>
            <Icon name="bell" size={21} />
            {unreadNotifs > 0 && (
              <span className="nav-badge dot">{unreadNotifs > 9 ? "9+" : unreadNotifs}</span>
            )}
          </button>
          {menu === "bell" && (
            <NotifPanel
              notifs={localNotifs}
              read={notifsRead}
              onReadAll={() => {
                setNotifsRead(true);
                setLocalUnread(0);
                setLocalNotifs((prev) => prev.map((n) => ({ ...n, unread: false })));
                fetch("/api/notifications", { method: "PATCH" }).catch(() => {});
              }}
              onReadOne={handleReadOne}
              onClose={() => setMenu(null)}
              onOpenChat={(name, id) => { onOpenChat(name, id); setMenu(null); }}
            />
          )}
        </div>

        {/* ── Leaves pill — left of avatar ─────────────────────────────── */}
        <button
          className="leaves-pill"
          aria-label="Open my Leaves"
          onClick={() => { setMenu(null); setLeavesOpen(true); }}
        >
          <Icon name="leaves" size={15} />
          <span>
            {leafTotal === null
              ? "—"
              : `${leafTotal.toLocaleString("en-US")} Leaves`}
          </span>
        </button>

        <div className="menu-anchor">
          <button className={"topnav-profile" + (menu === "me" ? " on" : "")}
                  aria-label="Profile menu" aria-expanded={menu === "me"}
                  onClick={() => toggle("me")}>
            <Avatar name={me.name} src={me.avatar} size={36} />
          </button>
          {menu === "me" && (
            <ProfileMenu
              me={me}
              onClose={() => setMenu(null)}
              onOpenLeaves={() => setLeavesOpen(true)}
            />
          )}
        </div>
      </div>
    </header>

    {/* ── Leaves modal (rendered outside header flow, fixed overlay) ────── */}
    {leavesOpen && (
      <LeavesModal
        onClose={() => {
          setLeavesOpen(false);
          // Refresh the pill total after the modal closes
          fetch("/api/leaves")
            .then((r) => r.json())
            .then((d: unknown) => {
              const data = d as { total?: number };
              setLeafTotal(data.total ?? 0);
            })
            .catch(() => {});
        }}
      />
    )}
    </>
  );
}
