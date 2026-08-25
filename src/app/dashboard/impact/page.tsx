import { auth } from "@/../auth"
import { redirect } from "next/navigation"
import prisma from "@/lib/prisma"
import DashShell from "../_shell/DashShell"
import {
  computeGreenScore,
  computeTier,
  computeImpactData,
  KG_CO2_PER_TREE,
} from "@/lib/impact-constants"

export const dynamic = "force-dynamic"

function Ring({ score }: { score: number }) {
  const C = 2 * Math.PI * 52
  const pct = Math.max(0, Math.min(1, score / 100))
  return (
    <div style={{ position: "relative", width: 132, height: 132, flexShrink: 0 }}>
      <svg width={132} height={132} viewBox="0 0 132 132" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="66" cy="66" r="52" fill="none" stroke="rgba(0,0,0,.08)" strokeWidth={10} />
        <circle cx="66" cy="66" r="52" fill="none" stroke="#3C7143" strokeWidth={10}
                strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
                style={{ transition: "stroke-dashoffset .8s ease" }} />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: ".06em" }}>Green</span>
      </div>
    </div>
  )
}

function SvgIcon({ d, size = 22 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#3C7143"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const IMPACT_ICONS = {
  cloud:   "M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.3A3.5 3.5 0 0 1 18 18Z",
  droplet: "M12 21a7 7 0 0 0 7-7c0-4.5-7-11.5-7-11.5S5 9.5 5 14a7 7 0 0 0 7 7Z",
  cycle:   "M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5",
  sprout:  "M7 20h10M12 20V9M12 9C12 6 9.5 4 6 4c0 3.5 2.5 5 6 5ZM12 10.6c0-2.4 2-4.3 4.8-4.3 0 2.7-2 4.3-4.8 4.3Z",
  leaf:    "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10ZM2 21c0-3 1.85-5.4 5.1-6",
} as const

function Metric({ icon, value, unit, label }: { icon: keyof typeof IMPACT_ICONS; value: string; unit: string; label: string }) {
  return (
    <div style={{
      padding: "20px 16px", borderRadius: 12, background: "rgba(60,113,67,.07)",
      border: "1px solid rgba(60,113,67,.14)", display: "flex", flexDirection: "column", gap: 4,
    }}>
      <SvgIcon d={IMPACT_ICONS[icon]} />
      <div>
        <span style={{ fontSize: 26, fontWeight: 800, fontFamily: "var(--ff)" }}>{value}</span>
        {unit && <span style={{ fontSize: 13, color: "#888", marginLeft: 4 }}>{unit}</span>}
      </div>
      <span style={{ fontSize: 12, color: "#888" }}>{label}</span>
    </div>
  )
}

export default async function ImpactPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/login")

  const user = await prisma.user.findUnique({ where: { id: session.user.id } })
  if (!user) redirect("/auth/login")

  // Fetch all completed trades with category data
  const tradesRaw = await prisma.tradeRequest.findMany({
    where: {
      OR: [{ senderId: user.id }, { receiverId: user.id }],
      status: "COMPLETED",
    },
    select: {
      senderId: true,
      offeredItem:   { select: { category: true } },
      requestedItem: { select: { category: true } },
    },
  })

  const impact = computeImpactData(user.id, tradesRaw)
  const treesEquiv = Math.floor(impact.co2Avoided / KG_CO2_PER_TREE)

  const score    = computeGreenScore(impact.co2Avoided, impact.waterSaved, impact.itemsRehomed, impact.wasteDiverted)
  const tier     = computeTier(score)
  const nextTier = score < 20 ? "Sprout" : score < 40 ? "Sapling" : score < 60 ? "Canopy" : score < 80 ? "Forest" : null
  const nextThreshold = score < 20 ? 20 : score < 40 ? 40 : score < 60 ? 60 : score < 80 ? 80 : 100
  const toNext   = Math.max(0, nextThreshold - score)

  const circulationPct = impact.co2Given > 0
    ? Math.min(100, Math.round((impact.co2Received / impact.co2Given) * 100))
    : 0

  return (
    <DashShell title="Impact report" description={`Your environmental contribution in ${new Date().getFullYear()}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>

        {/* Green score hero */}
        <div style={{
          padding: "28px 24px", borderRadius: 16, background: "rgba(60,113,67,.06)",
          border: "1px solid rgba(60,113,67,.18)", display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap",
        }}>
          <Ring score={score} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 999,
              background: "#3C7143", color: "#fff", fontSize: 12, fontWeight: 700, marginBottom: 12,
            }}>
              <SvgIcon d={IMPACT_ICONS.leaf} size={14} /> {tier} tier
            </div>
            <p style={{ fontSize: 15, color: "#555", lineHeight: 1.5, marginBottom: 12 }}>
              {impact.itemsRehomed === 0
                ? "Complete your first trade to start building your environmental impact record."
                : `You've rehomed ${impact.itemsRehomed} item${impact.itemsRehomed !== 1 ? "s" : ""} and kept them out of landfill.`}
            </p>
            {nextTier && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888", marginBottom: 6 }}>
                  <span>Progress to {nextTier}</span>
                  <span>{score} / {nextThreshold} pts ({toNext} more)</span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: "rgba(0,0,0,.08)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${(score / nextThreshold) * 100}%`, borderRadius: 999, background: "#3C7143", transition: "width .8s ease" }} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Metrics grid */}
        <div>
          <p style={{ fontSize: 11, color: "#999", marginBottom: 10, textAlign: "right" }}>
            * estimated — based on category averages
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <Metric icon="cloud"   value={impact.co2Avoided.toFixed(1)}      unit="kg" label="CO₂ avoided*" />
            <Metric icon="droplet" value={impact.waterSaved.toLocaleString()} unit="L"  label="Water saved*" />
            <Metric icon="cycle"   value={String(impact.itemsRehomed)}        unit=""   label="Items rehomed" />
            <Metric icon="sprout"  value={impact.wasteDiverted.toFixed(1)}    unit="kg" label="Waste diverted*" />
          </div>
        </div>

        {/* CO₂ in circulation */}
        {impact.itemsRehomed > 0 && (
          <div style={{
            padding: "18px 20px", borderRadius: 12, background: "rgba(60,113,67,.07)",
            border: "1px solid rgba(60,113,67,.14)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#555", marginBottom: 10 }}>
              <span>CO₂ kept in circulation</span>
              <span style={{ fontWeight: 700 }}>
                {impact.co2Received.toFixed(1)} / {impact.co2Given.toFixed(1)} kg
              </span>
            </div>
            <div style={{ height: 8, borderRadius: 999, background: "rgba(0,0,0,.08)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${circulationPct}%`, borderRadius: 999, background: "#3C7143", transition: "width .8s ease" }} />
            </div>
            <p style={{ fontSize: 12, color: "#888", marginTop: 8 }}>
              Items received vs. given — a measure of circular economy participation.
            </p>
          </div>
        )}

        {/* Trees equivalent */}
        {impact.itemsRehomed > 0 && (
          <div style={{
            padding: "18px 20px", borderRadius: 12, background: "rgba(60,113,67,.07)",
            border: "1px solid rgba(60,113,67,.14)", fontSize: 14, color: "#555",
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <SvgIcon d={IMPACT_ICONS.sprout} size={28} />
            <span>
              Your trades this year are equivalent to planting{" "}
              <strong style={{ color: "#3C7143" }}>
                {treesEquiv === 0 ? "less than 1" : treesEquiv} tree{treesEquiv !== 1 ? "s" : ""}
              </strong>{" "}
              <span style={{ fontSize: 12, color: "#999" }}>(estimated)</span>.
            </span>
          </div>
        )}

        {/* CTA for new accounts */}
        {impact.itemsRehomed === 0 && (
          <div style={{
            padding: "24px", borderRadius: 12, border: "2px dashed rgba(60,113,67,.2)",
            textAlign: "center", color: "#888",
          }}>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Start your impact journey</p>
            <p style={{ fontSize: 13, marginBottom: 16 }}>
              Every trade you make saves CO₂, water, and reduces waste. Post your first item to get started.
            </p>
            <a href="/dashboard" style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: "#3C7143", color: "#F4EAEB", borderRadius: 10,
              padding: "10px 18px", fontWeight: 700, fontSize: 14, textDecoration: "none",
            }}>
              Go to feed
            </a>
          </div>
        )}
      </div>
    </DashShell>
  )
}
