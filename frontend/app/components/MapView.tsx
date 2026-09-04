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
  address?: string | null;
};

export type Store = {
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
  arrondissement?: number | null;
};

// Faces = couleur JCDecaux (navy) ; magasins = rouge JCDecaux.
const FACE = '#265aa0';
const STORE = '#e2001a';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

function normalizeStylePath(raw: string): string {
  const v = (raw || '').replace(/^mapbox:\/\/styles\//, '').trim();
  return v.includes('/') ? v : `mapbox/${v}`;
}

const CUSTOM_STYLE = normalizeStylePath(
  process.env.NEXT_PUBLIC_MAPBOX_CUSTOM_STYLE || 'cyrilh/cmewqxmu4002u01segssr9is7',
);
const CUSTOM_LABEL = process.env.NEXT_PUBLIC_MAPBOX_CUSTOM_LABEL || 'JCDecaux';

const STYLE_OPTIONS: { value: string; label: string }[] = [
  ...(MAPBOX_TOKEN ? [{ value: CUSTOM_STYLE, label: CUSTOM_LABEL }] : []),
  { value: 'carto', label: 'Clair' },
  ...(MAPBOX_TOKEN
    ? [
        { value: 'mapbox/dark-v11', label: 'Sombre' },
        { value: 'mapbox/satellite-streets-v12', label: 'Satellite' },
      ]
    : [{ value: 'osm', label: 'OSM' }]),
];
// Carte du manager (style Mapbox custom) par défaut si un token est présent ; sinon CARTO clair.
const DEFAULT_STYLE = MAPBOX_TOKEN ? CUSTOM_STYLE : 'carto';

const MARKER_OPTIONS = [
  { value: 'dot', label: 'Points' },
  { value: 'ring', label: 'Ronds' },
  { value: 'pin', label: 'Épingles' },
];
const DEFAULT_MARKER = process.env.NEXT_PUBLIC_MAP_MARKER || 'dot';

// Magasins = carré rouge (comme la maquette).
const storeIcon =
  typeof window === 'undefined'
    ? undefined
    : L.divIcon({
        className: 'store-square',
        html:
          `<div style="width:14px;height:14px;background:${STORE};` +
          `border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        popupAnchor: [0, -8],
      });

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

function tileFor(style: string) {
  if (style === 'osm') {
    return {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      tileSize: 256,
      zoomOffset: 0,
      subdomains: 'abc',
    };
  }
  if (style === 'carto' || !MAPBOX_TOKEN) {
    return {
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      attribution:
        '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      tileSize: 256,
      zoomOffset: 0,
      subdomains: 'abcd',
    };
  }
  return {
    url: `https://api.mapbox.com/styles/v1/${style}/tiles/512/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
    attribution:
      '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; OpenStreetMap',
    tileSize: 512,
    zoomOffset: -1,
    subdomains: 'abc',
  };
}

function fmtInt(n?: number | null) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('fr-FR').format(Math.round(n));
}

function PanelPopup({ p }: { p: Panel }) {
  return (
    <Popup>
      <div className="text-sm">
        <div className="font-semibold">{p.address || 'Panneau'}</div>
        <div className="opacity-80">
          {p.city}
          {p.arrondissement ? ` ${p.arrondissement}e` : ''}
        </div>
        {p.distance_m != null && (
          <div className="mt-1">
            <b>{fmtInt(p.distance_m)} m</b> du {p.nearest_store || 'magasin'}
          </div>
        )}
        {typeof p.daily_traffic === 'number' && (
          <div className="mt-1">
            {fmtInt(p.daily_traffic)} passages/jour
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
      radius={9}
      pathOptions={{
        color: '#fff',
        weight: 2,
        fillColor: FACE,
        fillOpacity: ring ? 0.2 : 0.92,
      }}
    >
      <PanelPopup p={p} />
    </CircleMarker>
  );
}

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
    map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 15 });
  }, [map, panels, stores]);
  return null;
}

export function MapView({
  panels,
  stores = [],
  height = 460,
  showToolbar = true,
}: {
  panels: Panel[];
  stores?: Store[];
  height?: number;
  showToolbar?: boolean;
}) {
  const [style, setStyle] = useState<string>(DEFAULT_STYLE);
  const [marker, setMarker] = useState<string>(DEFAULT_MARKER);

  const center: [number, number] =
    panels.length > 0 ? [panels[0].latitude, panels[0].longitude] : [48.8435, 2.2985];

  const tile = tileFor(style);

  return (
    <div>
      {/* Toolbar */}
      {showToolbar && (
        <div
          className="flex items-center justify-end gap-2"
          style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-alt)',
          }}
        >
          <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 500 }}>Fond</label>
          <select value={style} onChange={(e) => setStyle(e.target.value)} className="fig-select fig-select-sm" style={{ width: 'auto' }}>
            {STYLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <label style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: 500 }}>Faces</label>
          <select value={marker} onChange={(e) => setMarker(e.target.value)} className="fig-select fig-select-sm" style={{ width: 'auto' }}>
            {MARKER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Map */}
      <div style={{ height, position: 'relative' }}>
        <MapContainer center={center} zoom={14} scrollWheelZoom preferCanvas className="h-full w-full">
          <TileLayer
            key={style}
            attribution={tile.attribution}
            url={tile.url}
            tileSize={tile.tileSize}
            zoomOffset={tile.zoomOffset}
            subdomains={tile.subdomains}
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
          {panels.slice(0, 300).map((p) => renderMarker(p, marker))}
        </MapContainer>

        {/* Légende */}
        <div
          className="absolute z-[999] flex items-center gap-3.5"
          style={{
            bottom: 14,
            left: 14,
            background: 'rgba(255,255,255,0.95)',
            backdropFilter: 'blur(8px)',
            borderRadius: 8,
            padding: '7px 12px',
            boxShadow: 'var(--shadow-md)',
            border: '1px solid var(--border)',
          }}
        >
          <span className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: FACE, boxShadow: '0 0 0 2px #fff' }} />
            <span style={{ fontSize: '11.5px', color: 'var(--text-primary)', fontWeight: 500 }}>Faces</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span style={{ width: 10, height: 10, borderRadius: 2, background: STORE, boxShadow: '0 0 0 2px #fff' }} />
            <span style={{ fontSize: '11.5px', color: 'var(--text-primary)', fontWeight: 500 }}>Magasins</span>
          </span>
        </div>
      </div>
    </div>
  );
}
