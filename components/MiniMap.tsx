'use client';

import { useEffect, useRef, useState } from 'react';

export interface MapPoint {
  lat: number;
  lng: number;
  label?: string;
  color?: string;
  /** Номер остановки маршрута — рисуется внутри маркера вместо точки. */
  num?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getL = () => (typeof window !== 'undefined' ? (window as any).L : null);

// Лёгкая карта на Leaflet (CDN): рисует точки (+ опционально линию маршрута между ними)
// и подгоняет масштаб под них.
export default function MiniMap({
  points, height = 320, routeLine = false, path,
}: {
  points: MapPoint[];
  height?: number;
  /** Прямая линия между точками по порядку — фолбэк, пока не готов реальный путь по дорогам. */
  routeLine?: boolean;
  /** Путь по дорогам (например, из OSRM) — рисуется вместо прямой линии, если задан. */
  path?: [number, number][];
}) {
  const divRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  // Подгрузка Leaflet один раз.
  useEffect(() => {
    if (getL()) { setReady(true); return; }
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    let script = document.getElementById('leaflet-js') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      document.head.appendChild(script);
    }
    if (getL()) setReady(true);
    else script.addEventListener('load', () => setReady(true));
  }, []);

  // Инициализация карты.
  useEffect(() => {
    if (!ready || !divRef.current || mapRef.current) return;
    const L = getL();
    const map = L.map(divRef.current).setView([40.461, 71.755], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 150);
  }, [ready]);

  // Отрисовка точек + подгон масштаба.
  useEffect(() => {
    const L = getL();
    const map = mapRef.current;
    if (!L || !map) return;
    if (layerRef.current) layerRef.current.remove();
    const group = L.layerGroup();
    const valid = points.filter(p => typeof p.lat === 'number' && typeof p.lng === 'number' && !isNaN(p.lat) && !isNaN(p.lng));

    if (path && path.length > 1) {
      L.polyline(path, { color: '#2563eb', weight: 4, opacity: 0.75 }).addTo(group);
    } else if (routeLine && valid.length > 1) {
      L.polyline(valid.map(p => [p.lat, p.lng]), { color: '#2563eb', weight: 3, opacity: 0.6, dashArray: '6 6' }).addTo(group);
    }

    for (const p of valid) {
      const color = p.color || '#2563eb';
      let marker;
      if (p.num != null) {
        marker = L.marker([p.lat, p.lng], {
          icon: L.divIcon({
            className: '',
            html: `<div style="background:${color};color:#fff;width:24px;height:24px;border-radius:50%;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;box-shadow:0 1px 3px rgba(0,0,0,.4)">${p.num}</div>`,
            iconSize: [24, 24], iconAnchor: [12, 12],
          }),
        });
      } else {
        marker = L.circleMarker([p.lat, p.lng], {
          radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.9,
        });
      }
      if (p.label) marker.bindPopup(p.label);
      marker.addTo(group);
    }
    group.addTo(map);
    layerRef.current = group;
    if (valid.length === 1) {
      map.setView([valid[0].lat, valid[0].lng], 14);
    } else if (valid.length > 1) {
      map.fitBounds(L.latLngBounds(valid.map(p => [p.lat, p.lng])).pad(0.2), { maxZoom: 15 });
    }
    setTimeout(() => map.invalidateSize(), 100);
  }, [ready, points, routeLine, path]);

  return (
    <div
      ref={divRef}
      style={{ height }}
      className="relative z-0 w-full rounded-xl overflow-hidden border border-gray-200"
    />
  );
}
