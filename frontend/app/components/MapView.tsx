'use client';

import 'leaflet/dist/leaflet.css';

import { useEffect, useState } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, CircleMarker, Popup, useMap } from 'react-leaflet';

type Panel = {
  panel_id: string;
  city: string;
  latitude: number;
  longitude: number;
  district: string;
  format: string;
  poi_nearby: string;
  daily_traffic?: number;
  impressions?: number;
  distance_m?: number | null;
  nearest_store?: string | null;
  arrondissement?: number | null;
};

export type Store = {
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  arrondissement?: number | null;
};

// Bleu marine JCDecaux pour les faces ; rouge pour les magasins de l'enseigne.
const NAVY = '#1e3a8a';
const STORE_RED = '#b91c1c';

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

function normalizeStylePath(raw: string): string {
  const v = (raw || '').replace(/^mapbox:\/\/styles\//, '').trim();
  return v.includes('/') ? v : `mapbox/${v}`;
}

const CUSTOM_STYLE = normalizeStylePath(
  process.env.NEXT_PUBLIC_MAPBOX_CUSTOM_STYLE || 'cyrilh/cmewqxmu4002u01segssr9is7',
);
const CUSTOM_LABEL = process.env.NEXT_PUBLIC_MAPBOX_CUSTOM_LABEL || 'JCDecaux';
const DEFAULT_STYLE = normalizeStylePath(process.env.NEXT_PUBLIC_MAPBOX_STYLE || 'light-v11');

const MAPBOX_STYLES: { path: string; label: string }[] = [
  ...(CUSTOM_STYLE ? [{ path: CUSTOM_STYLE, label: CUSTOM_LABEL }] : []),
  { path: 'mapbox/light-v11', label: 'Clair' },
  { path: 'mapbox/streets-v12', label: 'Rues' },
  { path: 'mapbox/dark-v11', label: 'Sombre' },
  { path: 'mapbox/satellite-streets-v12', label: 'Satellite' },
];

const MARKER_STYLES: { id: string; label: string }[] = [
  { id: 'dot', label: 'Points' },
  { id: 'ring', label: 'Ronds' },
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

function fmtInt(n?: number | null) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('fr-FR').format(Math.round(n));
}

const storeIcon =
  typeof window === 'undefined'
    ? undefined
    : L.divIcon({
        className: 'store-marker',
        html:
          `<div style="width:16px;height:16px;border-radius:4px;background:${STORE_RED};` +
          `border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        popupAnchor: [0, -10],
      });

function PanelPopup({ p }: { p: Panel }) {
  return (
    <Popup>
      <div className="text-sm">
        <div className="font-semibold">
          {p.format} — {p.city}
          {p.arrondissement ? ` ${p.arrondissement}e` : ''}
        </div>
        <div className="opacity-80">{p.district}</div>
        {p.distance_m != null && (
          <div className="mt-1">
            <b>{fmtInt(p.distance_m)} m</b> du {p.nearest_store || 'magasin'}
          </div>
        )}
        {typeof p.daily_traffic === 'number' && (
          <div className="mt-1">
            Audience : <b>{fmtInt(p.daily_traffic)}</b> passages/jour
            {typeof p.impressions === 'number' ? ` · ≈ ${fmtInt(p.impressions)} impressions` : ''}
          </div>
        )}
      </div>
    </Popup>
  );
}

function renderMarker(p: Panel, style: string) {
  const key = `${p.panel_id}-${style}`;
  if (style === 'pin') {
    return (
      <Marker key={key} position={[p.latitude, p.longitude]} icon={pinIcon as any}>
        <PanelPopup p={p} />
      </Marker>
    );
  }
  const ring = style === 'ring';
  return (
    <CircleMarker
      key={key}
      center={[p.latitude, p.longitude]}
      radius={ring ? 8 : 7}
      pathOptions={{
        color: NAVY,
        fillColor: NAVY,
        weight: ring ? 2.5 : 1.5,
        opacity: 0.95,
        fillOpacity: ring ? 0.15 : 0.9,
      }}
    >
      <PanelPopup p={p} />
    </CircleMarker>
  );
}

/** Recentre / recadre la carte quand le dispositif change. */
function FitBounds({ panels, stores }: { panels: Panel[]; stores: Store[] }) {
  const map = useMap();
  useEffect(() => {
    const pts: [number, number][] = [
      ...panels.map((p) => [p.latitude, p.longitude] as [number, number]),
      ...stores.map((s) => [s.latitude, s.longitude] as [number, number]),
    ];
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.setView(pts[0], 14);
      return;
    }
    map.fitBounds(L.latLngBounds(pts), { padding: [32, 32], maxZoom: 15 });
  }, [map, panels, stores]);
  return null;
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
      <span className="hidden sm:inline text-[11px] text-[#1f5f7f] bg-white/90 rounded-md px-2 py-1 shadow">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="rounded-md bg-white/95 border border-[#1f5f7f]/30 text-[#0f2a3a] text-xs px-2.5 py-1.5 shadow outline-none cursor-pointer hover:border-[#1f5f7f]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function MapView({
  panels,
  stores = [],
  height = 520,
}: {
  panels: Panel[];
  stores?: Store[];
  height?: number;
}) {
  const [style, setStyle] = useState<string>(DEFAULT_STYLE);
  const [marker, setMarker] = useState<string>(DEFAULT_MARKER);

  const center: [number, number] =
    panels.length > 0 ? [panels[0].latitude, panels[0].longitude] : [48.8566, 2.3522];

  const tile = tileFor(style);

  return (
    <div
      className="relative rounded-md overflow-hidden bg-[#dfe6ea] border border-[#1f5f7f]/20"
      style={{ height }}
    >
      <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-2">
        {MAPBOX_TOKEN && (
          <MapSelect
            label="Fond"
            value={style}
            onChange={setStyle}
            options={MAPBOX_STYLES.map((s) => ({ value: s.path, label: s.label }))}
          />
        )}
        <MapSelect
          label="Faces"
          value={marker}
          onChange={setMarker}
          options={MARKER_STYLES.map((s) => ({ value: s.id, label: s.label }))}
        />
      </div>

      {stores.length > 0 && (
        <div className="absolute bottom-3 left-3 z-[1000] flex items-center gap-3 text-[11px] bg-white/90 rounded-md px-2.5 py-1.5 shadow text-[#0f2a3a]">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: NAVY }} /> Faces
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: STORE_RED }} /> Magasins
          </span>
        </div>
      )}

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
        <FitBounds panels={panels} stores={stores} />
        {stores.map((s, i) => (
          <Marker key={`store-${i}`} position={[s.latitude, s.longitude]} icon={storeIcon as any}>
            <Popup>
              <div className="text-sm">
                <div className="font-semibold">{s.name}</div>
                {s.address && <div className="opacity-80">{s.address}</div>}
              </div>
            </Popup>
          </Marker>
        ))}
        {panels.slice(0, 200).map((p) => renderMarker(p, marker))}
      </MapContainer>
    </div>
  );
}
