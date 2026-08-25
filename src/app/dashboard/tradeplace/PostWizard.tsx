"use client";
import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import toast from "react-hot-toast";
import type { PickupLocation } from "../PickupMap";
import type { SerializedItem } from "./TradeplaceClient";

const PickupMap = dynamic(() => import("../PickupMap"), { ssr: false });
const MAX_PHOTOS = 8;
const MIN_SHORT_SIDE = 600;
const VERY_LOW_RES   = 300;

const CATEGORIES = [
  { value: "ELECTRONICS",  label: "Electronics" },
  { value: "CLOTHING",     label: "Clothing & Shoes" },
  { value: "BAGS",         label: "Bags & Backpacks" },
  { value: "BEAUTY",       label: "Beauty & Skincare" },
  { value: "ACCESSORIES",  label: "Accessories" },
  { value: "FURNITURE",    label: "Furniture" },
  { value: "BOOKS",        label: "Books & Media" },
  { value: "GAMING",       label: "Gaming" },
  { value: "SPORTS",       label: "Sports & Fitness" },
  { value: "BIKES",        label: "Bikes & Scooters" },
  { value: "TOYS",         label: "Toys & Kids" },
  { value: "TOOLS",        label: "Tools & DIY" },
  { value: "MUSIC",        label: "Music & Instruments" },
  { value: "ART",          label: "Art & Crafts" },
  { value: "COLLECTIBLES", label: "Collectibles" },
  { value: "PETS",         label: "Pets & Animals" },
  { value: "PLANTS",       label: "Plants & Garden" },
  { value: "FOOD",         label: "Food & Drinks" },
  { value: "SERVICES",     label: "Services & Skills" },
  { value: "OTHER",        label: "Other" },
];
const CONDITIONS = [
  { value: "NEW",      label: "New" },
  { value: "LIKE_NEW", label: "Like New" },
  { value: "GOOD",     label: "Good" },
  { value: "FAIR",     label: "Fair" },
  { value: "POOR",     label: "Poor" },
];
const STEP_LABELS = ["Photos", "Identify", "Value", "Your ask", "Review"];

