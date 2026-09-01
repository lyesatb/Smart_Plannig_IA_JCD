'use client';

import 'leaflet/dist/leaflet.css';

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

// Style de carte : Mapbox (dark) si un token est fourni, sinon OpenStreetMap (gratuit, sans clé).
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
// Style Mapbox : "dark-v11" pour coller au thème sombre. Change en "streets-v12",
// "satellite-streets-v12", "navigation-night-v1"… si tu préfères.
const MAPBOX_STYLE = process.env.NEXT_PUBLIC_MAPBOX_STYLE || 'dark-v11';

const tileConfig = MAPBOX_TOKEN
  ? {
      url: `https://api.mapbox.com/styles/v1/mapbox/${MAPBOX_STYLE}/tiles/512/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
      attribution:
        '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      tileSize: 512,
      zoomOffset: -1,
    }
  : {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      tileSize: 256,
      zoomOffset: 0,
    };

export function MapView({ panels }: { panels: Panel[] }) {
  const center: [number, number] =
    panels.length > 0
      ? [panels[0].latitude, panels[0].longitude]
      : [48.8566, 2.3522]; // Paris

  return (
    <div className="relative h-[420px] rounded-3xl overflow-hidden bg-black/20 border border-white/10">
      <MapContainer center={center} zoom={12} scrollWheelZoom={true} className="h-full w-full">
        <TileLayer
          attribution={tileConfig.attribution}
          url={tileConfig.url}
          tileSize={tileConfig.tileSize}
          zoomOffset={tileConfig.zoomOffset}
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

