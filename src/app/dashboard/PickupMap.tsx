"use client";
import { useEffect, useRef, useState } from "react";

export interface PickupLocation {
  lat: number;
  lng: number;
  address: string;
}

interface Props {
  value: PickupLocation | null;
  onChange: (loc: PickupLocation | null) => void;
}

const CEBU: [number, number] = [10.3157, 123.8854];

export default function PickupMap({ value, onChange }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  const [address, setAddress] = useState(value?.address ?? "");
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !mapEl.current || mapRef.current) return;

    // Inject Leaflet CSS once
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    import("leaflet").then((L) => {
      // Guard inside async: StrictMode fires two overlapping imports; the
      // second one must bail out after the first has claimed the container.
      if (mapRef.current) return;

      // Defensive reset: if a previous async resolved after cleanup (which
      // runs synchronously before remount), _leaflet_id may linger on the
      // DOM node — clear it so L.map() can re-initialise the container.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((mapEl.current as any)?._leaflet_id != null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mapEl.current as any)._leaflet_id = undefined;
      }

      // Fix default icon paths for bundlers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const center: [number, number] = value ? [value.lat, value.lng] : CEBU;
      const map = L.map(mapEl.current!, { zoomControl: true }).setView(center, 13);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;

      if (value) {
        markerRef.current = L.marker([value.lat, value.lng]).addTo(map);
      }

      if (!value && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 15),
          () => {}
        );
      }

      map.on("click", async (e: { latlng: { lat: number; lng: number } }) => {
        const { lat, lng } = e.latlng;
        placeMarker(L, map, lat, lng);
        const addr = await reverseGeocode(lat, lng);
        setAddress(addr);
        onChange({ lat, lng, address: addr });
      });
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  // run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function placeMarker(L: any, map: any, lat: number, lng: number) {
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
    } else {
      markerRef.current = L.marker([lat, lng]).addTo(map);
    }
  }

  async function reverseGeocode(lat: number, lng: number): Promise<string> {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
        { headers: { "Accept-Language": "en" } }
      );
      const d = await r.json();
      return d.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  }

  async function handleSearch() {
    if (!search.trim() || !mapRef.current) return;
    setSearching(true);
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(search)}&format=json&limit=1`,
        { headers: { "Accept-Language": "en" } }
      );
      const data = await r.json();
      if (data[0]) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        const addr: string = data[0].display_name;
        mapRef.current.setView([lat, lng], 15);
        const L = await import("leaflet");
        placeMarker(L, mapRef.current, lat, lng);
        setAddress(addr);
        onChange({ lat, lng, address: addr });
      }
    } catch {}
    setSearching(false);
  }

  function clearLocation() {
    markerRef.current?.remove();
    markerRef.current = null;
    setAddress("");
    onChange(null);
  }

  return (
    <div className="pickup-map-wrap">
      <div className="pickup-map-search">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSearch(); } }}
          placeholder="Search address…"
          className="modal-input"
        />
        <button type="button" onClick={handleSearch} disabled={searching} className="btn-soft sm">
          {searching ? "…" : "Go"}
        </button>
      </div>
      <div ref={mapEl} className="pickup-map" />
      {address ? (
        <div className="pickup-map-addr">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" /></svg>
          <span className="pickup-map-addr-text">{address}</span>
          <button type="button" className="link-btn" onClick={clearLocation}>Change</button>
        </div>
      ) : (
        <p className="pickup-map-hint">Click the map or search to drop a pin</p>
      )}
    </div>
  );
}
