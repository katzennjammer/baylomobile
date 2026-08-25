"use client";
import { useEffect, useRef } from "react";

export interface ListingPin {
  id: string;
  title: string;
  imageUrl: string | null;
  valueLeaves: number | null;
  lat: number;
  lng: number;
  userName: string;
  ownerId: string;
  condition: string;
  wantedLabel: string | null;
  userRating: number;
  category: string;
  greenScore: number;
}

interface Props {
  listings: ListingPin[];
  onSelect: (id: string) => void;
  currentUserId: string;
}

const CEBU: [number, number] = [10.3157, 123.8854];

const GRAD_PAIRS = [
  ["#4CAF50", "#1A3520"], ["#FF6BA3", "#7A1F47"], ["#27E0B3", "#0C5B49"],
  ["#FFB23E", "#7A3E0C"], ["#5CA8FF", "#16356B"], ["#FF7A59", "#6B1F16"],
  ["#B86BFF", "#3A1A6B"], ["#3EE0FF", "#0C4A5B"], ["#FF5C8A", "#6B163A"],
];
function seedHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function avatarGrad(name: string): [string, string] {
  const pair = GRAD_PAIRS[seedHash(name) % GRAD_PAIRS.length];
  return [pair[0], pair[1]];
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cloudinaryThumb(url: string, size = 96): string {
  return url.replace(/\/upload\//, `/upload/w_${size},h_${size},c_fill,q_auto,f_auto/`);
}

function buildPopup(item: ListingPin, currentUserId: string): string {
  const leaves = item.valueLeaves != null
    ? `~${item.valueLeaves.toLocaleString("en-US")} Leaves`
    : null;
  const [av1, av2] = avatarGrad(item.userName);
  const initial = item.userName.charAt(0).toUpperCase();

  const coverHtml = item.imageUrl
    ? `<img src="${esc(item.imageUrl)}" style="width:100%;height:100%;object-fit:cover;display:block;" />`
    : `<div style="width:100%;height:100%;background:linear-gradient(140deg,${av1},${av2});"></div>`;

  const wantedHtml = item.wantedLabel
    ? `<div style="font-size:11.5px;color:#4CAF50;margin-top:3px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">
        ⇄ Wants: ${esc(item.wantedLabel)}
       </div>`
    : `<div style="font-size:11.5px;color:#4CAF50;margin-top:3px;">⇄ Open to offers</div>`;

  const ratingHtml = item.userRating > 0
    ? `<div style="font-size:11px;color:#888;">&#9733; ${item.userRating.toFixed(1)}</div>`
    : "";

  const leavesHtml = leaves
    ? `<span style="background:#f5f5fa;color:#555;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;margin-left:6px;">${esc(leaves)}</span>`
    : "";

  const eyeIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>`;

  return `
    <div style="font-family:'Plus Jakarta Sans',system-ui,sans-serif;width:240px;border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 4px 20px rgba(0,0,0,.12);">
      <!-- Cover -->
      <div style="position:relative;height:128px;overflow:hidden;">
        ${coverHtml}
        <span style="position:absolute;top:8px;left:8px;background:rgba(0,0,0,.55);color:#fff;font-size:10px;font-weight:600;padding:3px 8px;border-radius:999px;backdrop-filter:blur(4px);">Open to offers</span>
      </div>
      ${leavesHtml ? `<div style="padding:10px 12px 0;">${leavesHtml}</div>` : ""}
      <!-- Title + wants -->
      <div style="padding:6px 12px 6px;">
        <div style="font-size:13.5px;font-weight:700;color:#111116;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${esc(item.title)}</div>
        ${wantedHtml}
      </div>
      <!-- Trader row -->
      <div style="padding:0 12px 8px;display:flex;align-items:center;gap:8px;">
        <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,${av1},${av2});display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:11px;flex-shrink:0;">${esc(initial)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;font-weight:600;color:#111116;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${esc(item.userName)}</div>
          ${ratingHtml}
        </div>
        <span style="font-size:11px;color:#27ae60;font-weight:600;flex-shrink:0;display:inline-flex;align-items:center;gap:3px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#27ae60" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z"/><path d="M2 21c0-3 1.85-5.4 5.1-6"/></svg>Green ${item.greenScore}</span>
      </div>
      <!-- Divider -->
      <div style="height:1px;background:#f0f0f5;"></div>
      <!-- Action row -->
      <div style="padding:10px 12px;display:flex;justify-content:space-between;align-items:center;">
        <button data-tap="${esc(item.id)}" style="background:none;border:0;padding:0;font-size:12px;color:#555;cursor:pointer;display:flex;align-items:center;gap:5px;font-family:inherit;">
          ${eyeIcon} Tap for details
        </button>
        ${item.ownerId === currentUserId
          ? `<span style="font-size:12px;color:#888;font-style:italic;">This is your listing</span>`
          : `<button data-offer="${esc(item.id)}" style="background:#4CAF50;color:#1A3520;border:0;padding:5px 13px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">Make offer</button>`
        }
      </div>
    </div>`;
}

export default function ListingsMap({ listings, onSelect, currentUserId }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !mapEl.current || mapRef.current) return;

    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    import("leaflet").then((L) => {
      if (mapRef.current || !mapEl.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(mapEl.current!, { zoomControl: true }).setView(CEBU, 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;

      listings.forEach((item) => {
        const thumbUrl = item.imageUrl ? cloudinaryThumb(item.imageUrl, 96) : null;
        // Counter-rotate the image 45deg inside the -45deg rotated pin so it appears upright.
        // Width/height 48px (> 34*√2≈48) ensures the image fills the teardrop corner-to-corner.
        const imgHtml = thumbUrl
          ? `<img src="${esc(thumbUrl)}" style="width:48px;height:48px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(45deg);object-fit:cover;display:block;" onerror="this.style.display='none';" />`
          : "";

        const pinIcon = L.divIcon({
          className: "",
          html: `<div style="width:34px;height:34px;position:relative;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#4CAF50;border:2px solid #fff;overflow:hidden;box-shadow:0 3px 10px rgba(0,0,0,.35);cursor:pointer;">${imgHtml}</div>`,
          iconSize: [34, 34],
          iconAnchor: [17, 34],
          popupAnchor: [0, -36],
        });

        const marker = L.marker([item.lat, item.lng], { icon: pinIcon }).addTo(map);
        const popup = L.popup({ maxWidth: 260, minWidth: 240, className: "tp-leaflet-popup", autoPan: true })
          .setContent(buildPopup(item, currentUserId));

        marker.bindPopup(popup);
        marker.on("popupopen", () => {
          setTimeout(() => {
            const tapBtn = document.querySelector<HTMLButtonElement>(`[data-tap="${item.id}"]`);
            const offerBtn = document.querySelector<HTMLButtonElement>(`[data-offer="${item.id}"]`);
            const handler = () => { marker.closePopup(); onSelect(item.id); };
            if (tapBtn) tapBtn.addEventListener("click", handler);
            if (offerBtn) offerBtn.addEventListener("click", handler);
          }, 0);
        });
      });
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={mapEl} className="tp-map-el" />
  );
}
