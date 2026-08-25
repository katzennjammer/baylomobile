"use client";

import React from "react";
import { useRouter, usePathname } from "next/navigation";

const NAV = [
  { icon: "home", label: "Home", href: "/dashboard" },
  { icon: "user", label: "Profile", href: "/dashboard/profile" },
  { icon: "friends", label: "Friends", href: "/dashboard/friends" },
  { icon: "shelf",     label: "My Shelf",  href: "/dashboard/shelf" },
  { icon: "store", label: "Tradeplace", href: "/dashboard/tradeplace" },
  { icon: "swap", label: "My Trades", href: "/dashboard/trades" },
  { icon: "bookmark", label: "Wishlist", href: "/dashboard/wishlist" },
];

const ICONS: Record<string, string> = {
  home: "M3 11.5 12 4l9 7.5M5.5 9.8V20h13V9.8",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0",
  friends: "M16 21v-1.5a4 4 0 0 0-4-4H6.5a4 4 0 0 0-4 4V21M9.25 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5M21.5 21v-1.5a4 4 0 0 0-3-3.87M15.5 4.24a4 4 0 0 1 0 7.52",
  shelf:     "M3 6h18v3H3zM5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M9 14h6",
  store: "M3.5 9 5 4h14l1.5 5M4 9.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5M3.5 9h17M9 20v-5.5h6V20M7.8 9.2a2.3 2.3 0 0 0 4.2 0 2.3 2.3 0 0 0 4 0",
  swap: "M7 7h12l-3-3M17 17H5l3 3",
  bookmark: "M6 4h12v17l-6-4-6 4V4Z",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
};

export default function DashShell({
  title, description, children,
}: {
  title: string; description?: string; children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div style={{
      display: "flex", minHeight: "100vh", fontFamily: "'Plus Jakarta Sans', sans-serif",
      background: "var(--bg, #EAF0E2)", color: "var(--text, #1E3020)",
      "--accent": "#4CAF50", "--r-md": "12px",
    } as React.CSSProperties}>
      {/* Sidebar */}
      <aside style={{
        width: 220, flexShrink: 0, borderRight: "1px solid rgba(0,0,0,.08)",
        background: "#F4EDD8", display: "flex", flexDirection: "column",
        padding: "16px 12px", gap: 4,
        position: "sticky", top: 0, height: "100vh", overflowY: "auto",
      }}>
        <button
          onClick={() => router.push("/dashboard")}
          style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 20,
            background: "none", border: 0, cursor: "pointer", padding: "4px 8px",
          }}>
          <img src="/logo.png" alt="Baylo" style={{ height: 28 }} />
          <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: "-.03em" }}>Baylo</span>
        </button>
        {NAV.map((n) => {
          const on = n.href === "/dashboard" ? pathname === "/dashboard" : pathname?.startsWith(n.href);
          return (
            <button key={n.label} onClick={() => router.push(n.href)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 12px", border: 0, borderRadius: 10,
                background: on ? "rgba(76,175,80,.12)" : "transparent",
                color: on ? "#4CAF50" : "#555", fontWeight: 600, fontSize: 14,
                cursor: "pointer", textAlign: "left", transition: "background .12s, color .12s",
              }}>
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d={ICONS[n.icon]} />
              </svg>
              {n.label}
            </button>
          );
        })}
      </aside>

      {/* Main */}
      <main style={{ flex: 1, padding: "40px 48px", maxWidth: 800 }}>
        <button
          onClick={() => router.back()}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 24,
            background: "none", border: 0, cursor: "pointer",
            color: "#888", fontSize: 14, fontWeight: 600,
          }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d={ICONS.arrowLeft} />
          </svg>
          Back
        </button>

        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, letterSpacing: "-.03em" }}>{title}</h1>
        {description && (
          <p style={{ fontSize: 15, color: "#888", marginBottom: 32 }}>{description}</p>
        )}
        {children ?? (
          <div style={{
            border: "2px dashed rgba(0,0,0,.1)", borderRadius: 16,
            padding: "64px 32px", textAlign: "center", color: "#aaa",
          }}>
            <svg width={40} height={40} viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
                 style={{ marginBottom: 12, opacity: .5 }}>
              <path d={ICONS[NAV.find((n) => n.href === pathname)?.icon ?? "home"]} />
            </svg>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: "#888" }}>Coming soon</p>
            <p style={{ fontSize: 13, color: "#bbb" }}>This page is under construction.</p>
          </div>
        )}
      </main>
    </div>
  );
}
