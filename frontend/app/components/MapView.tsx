'use client';

import 'leaflet/dist/leaflet.css';

import { useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, CircleMarker, Popup } from 'react-leaflet';

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

const pinIcon =
  typeof window === 'undefined'
    ? undefined
    : new L.Icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
      });

// Carte : tuiles Mapbox si un token est fourni, sinon OpenStreetMap (gratuit, sans clé).
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Un « path » de style Mapbox = "compte/id_style" (ex. "mapbox/dark-v11" ou "cyrilh/cmewq...").
function normalizeStylePath(raw: string): string {
  const v = (raw || '').replace(/^mapbox:\/\/styles\//, '').trim();
  return v.includes('/') ? v : `mapbox/${v}`;
}

// Style personnalisé (créé dans Mapbox Studio) : configurable via env, avec valeur par défaut.
const CUSTOM_STYLE = normalizeStylePath(
  process.env.NEXT_PUBLIC_MAPBOX_CUSTOM_STYLE || 'cyrilh/cmewqxmu4002u01segssr9is7',
);
const CUSTOM_LABEL = process.env.NEXT_PUBLIC_MAPBOX_CUSTOM_LABEL || 'Manager';

const DEFAULT_STYLE = normalizeStylePath(
  process.env.NEXT_PUBLIC_MAPBOX_STYLE || 'dark-v11',
);

// Styles proposés dans le sélecteur (le style perso en premier).
const MAPBOX_STYLES: { path: string; label: string }[] = [
  ...(CUSTOM_STYLE ? [{ path: CUSTOM_STYLE, label: CUSTOM_LABEL }] : []),
  { path: 'mapbox/dark-v11', label: 'Sombre' },
  { path: 'mapbox/navigation-night-v1', label: 'Nuit' },
  { path: 'mapbox/light-v11', label: 'Clair' },
  { path: 'mapbox/streets-v12', label: 'Rues' },
  { path: 'mapbox/satellite-streets-v12', label: 'Satellite' },
];

// Styles de marqueurs proposés à l'utilisateur.
const MARKER_STYLES: { id: string; label: string }[] = [
  { id: 'dot', label: 'Points' },
  { id: 'ring', label: 'Ronds' },
  { id: 'score', label: 'Score' },
  { id: 'pin', label: 'Épingles' },
];
const DEFAULT_MARKER = process.env.NEXT_PUBLIC_MAP_MARKER || 'dot';

function tileFor(stylePath: string) {
  if (MAPBOX_TOKEN) {
    return {
      url: `https://api.mapbox.com/styles/v1/${stylePath}/tiles/512/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
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

// Couleur du marqueur selon le score (vert = top, orange = moyen, rouge = plus faible).
function scoreColor(score?: number): string {
  const s = typeof score === 'number' ? score : 0;
  if (s >= 85) return '#22c55e';
  if (s >= 70) return '#eab308';
  return '#f43f5e';
}

function scoreDivIcon(score: number | undefined, color: string) {
  const val = typeof score === 'number' ? Math.round(score) : '';
  return L.divIcon({
    className: 'panel-score-marker',
    html:
      `<div style="width:26px;height:26px;border-radius:9999px;background:${color};` +
      `border:2px solid rgba(255,255,255,.85);box-shadow:0 1px 5px rgba(0,0,0,.45);` +
      `display:flex;align-items:center;justify-content:center;color:#fff;` +
      `font-size:11px;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,.5)">${val}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });
}

function PanelPopup({ p }: { p: Panel }) {
  return (
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
  );
}

function renderMarker(p: Panel, style: string) {
  const color = scoreColor(p.smart_score);
  const key = `${p.panel_id}-${style}`;

  if (style === 'pin') {
    return (
      <Marker key={key} position={[p.latitude, p.longitude]} icon={pinIcon as any}>
        <PanelPopup p={p} />
      </Marker>
    );
  }

  if (style === 'score') {
    return (
      <Marker key={key} position={[p.latitude, p.longitude]} icon={scoreDivIcon(p.smart_score, color)}>
        <PanelPopup p={p} />
      </Marker>
    );
  }

  const ring = style === 'ring';
  return (
    <CircleMarker
      key={key}
      center={[p.latitude, p.longitude]}
      radius={ring ? 7 : 6}
      pathOptions={{
        color,
        fillColor: color,
        weight: ring ? 2 : 1,
        opacity: 0.95,
        fillOpacity: ring ? 0.15 : 0.85,
      }}
    >
      <PanelPopup p={p} />
    </CircleMarker>
  );
}

function MapSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2 justify-end">
      <span className="hidden sm:inline text-[11px] text-white/70 bg-black/50 rounded-lg px-2 py-1 backdrop-blur">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="rounded-lg bg-black/70 border border-white/20 text-white text-xs px-2.5 py-1.5 backdrop-blur outline-none cursor-pointer hover:border-cyan-300/60 focus:border-cyan-400"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#0b1220] text-white">
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function MapView({ panels }: { panels: Panel[] }) {
  const [style, setStyle] = useState<string>(DEFAULT_STYLE);
  const [marker, setMarker] = useState<string>(DEFAULT_MARKER);

  const center: [number, number] =
    panels.length > 0
      ? [panels[0].latitude, panels[0].longitude]
      : [48.8566, 2.3522]; // Paris

  const tile = tileFor(style);

  return (
    <div className="relative h-[420px] rounded-3xl overflow-hidden bg-black/20 border border-white/10">
      <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-2">
        {MAPBOX_TOKEN && (
          <MapSelect
            label="Thème"
            value={style}
            onChange={setStyle}
            options={MAPBOX_STYLES.map((s) => ({ value: s.path, label: s.label }))}
          />
        )}
        <MapSelect
          label="Marqueurs"
          value={marker}
          onChange={setMarker}
          options={MARKER_STYLES.map((s) => ({ value: s.id, label: s.label }))}
        />
      </div>

      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom={true}
        preferCanvas={true}
        className="h-full w-full"
      >
        <TileLayer
          key={style}
          attribution={tile.attribution}
          url={tile.url}
          tileSize={tile.tileSize}
          zoomOffset={tile.zoomOffset}
        />
        {panels.slice(0, 200).map((p) => renderMarker(p, marker))}
      </MapContainer>
    </div>
  );
}
