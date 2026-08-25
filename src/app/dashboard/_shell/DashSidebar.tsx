"use client";
import React from "react";
import { useRouter, usePathname } from "next/navigation";
import { Icon, Avatar } from "./TopNav";
import type { IconName } from "./TopNav";

const NAV: { icon: IconName; label: string; href: string }[] = [
  { icon: "home",      label: "Home",       href: "/dashboard" },
  { icon: "user",      label: "Profile",    href: "/dashboard/profile" },
  { icon: "friends",   label: "Friends",    href: "/dashboard/friends" },
  { icon: "shelf",     label: "My Shelf",   href: "/dashboard/shelf" },
  { icon: "store",     label: "Tradeplace", href: "/dashboard/tradeplace" },
  { icon: "swap",      label: "My Trades",  href: "/dashboard/trades" },
  { icon: "bookmark",  label: "Wishlist",   href: "/dashboard/wishlist" },
];

export default function DashSidebar({
  me, onPost, showPostCta = false, tradeBadge = 0,
  weeklyTrades, weeklyGoal = 3, weeklyCO2, trendingTags = [],
}: {
  me: { name: string; handle: string; avatar: string | null };
  onPost?: () => void;
  showPostCta?: boolean;
  tradeBadge?: number;
  weeklyTrades?: number;
  weeklyGoal?: number;
  weeklyCO2?: number;
  trendingTags?: string[];
}) {
  const router   = useRouter();
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === "/dashboard" : pathname?.startsWith(href);

  const weeklyDone = weeklyTrades ?? 0;
  const weeklyPct  = Math.min(100, Math.round((weeklyDone / weeklyGoal) * 100));
  // Use real CO₂ if provided; fall back to 0 (never show fake numbers)
  const co2Week    = weeklyCO2 ?? 0;

  return (
    <aside className="sidebar">
      <nav className="nav">
        {NAV.map((n) => {
          const on = isActive(n.href);
          return (
            <button key={n.label} className={"nav-item" + (on ? " on" : "")}
                    onClick={() => router.push(n.href)}>
              <Icon name={n.icon} size={23} fill={on ? "x" : "none"} />
              <span>{n.label}</span>
              {n.label === "My Trades" && tradeBadge > 0 && (
                <span className="nav-badge">{tradeBadge}</span>
              )}
            </button>
          );
        })}
      </nav>
      {showPostCta && onPost && (
        <button className="btn-accent post-cta" onClick={onPost}>
          <Icon name="plus" size={19} />Post a trade
        </button>
      )}
      {weeklyTrades !== undefined && (
        <div className="side-goal">
          <div className="side-goal-head">
            <span><Icon name="bolt" size={14} fill="x" />Weekly goal</span>
            <span className="side-goal-count">{weeklyDone} / {weeklyGoal}</span>
          </div>
          <div className="side-goal-bar"><span style={{ width: weeklyPct + "%" }} /></div>
          <div className="side-goal-meta">
            <span>
              <Icon name="leaf" size={12} fill="x" />
              {co2Week > 0 ? `+${co2Week.toFixed(1)} kg CO₂ this week` : "Complete trades to earn CO₂ savings"}
            </span>
          </div>
          <div className="side-trending">
            <span className="side-trending-label">Trending</span>
            {trendingTags.length === 0 ? (
              <span className="side-trending-empty">No trending activity yet</span>
            ) : (
              <div className="side-trending-chips">
                {trendingTags.map((tag) => (
                  <button key={tag} className="trendchip">{tag}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="sidebar-me">
        <Avatar name={me.name} src={me.avatar} size={40} />
        <div className="sidebar-me-id">
          <strong>{me.name}</strong>
          <span>@{me.handle}</span>
        </div>
        <button className="icon-btn ghost" aria-label="Settings">
          <Icon name="settings" size={19} />
        </button>
      </div>
    </aside>
  );
}
