'use client';

import 'leaflet/dist/leaflet.css';

import { useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';

type Panel = {
  panel_id: string;
  city: string;
  latitude: number;
  longitude: number;
  district: string;
  format: string;
  poi_nearby: string;
  smart_score?: number;
};

const markerIcon =
  typeof window === 'undefined'
    ? undefined
    : new L.Icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
      });

// Carte : tuiles Mapbox si un token est fourni, sinon OpenStreetMap (gratuit, sans clé).
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const DEFAULT_STYLE = process.env.NEXT_PUBLIC_MAPBOX_STYLE || 'dark-v11';

// Styles Mapbox proposés à l'utilisateur (sélecteur dans la carte).
const MAPBOX_STYLES: { id: string; label: string }[] = [
  { id: 'dark-v11', label: 'Sombre' },
  { id: 'navigation-night-v1', label: 'Nuit' },
  { id: 'light-v11', label: 'Clair' },
  { id: 'streets-v12', label: 'Rues' },
  { id: 'satellite-streets-v12', label: 'Satellite' },
];

function tileFor(style: string) {
  if (MAPBOX_TOKEN) {
    return {
      url: `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/512/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
      attribution:
        '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      tileSize: 512,
      zoomOffset: -1,
    };
  }
  return {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    tileSize: 256,
    zoomOffset: 0,
  };
}

export function MapView({ panels }: { panels: Panel[] }) {
  const [style, setStyle] = useState<string>(DEFAULT_STYLE);

  const center: [number, number] =
    panels.length > 0
      ? [panels[0].latitude, panels[0].longitude]
      : [48.8566, 2.3522]; // Paris

  const tile = tileFor(style);

  return (
    <div className="relative h-[420px] rounded-3xl overflow-hidden bg-black/20 border border-white/10">
      {MAPBOX_TOKEN && (
        <div className="absolute top-3 right-3 z-[1000] flex items-center gap-2">
          <span className="hidden sm:inline text-[11px] text-white/70 bg-black/50 rounded-lg px-2 py-1 backdrop-blur">
            Thème
          </span>
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            aria-label="Thème de la carte"
            className="rounded-lg bg-black/70 border border-white/20 text-white text-xs px-2.5 py-1.5 backdrop-blur outline-none cursor-pointer hover:border-cyan-300/60 focus:border-cyan-400"
          >
            {MAPBOX_STYLES.map((s) => (
              <option key={s.id} value={s.id} className="bg-[#0b1220] text-white">
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <MapContainer center={center} zoom={12} scrollWheelZoom={true} className="h-full w-full">
        <TileLayer
          key={style}
          attribution={tile.attribution}
          url={tile.url}
          tileSize={tile.tileSize}
          zoomOffset={tile.zoomOffset}
        />
        {panels.slice(0, 200).map((p) => (
          <Marker
            key={p.panel_id}
            position={[p.latitude, p.longitude]}
            icon={markerIcon as any}
          >
            <Popup>
              <div className="text-sm">
                <div className="font-semibold">
                  {p.city} — {p.district}
                </div>
                <div className="opacity-80">
                  {p.format} · POI: {p.poi_nearby}
                </div>
                {typeof p.smart_score === 'number' && (
                  <div className="mt-1">
                    Score: <b>{p.smart_score}</b>
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
