"use client";
import React from "react";

// ── SVG paths (Lucide-style, single combined path per icon) ──────────────────
const I = {
  leaf:    "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Zm-2-8c4-1 6-3 7-6",
  arrow:   "M5 12h14M13 6l6 6-6 6",
  x:       "M18 6 6 18M6 6l12 12",
  plus:    "M12 5v14M5 12h14",
  history: "M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8",
} as const;

function Ico({ d, size = 18, color }: { d: string; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke={color ?? "currentColor"} strokeWidth={2}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────
interface LeafTx {
  id: string;
  type: "TRADE_SPEND" | "TRADE_RECEIVE";
  amount: number;
  description: string;
  createdAt: string;
}

// ── Formatting helpers ───────────────────────────────────────────────────────
function fmtLeaves(n: number) {
  return n.toLocaleString("en-US");
}
function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}
function txLabel(tx: LeafTx): string {
  return tx.type === "TRADE_SPEND" ? "Given" : "Received";
}
function txColor(tx: LeafTx): string {
  return tx.amount > 0 ? "var(--eco, #2ad59e)" : "#f0506e";
}
function txSign(tx: LeafTx): string {
  return tx.amount > 0 ? "+" : "";
}

// ── Main LeavesModal ─────────────────────────────────────────────────────────
export default function LeavesModal({ onClose }: { onClose: () => void }) {
  const [total, setTotal] = React.useState<number | null>(null);
  const [available, setAvailable] = React.useState<number | null>(null);
  const [txs, setTxs] = React.useState<LeafTx[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch("/api/leaves")
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { total?: number; available?: number; transactions?: LeafTx[] };
        setTotal(data.total ?? 0);
        setAvailable(data.available ?? data.total ?? 0);
        setTxs(data.transactions ?? []);
      })
      .catch(() => setTotal(0))
      .finally(() => setLoading(false));
  }, []);

  // Close on backdrop click
  const backdropRef = React.useRef<HTMLDivElement>(null);
  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  // Close on Escape
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const committed = total != null && available != null ? total - available : 0;

  return (
    <div
      ref={backdropRef}
      className="modal-backdrop"
      onClick={handleBackdrop}
      style={{ zIndex: 400 }}
    >
      <div className="modal-box" style={{ width: "min(480px, 100%)", padding: 0, overflow: "hidden" }}>
        {/* ── Header ── */}
        <div style={{
          padding: "20px 22px 16px",
          borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{
            width: 38, height: 38, borderRadius: 10,
            background: "color-mix(in oklab, var(--accent) 14%, transparent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--accent)", flexShrink: 0,
          }}>
            <Ico d={I.leaf} size={20} color="var(--accent)" />
          </span>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0, color: "var(--text)" }}>
              My Leaves
            </h2>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>Pasa Leaves</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Leaves panel"
            style={{
              background: "none", border: 0, cursor: "pointer", color: "var(--text-dim)",
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 32, height: 32, borderRadius: 8,
            }}
          >
            <Ico d={I.x} size={18} />
          </button>
        </div>

        <div style={{ padding: "20px 22px 24px", maxHeight: "calc(100dvh - 160px)", overflowY: "auto" }}>
          {/* ── Leaf total card ── */}
          <div style={{
            padding: "22px 20px",
            borderRadius: 14,
            background: "linear-gradient(135deg, color-mix(in oklab, var(--accent) 22%, var(--surface-2)), var(--surface-2))",
            border: "1px solid color-mix(in oklab, var(--accent) 28%, var(--border))",
            marginBottom: 20,
          }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--accent)", margin: "0 0 6px" }}>
              Your Leaves
            </p>
            {loading ? (
              <p style={{ fontSize: 32, fontWeight: 800, color: "var(--text)", margin: 0, letterSpacing: "-.02em" }}>—</p>
            ) : (
              <>
                <p style={{ fontSize: 36, fontWeight: 800, color: "var(--text)", margin: 0, letterSpacing: "-.03em", lineHeight: 1.1 }}>
                  {fmtLeaves(total ?? 0)}{" "}
                  <span style={{ fontSize: 18, fontWeight: 600, opacity: .8 }}>Leaves</span>
                </p>
                {committed > 0 && (
                  <p style={{ fontSize: 13, color: "var(--text-dim)", margin: "6px 0 0", fontWeight: 500 }}>
                    {fmtLeaves(available ?? 0)} available · {fmtLeaves(committed)} committed to pending offers
                  </p>
                )}
              </>
            )}
            <p style={{ fontSize: 12.5, color: "var(--text-dim)", margin: "14px 0 0", lineHeight: 1.45 }}>
              Leaves are earned by trading, never bought. They move between members
              only when a swap is confirmed by both sides.
            </p>
          </div>

          {/* ── Leaf activity ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Ico d={I.history} size={15} color="var(--muted)" />
            <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)", margin: 0 }}>
              Leaf activity
            </p>
          </div>

          {loading ? (
            <p style={{ fontSize: 13, color: "var(--text-dim)", padding: "20px 0", textAlign: "center" }}>Loading…</p>
          ) : txs.length === 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
              padding: "36px 0", color: "var(--text-dim)",
            }}>
              <Ico d={I.leaf} size={32} color="var(--border-strong)" />
              <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>No Leaf activity yet</p>
              <p style={{ fontSize: 13, margin: 0, opacity: .7 }}>Complete a swap to earn your first Leaves.</p>
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {txs.map((tx) => (
                <li key={tx.id} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "11px 12px", borderRadius: 10,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                }}>
                  {/* type badge */}
                  <span style={{
                    width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                    background: tx.amount > 0
                      ? "color-mix(in oklab, var(--eco, #2ad59e) 14%, transparent)"
                      : "rgba(240,80,110,.1)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: txColor(tx),
                  }}>
                    <Ico d={tx.amount > 0 ? I.plus : I.arrow} size={16} color={txColor(tx)} />
                  </span>

                  {/* description */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", margin: 0, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {tx.description}
                    </p>
                    <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "2px 0 0", display: "flex", alignItems: "center", gap: 6 }}>
                      <span>{txLabel(tx)}</span>
                      <span>·</span>
                      <span>{fmtDate(tx.createdAt)}</span>
                    </p>
                  </div>

                  {/* amount */}
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 800, color: txColor(tx), margin: 0 }}>
                      {txSign(tx)}{fmtLeaves(Math.abs(tx.amount))} Leaves
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
