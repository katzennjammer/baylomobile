import type { ReactNode } from "react"
import Link from "next/link"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Trust & Safety — Baylo",
  description: "How Baylo keeps every trade safe, fair, and community-driven across Urban Cebu.",
}

const PRINCIPLES = [
  {
    num: "01",
    title: "Verified identities",
    body: "Every account is tied to a real email address. Members can further boost their trust score by verifying a phone number or linking a social account — making it harder for bad actors to operate anonymously.",
  },
  {
    num: "02",
    title: "Reputation that compounds",
    body: "After each completed trade, both parties leave a review. Your rating is public, cumulative, and permanent — honest behaviour is rewarded, and a pattern of poor conduct is visible to the whole community.",
  },
  {
    num: "03",
    title: "Points, not cash",
    body: "Baylo's virtual-point system removes the financial risk of traditional peer-to-peer marketplaces. You cannot lose money on a bad trade — only points, which the platform can review and restore when misconduct is proven.",
  },
  {
    num: "04",
    title: "Dispute resolution",
    body: "Raise a dispute within 48 hours of a completed trade. Our moderation team reviews the evidence, contacts both parties, and issues a decision within three business days. Repeat offenders are suspended.",
  },
  {
    num: "05",
    title: "Transparent moderation",
    body: "Item listings are screened against our Prohibited Items policy before going live. We act on reports within 24 hours and keep a public count of items removed each month so the community can hold us accountable.",
  },
  {
    num: "06",
    title: "Your data, your rules",
    body: "We never sell your personal information. Location data is only ever used to match you with nearby traders. You can export or delete your account at any time from your settings.",
  },
]

const ALLOWED = [
  "Pre-loved clothing, shoes, and accessories",
  "Books, media, and educational materials",
  "Consumer electronics in working condition",
  "Furniture and home décor",
  "Toys, games, and baby items",
  "Sports equipment and outdoor gear",
  "Handmade and artisan goods",
  "Services (tutoring, repairs, creative work)",
]

const PROHIBITED = [
  "Firearms, ammunition, and weapons of any kind",
  "Controlled substances, pharmaceuticals without prescription",
  "Counterfeit or intellectual-property-infringing goods",
  "Stolen property or items without proof of ownership",
  "Adult or explicit material",
  "Live animals",
  "Hazardous chemicals or materials",
  "Personal data, accounts, or digital credentials",
]

const TIPS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21s-7-6.5-7-12a7 7 0 1 1 14 0c0 5.5-7 12-7 12Z" />
        <circle cx="12" cy="9" r="2.5" />
      </svg>
    ),
    title: "Meet in public",
    body: "Choose busy, well-lit places — malls, coffee shops, barangay halls. Avoid private homes for first-time trades.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
    title: "Inspect before accepting",
    body: "Check the item thoroughly in person. Once you mark a trade complete, it's considered accepted.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="3" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    title: "Keep conversation on-platform",
    body: "Use Baylo's built-in chat. We can't help resolve disputes for deals arranged entirely off-platform.",
  },
  {
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" y1="22" x2="4" y2="15" />
      </svg>
    ),
    title: "Report red flags",
    body: "Pressure to decide quickly, requests for cash top-ups, or suspiciously new accounts are all warning signs. Report immediately.",
  },
]

function Section({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <section id={id} style={{
      borderTop: "1px solid var(--line)",
      padding: "clamp(52px,6vw,96px) 0",
    }}>
      {children}
    </section>
  )
}

