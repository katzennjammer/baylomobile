"use client";
import { useEffect, useRef } from "react";

interface Props {
  lat: number;
  lng: number;
}

export default function PickupMiniMap({ lat, lng }: Props) {
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

      const map = L.map(mapEl.current!, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
      }).setView([lat, lng], 15);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;

      const pinIcon = L.divIcon({
        className: "",
        html: `<div style="
          width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
          background:#4CAF50;border:2px solid #fff;
          box-shadow:0 2px 8px rgba(0,0,0,.28);
        "></div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 26],
      });

      L.marker([lat, lng], { icon: pinIcon }).addTo(map);
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  // coords are props; re-init if they change by relying on the key set by parent
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={mapEl} className="tp-mini-map" />;
}
