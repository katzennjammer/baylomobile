"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import AuthModal from "./AuthModal"

/* ── Menu model ─────────────────────────────────────────────── */
type PanelItem = { label: string; desc: string; href: string }
type NavEntry = { label: string; href: string; panel?: { blurb: string; items: PanelItem[] }; gated?: boolean }

const NAV_MENU: NavEntry[] = [
  {
    label: "Browse",
    href: "/#categories",
    gated: true,
    panel: {
      blurb: "Six living categories of goods circulating across Urban Cebu.",
      items: [
        { label: "Apparel & Thrift", desc: "Pre-loved fashion", href: "/listings?category=CLOTHING" },
        { label: "Books & Media", desc: "Reads & records", href: "/listings?category=BOOKS" },
        { label: "Tech & Gadgets", desc: "Phones, parts, more", href: "/listings?category=ELECTRONICS" },
        { label: "Home & Living", desc: "Furniture & decor", href: "/listings?category=FURNITURE" },
      ],
    },
  },
  { label: "How it works", href: "/#how" },
  {
    label: "About Us",
    href: "/#contact",
    panel: {
      blurb: "Building a local circular economy, one trade at a time.",
      items: [
        { label: "Our story", desc: "Why we built Baylo", href: "/#how" },
        { label: "Trust & safety", desc: "How trades stay fair", href: "/trust" },
        { label: "In action", desc: "Real community swaps", href: "/#gallery" },
        { label: "Contact", desc: "Get in touch", href: "/#contact" },
      ],
    },
  },
]

/* ── Icons ──────────────────────────────────────────────────── */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
      style={{ transition: "transform .25s", transform: open ? "rotate(180deg)" : "none", opacity: 0.8 }}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ── Navbar ──────────────────────────────────────────────────── */