export default function TrustPage() {
  return (
    <main style={{ paddingTop: 68, background: "var(--bg)" }}>

      {/* ── Hero ── */}
      <section style={{
        padding: "clamp(64px,8vw,128px) 0 clamp(52px,6vw,88px)",
        borderBottom: "1px solid var(--line)",
      }}>
        <div className="wrap">
          <p className="kicker" style={{ marginBottom: 20 }}>Trust &amp; Safety</p>
          <h1 className="display" style={{
            fontSize: "clamp(44px,7vw,112px)",
            maxWidth: "14ch", marginBottom: "clamp(24px,3vw,40px)",
            color: "var(--text)",
          }}>
            Trade with<br /><span style={{ color: "var(--accent)" }}>confidence.</span>
          </h1>
          <p style={{
            fontSize: "clamp(16px,1.4vw,22px)", color: "var(--muted)",
            maxWidth: "52ch", lineHeight: 1.6, marginBottom: "clamp(28px,3vw,44px)",
          }}>
            Baylo is built on the belief that people are fundamentally fair. Our safety
            systems don't assume the worst — they make honesty the easiest path, and
            protect everyone when it isn't.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="#principles" className="btn solid">
              How we protect you
              <span className="arrow">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h13M13 6l6 6-6 6" />
                </svg>
              </span>
            </Link>
            <Link href="#report" className="btn">
              Report an issue
              <span className="arrow">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h13M13 6l6 6-6 6" />
                </svg>
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── 6 Principles ── */}
      <Section id="principles">
        <div className="wrap">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "clamp(32px,4vw,64px)", alignItems: "start", marginBottom: "clamp(40px,5vw,72px)" }}>
            <div>
              <p className="kicker" style={{ marginBottom: 16 }}>Our commitments</p>
              <h2 className="display" style={{ fontSize: "clamp(32px,3.5vw,56px)", color: "var(--text)" }}>
                Six pillars<br />of safe trading
              </h2>
            </div>
            <p style={{ fontSize: "clamp(15px,1.2vw,19px)", color: "var(--muted)", lineHeight: 1.65, maxWidth: "56ch", marginTop: "auto" }}>
              Every feature, every policy, and every moderation decision maps back to one of
              these principles. They are not aspirational — they are operational.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%,340px),1fr))", gap: 2 }}>
            {PRINCIPLES.map((p) => (
              <div key={p.num} style={{
                background: "var(--card)", border: "1px solid var(--line)",
                borderRadius: 18, padding: "clamp(24px,2.5vw,36px)",
                display: "flex", flexDirection: "column", gap: 14,
              }}>
                <span style={{
                  fontFamily: "var(--ff)", fontWeight: 700, fontStretch: "108%",
                  fontSize: 13, letterSpacing: "0.12em", textTransform: "uppercase",
                  color: "var(--accent)",
                }}>{p.num}</span>
                <h3 style={{
                  fontFamily: "var(--ff)", fontWeight: 800, fontStretch: "118%",
                  fontSize: "clamp(18px,1.6vw,24px)", color: "var(--text)", lineHeight: 1.15,
                }}>{p.title}</h3>
                <p style={{ fontSize: 15, color: "var(--muted)", lineHeight: 1.65 }}>{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Allowed / Prohibited ── */}
      <Section id="policy">
        <div className="wrap">
          <p className="kicker" style={{ marginBottom: 16 }}>Item policy</p>
          <h2 className="display" style={{ fontSize: "clamp(32px,3.5vw,56px)", color: "var(--text)", marginBottom: "clamp(36px,4vw,60px)" }}>
            What you can<br />trade on Baylo
          </h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            {/* Allowed */}
            <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: "18px 0 0 18px", padding: "clamp(24px,2.5vw,40px)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
                <span style={{
                  width: 32, height: 32, borderRadius: 8, background: "var(--accent)",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                <h3 style={{ fontFamily: "var(--ff)", fontWeight: 800, fontStretch: "115%", fontSize: 17, color: "var(--text)" }}>Allowed</h3>
              </div>
              <ul style={{ display: "flex", flexDirection: "column", gap: 12, listStyle: "none" }}>
                {ALLOWED.map((item) => (
                  <li key={item} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 15, color: "var(--muted)", lineHeight: 1.5 }}>
                    <span style={{ color: "var(--accent)", marginTop: 2, flexShrink: 0 }}>—</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Prohibited */}
            <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderLeft: "none", borderRadius: "0 18px 18px 0", padding: "clamp(24px,2.5vw,40px)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
                <span style={{
                  width: 32, height: 32, borderRadius: 8, background: "oklch(0.55 0.18 25)",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </span>
                <h3 style={{ fontFamily: "var(--ff)", fontWeight: 800, fontStretch: "115%", fontSize: 17, color: "var(--text)" }}>Prohibited</h3>
              </div>
              <ul style={{ display: "flex", flexDirection: "column", gap: 12, listStyle: "none" }}>
                {PROHIBITED.map((item) => (
                  <li key={item} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 15, color: "var(--muted)", lineHeight: 1.5 }}>
                    <span style={{ color: "oklch(0.65 0.18 25)", marginTop: 2, flexShrink: 0 }}>—</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p style={{ marginTop: 20, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
            Items not listed above are evaluated case-by-case. When in doubt,{" "}
            <a href="mailto:hello@baylo.ph" style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: 3 }}>
              email us
            </a>{" "}
            before listing. Prohibited listings are removed without notice and may result in account suspension.
          </p>
        </div>
      </Section>

      {/* ── Safety Tips ── */}
      <Section id="tips">
        <div className="wrap">
          <p className="kicker" style={{ marginBottom: 16 }}>Stay safe</p>
          <h2 className="display" style={{ fontSize: "clamp(32px,3.5vw,56px)", color: "var(--text)", marginBottom: "clamp(36px,4vw,60px)" }}>
            Tips for every<br />trade
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,280px),1fr))", gap: 2 }}>
            {TIPS.map((t) => (
              <div key={t.title} style={{
                background: "var(--card)", border: "1px solid var(--line)",
                borderRadius: 18, padding: "clamp(24px,2.5vw,36px)",
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: "var(--accent)", color: "var(--on-accent)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 18, flexShrink: 0,
                }}>{t.icon}</div>
                <h3 style={{ fontFamily: "var(--ff)", fontWeight: 800, fontStretch: "115%", fontSize: 18, color: "var(--text)", marginBottom: 10 }}>{t.title}</h3>
                <p style={{ fontSize: 15, color: "var(--muted)", lineHeight: 1.65 }}>{t.body}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Dispute Process ── */}
      <Section id="disputes">
        <div className="wrap">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "clamp(32px,5vw,80px)", alignItems: "center" }}>
            <div>
              <p className="kicker" style={{ marginBottom: 16 }}>Dispute resolution</p>
              <h2 className="display" style={{ fontSize: "clamp(32px,3.5vw,56px)", color: "var(--text)", marginBottom: 24 }}>
                Something<br />went wrong?
              </h2>
              <p style={{ fontSize: "clamp(15px,1.2vw,18px)", color: "var(--muted)", lineHeight: 1.65, marginBottom: 32 }}>
                Disputes happen. When they do, our moderation team steps in fast. File a
                report through the trade page, attach any evidence (photos, chat screenshots),
                and we'll reach a resolution within <strong style={{ color: "var(--text)" }}>3 business days</strong>.
              </p>
              <Link href="mailto:hello@baylo.ph" className="btn solid">
                Contact support
                <span className="arrow">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h13M13 6l6 6-6 6" />
                  </svg>
                </span>
              </Link>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {[
                { step: "01", label: "Open the trade", desc: "Go to your trade history and click 'Report an issue' on the relevant trade." },
                { step: "02", label: "Submit evidence", desc: "Upload photos, describe what happened. The other party is notified and can respond within 24 hours." },
                { step: "03", label: "We review", desc: "Our team reads both sides, checks listing details and chat history, and may ask follow-up questions." },
                { step: "04", label: "Resolution issued", desc: "We restore points, issue warnings, or suspend accounts based on findings. You'll receive a written decision." },
              ].map((s) => (
                <div key={s.step} style={{
                  background: "var(--card)", border: "1px solid var(--line)",
                  borderRadius: 14, padding: "20px 24px",
                  display: "flex", gap: 18, alignItems: "flex-start",
                }}>
                  <span style={{
                    fontFamily: "var(--ff)", fontWeight: 800, fontSize: 13,
                    letterSpacing: "0.08em", color: "var(--accent)", flexShrink: 0, paddingTop: 2,
                  }}>{s.step}</span>
                  <div>
                    <div style={{ fontFamily: "var(--ff)", fontWeight: 700, fontSize: 15, color: "var(--text)", marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55 }}>{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ── Report CTA ── */}
      <Section id="report">
        <div className="wrap">
          <div style={{
            background: "var(--card)", border: "1px solid var(--line)",
            borderRadius: 24, padding: "clamp(36px,5vw,72px)",
            display: "grid", gridTemplateColumns: "1fr auto", gap: 32, alignItems: "center",
          }}>
            <div>
              <p className="kicker" style={{ marginBottom: 14 }}>See something wrong?</p>
              <h2 className="display" style={{ fontSize: "clamp(28px,3vw,48px)", color: "var(--text)", marginBottom: 16 }}>
                Report it. We act<br />within 24 hours.
              </h2>
              <p style={{ fontSize: "clamp(14px,1.1vw,17px)", color: "var(--muted)", lineHeight: 1.65, maxWidth: "52ch" }}>
                Seen a prohibited listing, a scam account, or behaviour that violates our
                community standards? Every report is reviewed by a human — not a bot.
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
              <Link href="mailto:hello@baylo.ph" className="btn solid" style={{ whiteSpace: "nowrap" }}>
                Email support
                <span className="arrow">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h13M13 6l6 6-6 6" />
                  </svg>
                </span>
              </Link>
              <Link href="/listings" className="btn" style={{ whiteSpace: "nowrap" }}>
                Back to listings
                <span className="arrow">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h13M13 6l6 6-6 6" />
                  </svg>
                </span>
              </Link>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Responsive fixes ── */}
      <style>{`
        @media (max-width: 760px) {
          #policy > div > div[style*="grid-template-columns: 1fr 1fr"],
          #disputes > div > div[style*="grid-template-columns: 1fr 1fr"],
          #report > div > div[style*="grid-template-columns: 1fr auto"] {
            grid-template-columns: 1fr !important;
          }
          #policy > div > div > div:last-child {
            border-left: 1px solid var(--line) !important;
            border-radius: 0 0 18px 18px !important;
          }
          #policy > div > div > div:first-child {
            border-radius: 18px 18px 0 0 !important;
          }
        }
        @media (max-width: 900px) {
          #principles > div > div:first-child {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  )
}