// ─── Parse helpers ────────────────────────────────────────────────────────────
function parseImages(raw: string): string[] {
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}
// Edit mode reads the server-shaped fields directly. Pickup used to be dug out
// of a JSON envelope in `wantedItems`; it is now its own field, already filtered
// for this viewer. The wizard only ever edits the viewer's OWN item, so the
// pickup it receives is the precise one.
function parseWanted(item: SerializedItem | undefined): string {
  return item?.wanted ?? "";
}
function parsePickupLoc(item: SerializedItem | undefined): PickupLocation | null {
  const p = item?.pickup;
  if (!p || !p.precise) return null;
  return { lat: p.lat, lng: p.lng, address: p.address ?? "" };
}
function fmtLeaves(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} Leaves`;
}

// ─── SVG icons ────────────────────────────────────────────────────────────────
function Sparkle({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.8 7.2L21 11l-7.2 1.8L12 20l-1.8-7.2L3 11l7.2-1.8Z" />
    </svg>
  );
}
function Camera({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
function Globe({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
function ImageIcon({ size = 22, color = "#9CA3AF" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}
function Check({ size = 12, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function ShieldCheck({ size = 22, color = "#16A34A" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}
function ShieldX({ size = 22, color = "#DC2626" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" />
    </svg>
  );
}
function ShieldDot({ size = 22, color = "#4CAF50" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <circle cx="12" cy="12" r="1.5" fill={color} />
    </svg>
  );
}
function Spin({ size = 16, color = "#4CAF50" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" aria-hidden
      style={{ animation: "pw2-spin 0.8s linear infinite", display: "block" }}>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}
function PlusIcon({ size = 20, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function XIcon({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Comparable { label: string; sublabel: string; leaves: string; }
type DupStatus = "idle" | "checking" | "passed" | "failed" | "self";
type ValueSub  = "intro" | "scanning" | "result";

interface Props {
  onClose:     () => void;
  onPosted:    (item: SerializedItem) => void;
  initialItem?: SerializedItem;
  me?: { id: string; name: string; avatar: string | null; rating?: number };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function PostWizard({ onClose, onPosted, initialItem, me }: Props) {
  const isEdit = !!initialItem;

  // Step nav
  const [step, setStep] = useState(0);

  // Step 0 — Photos
  const [images,    setImages]    = useState<string[]>(() =>
    initialItem ? parseImages(initialItem.images).slice(0, MAX_PHOTOS) : []
  );
  const [uploading, setUploading] = useState(false);

  // Step 1 — Identify
  const [title,       setTitle]       = useState(initialItem?.title ?? "");
  const [category,    setCategory]    = useState(initialItem?.category ?? "ELECTRONICS");
  const [condition,   setCondition]   = useState(initialItem?.condition ?? "GOOD");
  const [tags,        setTags]        = useState<string[]>(() => {
    if (!initialItem?.description) return [];
    try { return JSON.parse(initialItem.description) as string[]; }
    catch { return initialItem.description ? [initialItem.description] : []; }
  });
  const [tagInput,    setTagInput]    = useState("");
  const [identifying, setIdentifying] = useState(false);
  const [aiIdentified,setAiIdentified]= useState(isEdit);
  const [imageHash,   setImageHash]   = useState<string | null>(initialItem?.imageHash ?? null);
  const [dupStatus,   setDupStatus]   = useState<DupStatus>(isEdit ? "passed" : "idle");

  // Track original photos to detect changes in edit mode
  const originalImages = useRef<string[]>(
    initialItem ? parseImages(initialItem.images).slice(0, MAX_PHOTOS) : []
  );

  // Reset AI/dup state when photos change in edit mode; restore when reverted
  useEffect(() => {
    if (!isEdit) return;
    const orig = originalImages.current;
    const unchanged =
      images.length === orig.length && images.every((url, i) => url === orig[i]);
    if (unchanged) {
      setAiIdentified(true);
      setDupStatus("passed");
      setImageHash(initialItem!.imageHash ?? null);
    } else {
      setAiIdentified(false);
      setDupStatus("idle");
      setImageHash(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  // Step 2 — Value
  const prevCat = useRef(category);
  const [valueSub,    setValueSub]    = useState<ValueSub>(() =>
    isEdit ? "result" : "intro"
  );
  const [valueRange,  setValueRange]  = useState({ min: 0, max: 0, midpoint: 0 });
  const [userValue,   setUserValue]   = useState<number>(() =>
    initialItem?.valueLeaves ?? 0
  );
  const [comparables, setComparables] = useState<Comparable[]>([]);
  const [valueError, setValueError] = useState("");

  // Step 3 — Ask
  const [wantedText, setWantedText] = useState(() => parseWanted(initialItem));
  const [pickup,     setPickup]     = useState<PickupLocation | null>(() =>
    parsePickupLoc(initialItem)
  );

  // UI
  const [posting,       setPosting]       = useState(false);
  const [error,         setError]         = useState("");
  const [resQuality,    setResQuality]    = useState<"ok" | "warn" | "block">("ok");
  const [pendingUpload, setPendingUpload] = useState<File[] | null>(null);

  useEffect(() => {
    if (images.length === 0) { setResQuality("ok"); setPendingUpload(null); }
  }, [images.length]);

  useEffect(() => {
    function blockEscape(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); }
    }
    document.addEventListener("keydown", blockEscape, true);
    return () => document.removeEventListener("keydown", blockEscape, true);
  }, []);

  function confirmClose() {
    if (isEdit) {
      if (window.confirm("Discard changes?")) onClose();
      return;
    }
    const hasProgress = step > 0 || images.length > 0 || title.trim().length > 0 || wantedText.trim().length > 0;
    if (!hasProgress || window.confirm("Discard this listing? Your progress will be lost.")) onClose();
  }

  // ── Upload ────────────────────────────────────────────────────────────────
  async function checkDimensions(file: File): Promise<"ok" | "warn" | "block"> {
    try {
      const bmp = await createImageBitmap(file);
      const short = Math.min(bmp.width, bmp.height);
      bmp.close();
      if (short < VERY_LOW_RES) return "block";
      if (short < MIN_SHORT_SIDE) return "warn";
      return "ok";
    } catch {
      return "ok";
    }
  }

  async function uploadOne(file: File): Promise<string> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) throw new Error("Upload failed");
    const data = await res.json() as { url: string; width: number; height: number };
    console.log(`[img-upload] "${file.name}" stored → ${data.width}×${data.height} ${data.url}`);
    return data.url;
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const remaining = MAX_PHOTOS - images.length;
    if (remaining <= 0) { setError("Maximum 8 photos"); return; }
    setError(""); setUploading(true);
    setResQuality("ok"); setPendingUpload(null);
    const toUpload = files.slice(0, remaining);
    const tiers = await Promise.all(toUpload.map(checkDimensions));
    const worst = tiers.includes("block") ? "block" : tiers.includes("warn") ? "warn" : "ok";
    setResQuality(worst);
    if (worst === "block") {
      setUploading(false);
      setPendingUpload(toUpload);
      e.target.value = "";
      return;
    }
    try {
      const urls = await Promise.all(toUpload.map(uploadOne));
      setImages(prev => [...prev, ...urls]);
    } catch { setError("Photo upload failed — try again"); }
    finally { setUploading(false); e.target.value = ""; }
  }

  async function confirmLowRes() {
    if (!pendingUpload) return;
    const files = pendingUpload;
    setPendingUpload(null);
    setUploading(true);
    try {
      const urls = await Promise.all(files.map(uploadOne));
      setImages(prev => [...prev, ...urls]);
    } catch { setError("Photo upload failed — try again"); }
    finally { setUploading(false); }
  }

  function cancelLowRes() {
    setPendingUpload(null);
    setResQuality("ok");
  }

  // ── AI Identify (triggers on leaving Step 0) ──────────────────────────────
  async function handleIdentifyWithAI() {
    if (images.length === 0) return;
    setError("");
    setStep(1);
    setIdentifying(true);
    setDupStatus("checking");

    const imageUrl = images[0];

    const [identRes, phashRes] = await Promise.allSettled([
      fetch("/api/ai/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      }).then(r => r.json() as Promise<{ name?: string; category?: string; condition?: string; tags?: string[] }>),
      fetch("/api/ai/phash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      }).then(r => r.json() as Promise<{ hash?: string; status?: string }>),
    ]);

    setIdentifying(false);

    if (identRes.status === "fulfilled") {
      const ai = identRes.value;
      if (ai.name)      setTitle(ai.name);
      if (ai.category && CATEGORIES.some(c => c.value === ai.category)) setCategory(ai.category);
      if (ai.condition && CONDITIONS.some(c => c.value === ai.condition)) setCondition(ai.condition);
      if (Array.isArray(ai.tags)) setTags(ai.tags.slice(0, 5));
    }
    setAiIdentified(true);

    if (phashRes.status === "fulfilled") {
      const ph = phashRes.value;
      if (ph.hash) setImageHash(ph.hash);
      setDupStatus((ph.status as DupStatus | undefined) ?? "passed");
    } else {
      console.warn(
        "[PostWizard] phash API call was rejected (network error or server returned non-JSON).",
        "Reason:", (phashRes as PromiseRejectedResult).reason,
        "— imageHash will be null; this listing will NOT be in the duplicate-check pool.",
      )
      setDupStatus("passed");
    }
  }

  // ── Value scan ────────────────────────────────────────────────────────────
  async function scanValue() {
    setValueSub("scanning");
    try {
      const res  = await fetch(`/api/ai/value?category=${category}`);
      if (!res.ok) throw new Error(`value endpoint returned ${res.status}`);
      const data = await res.json() as {
        min: number; max: number; midpoint: number; comparables: Comparable[];
      };
      setValueError("");
      setValueRange({ min: data.min, max: data.max, midpoint: data.midpoint });
      setUserValue(data.midpoint);
      setComparables(data.comparables ?? []);
      setValueSub("result");
    } catch {
      // No local band table on purpose: /api/ai/value owns the value bands.
      // If it cannot be reached we ask the user for a value instead of
      // guessing from a copy that would silently drift out of sync.
      setValueRange({ min: 0, max: 0, midpoint: 0 });
      setValueError("Couldn't load suggested values — enter your own asking value below.");
      setValueSub("result");
    }
  }

  // Reset value if category changed between scans
  function handleCategoryChange(val: string) {
    setCategory(val);
    if (val !== prevCat.current) {
      prevCat.current = val;
      setValueSub("intro");
      setValueRange({ min: 0, max: 0, midpoint: 0 });
    }
  }

  // ── Post ──────────────────────────────────────────────────────────────────
  async function handlePost() {
    setError("");
    if (!title.trim()) { setError("Item name is required"); return; }
    if (!imageHash) {
      console.warn(
        "[PostWizard] handlePost: imageHash is null — posting without duplicate-check protection.",
        "The phash check either failed, was rejected, or was skipped for this listing.",
      )
    }
    setPosting(true);
    try {
      const body = {
        title:          title.trim(),
        description:    tags.length > 0 ? JSON.stringify(tags) : title.trim(),
        category,
        condition,
        valueLeaves: userValue,
        images,
        wantedItems:    wantedText.trim() || null,
        localPickup:    pickup != null,
        pickupLat:      pickup?.lat ?? null,
        pickupLng:      pickup?.lng ?? null,
        pickupAddress:  pickup?.address ?? null,
        imageHash,
      };
      const url    = isEdit ? `/api/items/${initialItem!.id}` : "/api/items";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const { error: e } = await res.json() as { error?: string };
        throw new Error(e ?? "Failed to post");
      }
      const item = await res.json() as SerializedItem;
      toast.success(isEdit ? "Listing updated!" : "Trade posted!");
      onPosted(item);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally { setPosting(false); }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function addTag() {
    const t = tagInput.trim();
    if (t && !tags.includes(t) && tags.length < 8) {
      setTags(prev => [...prev, t]);
      setTagInput("");
    }
  }
  function removeTag(t: string) { setTags(prev => prev.filter(x => x !== t)); }

  const catLabel  = CATEGORIES.find(c => c.value === category)?.label ?? category;
  const condLabel = CONDITIONS.find(c => c.value === condition)?.label ?? condition;

  // In edit mode: are the current photos still identical to the original ones?
  const photosUnchanged = isEdit &&
    images.length === originalImages.current.length &&
    images.every((url, i) => url === originalImages.current[i]);

  const canContinue =
    step === 0 ? images.length > 0 :
    step === 1 ? title.trim().length > 0 && !identifying && dupStatus !== "failed" && dupStatus !== "checking" :
    step === 2 ? valueSub === "result" :
    true;

  const valueOk    = valueRange.max === 0 || (userValue >= valueRange.min && userValue <= valueRange.max);
  const valueAbove = valueRange.max > 0 && userValue > valueRange.max;
  const valueStatus = valueAbove
    ? "Above the suggested range — harder to get offers"
    : !valueOk
    ? "Below the suggested range — consider revising up"
    : "Within the suggested range — fair and likely to trade.";

  const askChips = [
    "Open to offers",
    `Other ${catLabel}`,
    "Trade up",
    "Cash + trade",
  ];

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderTabs() {
    return (
      <div className="pw2-tabs">
        {STEP_LABELS.map((label, i) => {
          const state = i === step ? "current" : i < step ? "done" : "upcoming";
          return (
            <div key={i} className={`pw2-tab ${state}`}>
              <span className="pw2-tab-num">
                {i < step ? <Check size={10} color="#fff" /> : i + 1}
              </span>
              <span>{label}</span>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Footer status text while async work is running ────────────────────────
  function renderFooterStatus(): React.ReactNode {
    if (step === 1) {
      if (identifying) return <span className="pw2-footer-status"><Spin size={13} />Analyzing photo…</span>;
      if (dupStatus === "checking") return <span className="pw2-footer-status"><Spin size={13} />Checking for duplicates…</span>;
    }
    if (step === 2 && valueSub === "scanning")
      return <span className="pw2-footer-status"><Spin size={13} />Scanning Baylo trade history…</span>;
    if (posting)
      return <span className="pw2-footer-status"><Spin size={13} />{isEdit ? "Saving…" : "Posting…"}</span>;
    return null;
  }

  // ── Step renders ──────────────────────────────────────────────────────────

  // Step 0 — Photos
  function renderStep0() {
    const atMax = images.length >= MAX_PHOTOS;
    return (
      <div>
        {images.length === 0 ? (
          uploading ? (
            <div className="pw2-dropzone-empty" style={{ cursor: "default", pointerEvents: "none" }}>
              <div className="pw2-camera-badge" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Spin size={26} color="#4CAF50" />
              </div>
              <p className="pw2-drop-title">Uploading photo…</p>
              <p className="pw2-drop-sub">Please wait while your photo is uploaded.</p>
            </div>
          ) : (
            <label className="pw2-dropzone-empty">
              <div className="pw2-camera-badge"><Camera size={26} /></div>
              <p className="pw2-drop-title">Add photos of your item</p>
              <p className="pw2-drop-sub">
                Drag &amp; drop or click to browse. Our AI analyzes <em>your</em> photos
                to help identify the item and set a fair value.
              </p>
              <div className="pw2-add-photos-cta">
                <PlusIcon size={15} /> Add photos
              </div>
              <input type="file" accept="image/*" multiple className="sr-only"
                onChange={handleFiles} disabled={uploading} />
            </label>
          )
        ) : (
          <>
            <div className="pw2-photo-grid">
              {images.map((url, i) => (
                <div key={i} className="pw2-photo-thumb">
                  <img src={url} alt={`Photo ${i + 1}`} />
                  {i === 0 && <span className="pw2-photo-cover-label">Cover</span>}
                  <button
                    className="pw2-photo-rm-btn"
                    onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                    aria-label="Remove photo"
                  >
                    <XIcon size={10} />
                  </button>
                </div>
              ))}
              {!atMax && (
                <label className="pw2-photo-add-tile" style={uploading ? { pointerEvents: "none", opacity: 0.5 } : {}}>
                  <PlusIcon size={22} color="#9CA3AF" />
                  <span>Add</span>
                  <input type="file" accept="image/*" multiple className="sr-only"
                    onChange={handleFiles} disabled={uploading} />
                </label>
              )}
            </div>
            {uploading && (
              <div className="pw2-photo-uploading">
                <Spin size={13} color="#4CAF50" /> Uploading photo…
              </div>
            )}
            <div className="pw2-photo-status">
              <Check size={13} color="#16A34A" />
              {images.length} of {MAX_PHOTOS} photo{images.length !== 1 ? "s" : ""} · first is the cover
            </div>
          </>
        )}
        {resQuality === "warn" && !pendingUpload && (
          <div className="pw2-lowres-warn">
            This image is low resolution and may look blurry. Upload a larger photo for best results.
          </div>
        )}
        {pendingUpload && (
          <div className="pw2-lowres-block">
            <p>This image is very low quality and will look blurry on your listing. Use it anyway?</p>
            <div className="pw2-lowres-block-actions">
              <button className="pw2-lowres-cancel" onClick={cancelLowRes}>Cancel</button>
              <button className="pw2-lowres-confirm" onClick={confirmLowRes} disabled={uploading}>Use Anyway</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Step 1 — Identify
  function renderStep1() {
    return (
      <div>
        <div className="pw2-ident-split">
          {/* Left: photo */}
          {images[0] && (
            <div className="pw2-ident-photo">
              <img src={images[0]} alt="Uploaded item" />
              {aiIdentified && (
                <div className="pw2-analyzed-label">✓ Photo analyzed</div>
              )}
            </div>
          )}

          {/* Right: AI fields */}
          <div>
            <div className="pw2-ai-pill">
              <Sparkle size={11} /> AI-ASSISTED
            </div>
            <p style={{ fontSize: 13.5, fontWeight: 700, color: "#111827", marginBottom: 4 }}>
              Confirm the details
            </p>
            <p className="pw2-ident-info">
              We analyzed your photo's colors, shape and setting. Confirm the item so buyers
              can find it and we can value it accurately.
            </p>
            {identifying ? (
              <div className="pw2-ident-skeleton" style={{ marginBottom: 8 }} />
            ) : (
              <div className="pw2-field">
                <label>ITEM NAME</label>
                <input className="pw2-input" value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Mid-century teak armchair" autoFocus />
              </div>
            )}
          </div>
        </div>

        {identifying ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            <div className="pw2-ident-skeleton" />
            <div className="pw2-ident-skeleton" style={{ width: "70%" }} />
          </div>
        ) : (
          <>
            <div className="pw2-row2" style={{ marginBottom: 14 }}>
              <div className="pw2-field" style={{ marginBottom: 0 }}>
                <label>CATEGORY</label>
                <select className="pw2-select" value={category}
                  onChange={e => handleCategoryChange(e.target.value)}>
                  {CATEGORIES.map(({ value, label }) =>
                    <option key={value} value={value}>{label}</option>
                  )}
                </select>
              </div>
              <div className="pw2-field" style={{ marginBottom: 0 }}>
                <label>CONDITION</label>
                <select className="pw2-select" value={condition}
                  onChange={e => setCondition(e.target.value)}>
                  {CONDITIONS.map(({ value, label }) =>
                    <option key={value} value={value}>{label}</option>
                  )}
                </select>
              </div>
            </div>

            <div className="pw2-field">
              <label>TAGS</label>
              <div className="pw2-tags" style={{ marginBottom: tags.length ? 8 : 0 }}>
                {tags.map(t => (
                  <span key={t} className="pw2-tag">
                    {t}
                    <button className="pw2-tag-rm" onClick={() => removeTag(t)}>×</button>
                  </span>
                ))}
              </div>
              <div className="pw2-tag-input-wrap">
                <input className="pw2-tag-input" value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  placeholder="Add a tag…"
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} />
                <button className="pw2-demo-btn" onClick={addTag}
                  style={{ padding: "3px 10px", fontSize: 12 }}>Add ⊕</button>
              </div>
            </div>
          </>
        )}

        {/* Duplicate check */}
        {(dupStatus !== "idle") && (
          <div className={`pw2-dup-panel ${dupStatus === "self" ? "self" : dupStatus}`}>
            <div style={{ flexShrink: 0, marginTop: 1 }}>
              {dupStatus === "checking" && <ShieldDot size={22} color="#4CAF50" />}
              {dupStatus === "passed"   && <ShieldCheck size={22} color="#16A34A" />}
              {dupStatus === "failed"   && <ShieldX size={22} color="#DC2626" />}
              {dupStatus === "self"     && <ShieldCheck size={22} color="#B45309" />}
            </div>
            <div className="pw2-dup-text" style={{ flex: 1 }}>
              {dupStatus === "checking" && (
                <>
                  <p>Checking for duplicate photos…</p>
                  <p>Comparing this image against existing listings (perceptual hash)</p>
                </>
              )}
              {dupStatus === "passed" && (
                <>
                  <p>Original photo — no duplicates found</p>
                  <p>This image doesn&rsquo;t match any active listing. You&rsquo;re good to go.</p>
                </>
              )}
              {dupStatus === "failed" && (
                <>
                  <p>Duplicate photo detected</p>
                  <p>This photo appears to already be in use on Baylo. Please use your own original photo.</p>
                </>
              )}
              {dupStatus === "self" && (
                <>
                  <p>Matches your own listing</p>
                  <p>This photo is similar to one of your existing posts — continuing anyway.</p>
                </>
              )}
            </div>
            {dupStatus === "passed" && (
              <span className="pw2-dup-passed-pill">✓ Passed</span>
            )}
          </div>
        )}
      </div>
    );
  }

  // Step 2 — Value
  function renderStep2() {
    if (valueSub === "intro") {
      return (
        <div className="pw2-value-center">
          <div className="pw2-globe-badge"><Globe size={32} /></div>
          <h3>Find a fair value with AI</h3>
          <p>
            We&rsquo;ll estimate a fair value range in Pasa Leaves from Baylo trade history
            and category averages, so you know what to ask in return.
          </p>
        </div>
      );
    }

    if (valueSub === "scanning") {
      return (
        <div className="pw2-value-center">
          <div className="pw2-globe-badge" style={{ animation: "pw2-pulse 1.4s ease-in-out infinite" }}>
            <Globe size={32} />
          </div>
          <h3>Scanning Baylo trades…</h3>
          <p>Checking completed swaps and category averages to estimate a fair value range.</p>
        </div>
      );
    }

    // Result
    const { min, max, midpoint } = valueRange;
    const hasRange = max > 0;
    const range = max - min || 1;
    const handlePct = ((midpoint - min) / range) * 100;

    return (
      <div>
        {/* Estimated value panel — only when a scan has been run */}
        {hasRange && (
          <div className="pw2-est-panel">
            <div className="pw2-est-header">
              <span><Sparkle size={11} /> AI SUGGESTED VALUE</span>
              <span>from {catLabel.toLowerCase()} history · edit freely below</span>
            </div>
            <div style={{ position: "relative", padding: "24px 0 4px" }}>
              <div className="pw2-est-bar">
                <div className="pw2-est-handle" style={{ left: `${handlePct}%` }}>
                  <div className="pw2-est-handle-label">{fmtLeaves(midpoint)}</div>
                </div>
              </div>
            </div>
            <div className="pw2-est-labels">
              <span>{fmtLeaves(min)}</span>
              <span>{fmtLeaves(max)}</span>
            </div>
          </div>
        )}

        {/* User asking value */}
        <div className="pw2-ask-card">
          <p className="pw2-ask-card-header">YOUR ASKING VALUE <span style={{ fontWeight: 400, textTransform: "none", fontSize: 11, color: "#9CA3AF" }}>{hasRange ? "— AI suggestion pre-filled, change it to whatever you want" : "— set your asking value in Leaves"}</span></p>
          <div className="pw2-ask-value-row">
            <input className="pw2-ask-pts-input"
              type="number" min={0} max={999999}
              value={userValue}
              onChange={e => setUserValue(Math.max(0, Number(e.target.value)))} />
            <span className="pw2-ask-pts-unit">Leaves</span>
          </div>
          {valueError && (
            <p style={{ fontSize: 12.5, color: "#B45309", marginTop: 4, marginBottom: 0 }}>
              {valueError}
            </p>
          )}
          {hasRange && (
            <>
              <input className="pw2-ask-slider"
                type="range" min={Math.max(0, min - Math.round(range * 0.2))}
                max={max + Math.round(range * 0.2)}
                value={userValue}
                onChange={e => setUserValue(Number(e.target.value))} />
              <p className={`pw2-ask-status ${valueOk ? "ok" : "warn"}`}>{valueStatus}</p>
            </>
          )}
        </div>

        {/* Comparables */}
        {comparables.length > 0 && (
          <div className="pw2-comps">
            <p className="pw2-comps-label">COMPARABLE LISTINGS</p>
            {comparables.map((c, i) => (
              <div key={i} className="pw2-comp-row">
                <div className="pw2-comp-left">
                  <p>{c.label}</p>
                  <p>{c.sublabel}</p>
                </div>
                <span className="pw2-comp-pts">{c.leaves}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Step 3 — Ask
  function renderStep3() {
    return (
      <div>
        {/* Offering card */}
        <p className="pw2-section-label" style={{ marginBottom: 8 }}>YOU&rsquo;RE OFFERING</p>
        <div className="pw2-offer-card">
          {images[0] ? (
            <div className="pw2-offer-thumb"><img src={images[0]} alt="Item" /></div>
          ) : (
            <div className="pw2-offer-thumb-ph"><ImageIcon size={22} color="#4CAF50" /></div>
          )}
          <div className="pw2-offer-info">
            <p>{title || "Your item"}</p>
            <p>{fmtLeaves(userValue)} · {catLabel}</p>
          </div>
        </div>

        {/* Wanted text */}
        <div className="pw2-field">
          <label>WHAT DO YOU WANT IN RETURN?</label>
          <textarea className="pw2-textarea" value={wantedText}
            onChange={e => setWantedText(e.target.value)}
            placeholder="Describe what you're after, or leave open to offers…" />
        </div>

        {/* AI suggestion chips */}
        <p style={{ fontSize: 12.5, color: "#6B7280", marginBottom: 6 }}>
          ✨ AI suggests items around {fmtLeaves(valueRange.min || userValue)} – {fmtLeaves(valueRange.max || userValue + 200)}:
        </p>
        <div className="pw2-chips" style={{ marginBottom: 18 }}>
          {askChips.map(chip => (
            <button key={chip} className="pw2-chip"
              onClick={() => setWantedText(prev => prev ? `${prev}, ${chip}` : chip)}>
              {chip}
            </button>
          ))}
        </div>

        {/* Pickup map */}
        <div className="pw2-field" style={{ marginBottom: 0 }}>
          <label>📍 PICKUP LOCATION</label>
          <PickupMap value={pickup} onChange={setPickup} />
        </div>
      </div>
    );
  }

  // Step 4 — Review
  function renderStep4() {
    const previewImages = parseImages(
      images.length > 0 ? JSON.stringify(images) : "[]"
    );
    const thumb = previewImages[0] ?? null;

    return (
      <div>
        <div className="pw2-review-ok">
          <Check size={14} color="#16A34A" />
          Looks great — here&rsquo;s how it&rsquo;ll appear in the Tradeplace.
        </div>

        <div className="pw2-review-split">
          {/* Left: preview card */}
          <div className="pw2-preview-card">
            <div className="pw2-preview-img">
              {thumb ? (
                <img src={thumb} alt={title} />
              ) : (
                <div style={{ width: "100%", height: "100%", background: "#E8F5E9",
                  display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <ImageIcon size={32} color="#4CAF50" />
                </div>
              )}
              <span className="pw2-preview-cond">{condLabel}</span>
              <span className="pw2-preview-new">~{fmtLeaves(userValue)}</span>
            </div>
            <div className="pw2-preview-body">
              <p className="pw2-preview-title">{title || "Your item"}</p>
              {wantedText && (
                <p className="pw2-preview-wants">Wants: {wantedText.slice(0, 50)}{wantedText.length > 50 ? "…" : ""}</p>
              )}
              <div className="pw2-preview-user">
                <div className="pw2-preview-avatar">
                  {me?.avatar
                    ? <img src={me.avatar} alt={me.name} />
                    : (me?.name?.charAt(0)?.toUpperCase() ?? "Y")}
                </div>
                <span className="pw2-preview-uname">{me?.name ?? "You"}</span>
                {(me?.rating ?? 0) > 0 && (
                  <span style={{ fontSize: 11, color: "#F59E0B", fontWeight: 600 }}>
                    ★ {(me!.rating!).toFixed(1)}
                  </span>
                )}
                <button className="pw2-btn-primary"
                  style={{ padding: "4px 10px", fontSize: 11, borderRadius: 8, marginLeft: "auto" }}>
                  Offer
                </button>
              </div>
            </div>
          </div>

          {/* Right: details table */}
          <dl className="pw2-details-table">
            {[
              ["Item",        title || "—"],
              ["Category",    catLabel],
              ["Condition",   condLabel],
              ["Your value",  fmtLeaves(userValue)],
              ["You want",    wantedText || "Open to offers"],
              ["Location",    pickup?.address ?? "Not set"],
              ["Visibility",  "Public · saved-search alerts on"],
            ].map(([dt, dd]) => (
              <div key={dt} className="pw2-detail-row">
                <dt>{dt}</dt>
                <dd>{dd}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Map preview */}
        {pickup && (
          <div className="pw2-review-map">
            <PickupMap value={pickup} onChange={() => {}} />
          </div>
        )}
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="pw2-overlay">
      <div className="pw2-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="pw2-header">
          <div className="pw2-header-brand">
            <div>
              <div className="pw2-header-title">
                <span className="pw2-sparkle"><Sparkle size={14} /></span>
                <h2>{isEdit ? "Edit listing" : "Post a trade"}</h2>
              </div>
              <p className="pw2-header-sub">
                {isEdit
                  ? "Update your item's details, photos, and asking value"
                  : "AI helps you identify it and set a fair value in Pasa Leaves"}
              </p>
            </div>
            <button className="pw2-close" onClick={confirmClose} aria-label="Close">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          {renderTabs()}
        </div>

        {/* Body */}
        <div className="pw2-body">
          {step === 0 && renderStep0()}
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
          {error && <div className="pw2-error">{error}</div>}
        </div>

        {/* Footer */}
        <div className="pw2-footer">
          <div className="pw2-footer-left">
            {step > 0 && (
              <button className="pw2-btn-back" onClick={() => { setError(""); setStep(s => s - 1); }}
                disabled={posting}>Back</button>
            )}
            {renderFooterStatus()}
          </div>
          <div className="pw2-footer-right">
            {step === 0 && !isEdit && (
              <button className="pw2-btn-primary" onClick={handleIdentifyWithAI}
                disabled={images.length === 0 || uploading}>
                {uploading
                  ? <><Spin size={13} color="#fff" /> Uploading…</>
                  : <><Sparkle size={13} /> Identify with AI</>}
              </button>
            )}
            {step === 0 && isEdit && photosUnchanged && (
              <button className="pw2-btn-primary"
                onClick={() => { setError(""); setStep(1); }}
                disabled={images.length === 0 || uploading}>
                Continue →
              </button>
            )}
            {step === 0 && isEdit && !photosUnchanged && (
              <>
                <button className="pw2-btn-back"
                  onClick={() => { setError(""); setStep(1); }}
                  disabled={images.length === 0 || uploading}>
                  Skip AI
                </button>
                <button className="pw2-btn-primary" onClick={handleIdentifyWithAI}
                  disabled={images.length === 0 || uploading}>
                  {uploading
                    ? <><Spin size={13} color="#fff" /> Uploading…</>
                    : <><Sparkle size={13} /> Identify with AI</>}
                </button>
              </>
            )}
            {step === 1 && (
              <button className="pw2-btn-primary"
                onClick={() => { setError(""); setStep(2); }}
                disabled={!canContinue}>
                Continue
              </button>
            )}
            {step === 2 && valueSub === "intro" && (
              <button className="pw2-btn-primary" onClick={scanValue}>
                🌐 Scan for value
              </button>
            )}
            {step === 2 && valueSub === "scanning" && (
              <button className="pw2-btn-primary" disabled>
                <Spin size={14} color="#fff" /> Scanning…
              </button>
            )}
            {step === 2 && valueSub === "result" && (
              <button className="pw2-btn-primary"
                onClick={() => { setError(""); setStep(3); }}>
                Continue
              </button>
            )}
            {step === 3 && (
              <button className="pw2-btn-primary"
                onClick={() => { setError(""); setStep(4); }}>
                Continue
              </button>
            )}
            {step === 4 && (
              <button className="pw2-btn-primary green" onClick={handlePost}
                disabled={posting}>
                {isEdit ? "✓ Save changes" : "⇄ Post to Tradeplace"}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