export default function Navbar({ variant }: { variant?: "login" | "register" } = {}) {
  const { status } = useSession()
  const loggedIn = status === "authenticated"

  const [scrolled, setScrolled] = useState(false)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [mobile, setMobile] = useState(false)
  const [authModal, setAuthModal] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = (mobile || authModal) ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [mobile, authModal])

  return (
    <>
      <header style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
        borderBottom: `1px solid ${scrolled ? "var(--line)" : "transparent"}`,
        background: scrolled ? "var(--bg)" : "transparent",
        backdropFilter: scrolled ? "blur(18px) saturate(1.25)" : "none",
        transition: "background .3s, border-color .3s, backdrop-filter .3s",
      }}>
        <div style={{
          maxWidth: 1680, margin: "0 auto",
          padding: "0 clamp(20px, 4.5vw, 88px)",
          height: 68, display: "flex", alignItems: "center", gap: "clamp(18px,2.4vw,44px)",
          position: "relative",
        }}>
          {/* brand */}
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 11, marginRight: 6 }} onClick={() => setMobile(false)}>
            <img src="/logo.png" alt="Baylo" style={{ height: 54, width: "auto", display: "block", opacity: 0.85 }} />
            <span style={{ fontFamily: "var(--ff)", fontWeight: 800, fontStretch: "120%", fontSize: 23, letterSpacing: "0.01em", color: "var(--text)" }}>
              BAYLO
            </span>
          </Link>

          {/* desktop links */}
          <nav className="baylo-navlinks" style={{ display: "flex", alignItems: "center", gap: "clamp(4px,0.9vw,14px)", position: "absolute", left: "50%", transform: "translateX(-50%)" }}>
            {NAV_MENU.map((m) => {
              const open = openKey === m.label
              const isGated = m.gated && !loggedIn
              return (
                <div
                  key={m.label}
                  style={{ position: "relative" }}
                  onMouseEnter={() => setOpenKey(m.panel ? m.label : null)}
                  onMouseLeave={() => setOpenKey(null)}
                >
                  <Link href={m.href} style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontFamily: "var(--ff)", fontWeight: 600, fontStretch: "106%",
                    fontSize: 15, color: open ? "var(--text)" : "var(--muted)",
                    padding: "9px 12px", borderRadius: 10, whiteSpace: "nowrap",
                    background: open ? "var(--card)" : "transparent",
                    transition: "color .2s, background .2s",
                  }}>
                    {m.label}{m.panel && <Chevron open={open} />}
                  </Link>

                  {m.panel && (
                    <div style={{
                      position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 60, minWidth: 360,
                      opacity: open ? 1 : 0, visibility: open ? "visible" : "hidden",
                      transform: open ? "none" : "translateY(8px)",
                      transition: "opacity .22s, transform .22s, visibility .22s",
                      pointerEvents: open ? "auto" : "none",
                    }}>
                      <div style={{ position: "absolute", top: -10, left: 0, right: 0, height: 12 }} />
                      <div style={{
                        background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16,
                        padding: 16, boxShadow: "0 30px 70px -30px rgba(0,0,0,0.6)",
                      }}>
                        <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.4, padding: "4px 8px 12px", maxWidth: "40ch" }}>
                          {m.panel.blurb}
                        </p>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                          {m.panel.items.map((it) =>
                            isGated ? (
                              <button
                                key={it.label}
                                onClick={() => { setOpenKey(null); setAuthModal(true) }}
                                className="baylo-panel-link"
                                style={{ display: "flex", flexDirection: "column", gap: 3, padding: "11px 12px", borderRadius: 11, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
                              >
                                <span style={{ fontFamily: "var(--ff)", fontWeight: 700, fontStretch: "106%", fontSize: 14.5, color: "var(--text)" }}>{it.label}</span>
                                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{it.desc}</span>
                              </button>
                            ) : (
                              <Link key={it.label} href={it.href} className="baylo-panel-link" style={{ display: "flex", flexDirection: "column", gap: 3, padding: "11px 12px", borderRadius: 11 }}>
                                <span style={{ fontFamily: "var(--ff)", fontWeight: 700, fontStretch: "106%", fontSize: 14.5, color: "var(--text)" }}>{it.label}</span>
                                <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{it.desc}</span>
                              </Link>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </nav>

          {/* right actions — public site is logged-out only; dashboard has its own nav */}
          <div style={{ display: "flex", alignItems: "center", gap: "clamp(8px,1vw,16px)", marginLeft: "auto" }}>
            {variant === "login" ? null : variant === "register" ? (
              <>
                <span style={{ fontFamily: "var(--ff)", fontSize: 14, color: "var(--muted)", whiteSpace: "nowrap" }}>
                  Already have an account?
                </span>
                <Link href="/auth/login" className="baylo-login" style={{
                  fontFamily: "var(--ff)", fontWeight: 600, fontStretch: "106%",
                  fontSize: 15, color: "var(--text)", whiteSpace: "nowrap",
                }}>Log in</Link>
              </>
            ) : (
              <>
                <Link href="/auth/login" className="baylo-login" style={{
                  fontFamily: "var(--ff)", fontWeight: 600, fontStretch: "106%",
                  fontSize: 15, color: "var(--text)", whiteSpace: "nowrap",
                }}>Log in</Link>
                <Link href="/auth/register" style={{
                  fontFamily: "var(--ff)", fontWeight: 700, fontStretch: "108%",
                  fontSize: 15, whiteSpace: "nowrap",
                  background: "var(--accent)", color: "var(--on-accent)",
                  padding: "10px 20px", borderRadius: 11, transition: "filter .2s, transform .2s",
                }}>Sign up</Link>
              </>
            )}

            {/* burger */}
            <button
              type="button"
              className="baylo-burger"
              aria-label={mobile ? "Close menu" : "Open menu"}
              aria-expanded={mobile}
              onClick={() => setMobile((v) => !v)}
              style={{
                display: "none", width: 42, height: 42, borderRadius: 10,
                alignItems: "center", justifyContent: "center",
                background: "var(--card)", border: "1px solid var(--line)", color: "var(--text)", cursor: "pointer",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {mobile ? <path d="M6 6l12 12M18 6 6 18" /> : <><path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" /></>}
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* mobile drawer */}
      {mobile && (
        <div onClick={() => setMobile(false)} style={{
          position: "fixed", top: 68, left: 0, right: 0, zIndex: 49,
          display: "flex", flexDirection: "column", gap: 4,
          padding: "14px clamp(20px,4vw,44px) 22px",
          background: "var(--bg)", borderBottom: "1px solid var(--line)",
        }}>
          {NAV_MENU.map((m) => {
            const isGated = m.gated && !loggedIn
            return isGated ? (
              <button
                key={m.label}
                onClick={() => { setMobile(false); setAuthModal(true) }}
                style={{ fontFamily: "var(--ff)", fontWeight: 600, fontSize: 17, color: "var(--text)", padding: "12px 4px", borderBottom: "1px solid var(--line)", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
              >
                {m.label}
              </button>
            ) : (
              <Link key={m.label} href={m.href} style={{ fontFamily: "var(--ff)", fontWeight: 600, fontSize: 17, color: "var(--text)", padding: "12px 4px", borderBottom: "1px solid var(--line)" }}>{m.label}</Link>
            )
          })}
          {variant !== "login" && (
            <Link href="/auth/login" style={{ fontFamily: "var(--ff)", fontWeight: 600, fontSize: 17, color: "var(--text)", padding: "12px 4px", borderBottom: "1px solid var(--line)" }}>Log in</Link>
          )}
          {!variant && (
            <Link href="/auth/register" style={{ fontFamily: "var(--ff)", fontWeight: 700, fontSize: 16, textAlign: "center", marginTop: 10, background: "var(--accent)", color: "var(--on-accent)", padding: "13px", borderRadius: 11 }}>Sign up</Link>
          )}
        </div>
      )}

      {/* auth gate modal */}
      {authModal && <AuthModal onClose={() => setAuthModal(false)} />}

      <style>{`
        .baylo-panel-link:hover { background: var(--bg) !important; }
        .baylo-login:hover { color: var(--accent); }
        @media (max-width: 880px) {
          .baylo-navlinks, .baylo-login { display: none !important; }
          .baylo-burger { display: inline-flex !important; }
        }
      `}</style>
    </>
  )
}
