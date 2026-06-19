'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import AdminGate from '@/components/AdminGate';
import { listShops, listDeliveries, Shop, Delivery } from '@/lib/api';

const TYPE_ICON: Record<string, string> = { warehouse: '🏭', shop: '🏪' };
const TYPE_COLOR: Record<string, string> = { warehouse: '#185FA5', shop: '#0F6E56' };
const DIR_DOT: Record<string, string> = {
  'Север': 'bg-blue-100 text-blue-700',
  'Юг': 'bg-green-100 text-green-700',
  'Восток': 'bg-orange-100 text-orange-700',
  'Запад': 'bg-purple-100 text-purple-700',
  'Центр': 'bg-amber-100 text-amber-700',
};

export default function MapPage() {
  return (
    <AdminGate min="manager">
      <MapContent />
    </AdminGate>
  );
}

function MapContent() {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<unknown>(null);
  const markersRef = useRef<unknown[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [geocodeMap, setGeocodeMap] = useState<Record<string, [number, number]>>({});
  const [geocoding, setGeocoding] = useState<string | null>(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([listShops(), listDeliveries()])
      .then(([s, d]) => {
        setShops(s);
        setDeliveries(d.filter((x) => !['delivered', 'returned'].includes(x.status)));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getL = () => (window as any).L;

  useEffect(() => {
    if (getL()) { setLeafletReady(true); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => setLeafletReady(true);
    document.head.appendChild(script);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!leafletReady || !mapDivRef.current || mapRef.current) return;
    const L = getL();
    const map = L.map(mapDivRef.current).setView([40.461, 71.755], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletReady]);

  const renderMarkers = useCallback(() => {
    const L = getL();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any;
    if (!L || !map) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (markersRef.current as any[]).forEach((m) => m.remove());
    markersRef.current = [];
    const coords: [number, number][] = [];

    shops.filter((s) => s.lat && s.lng).forEach((shop) => {
      const color = TYPE_COLOR[shop.type || 'shop'] || '#5F5E5A';
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:${color};color:#fff;font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;white-space:nowrap;border:2px solid rgba(255,255,255,0.85);box-shadow:0 2px 6px rgba(0,0,0,0.25);">${TYPE_ICON[shop.type || 'shop'] || '📍'} ${shop.name}</div>`,
        iconAnchor: [0, 14],
      });
      L.marker([shop.lat!, shop.lng!], { icon })
        .addTo(map)
        .bindPopup(
          `<b>${shop.name}</b><br>${shop.address || ''}<br>` +
          `${shop.direction}${shop.km ? ` · ${shop.km} км` : ''}<br>` +
          `<small style="color:#888">${shop.lat!.toFixed(5)}, ${shop.lng!.toFixed(5)}</small>`
        );
      coords.push([shop.lat!, shop.lng!]);
    });

    Object.entries(geocodeMap).forEach(([id, [lat, lng]]) => {
      const d = deliveries.find((x) => x.id === id);
      if (!d) return;
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:#D85A30;color:#fff;font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;white-space:nowrap;border:2px solid rgba(255,255,255,0.85);box-shadow:0 2px 6px rgba(0,0,0,0.25);">📦 ${d.client_name || 'Доставка'}</div>`,
        iconAnchor: [0, 14],
      });
      L.marker([lat, lng], { icon })
        .addTo(map)
        .bindPopup(`<b>${d.client_name || '—'}</b><br>${d.address}`);
      coords.push([lat, lng]);
    });

    if (coords.length > 0) {
      map.fitBounds(L.latLngBounds(coords).pad(0.3));
    }
  }, [shops, deliveries, geocodeMap]);

  useEffect(() => {
    if (leafletReady && mapRef.current) renderMarkers();
  }, [leafletReady, renderMarkers]);

  async function geocodeDelivery(d: Delivery) {
    if (!d.address || geocoding) return;
    setGeocoding(d.id);
    try {
      const q = encodeURIComponent(`${d.address}, Андижан, Узбекистан`);
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`, {
        headers: { 'Accept-Language': 'ru' },
      });
      const data = await res.json() as { lat: string; lon: string }[];
      if (data.length > 0) {
        setGeocodeMap((prev) => ({ ...prev, [d.id]: [parseFloat(data[0].lat), parseFloat(data[0].lon)] }));
      }
    } catch { /* ignore */ }
    finally { setGeocoding(null); }
  }

  const shopsOnMap = shops.filter((s) => s.lat && s.lng);
  const shopsNoCoord = shops.filter((s) => !s.lat || !s.lng);
  const activeWithAddr = deliveries.filter((d) => d.address);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Link href="/logistics" className="text-sm text-gray-500 hover:text-gray-700">← Логистика</Link>
        <h2 className="text-xl font-bold ml-1">🗺️ Карта доставок</h2>
        <Link href="/logistics/shops" className="ml-auto text-xs text-blue-500 hover:underline">
          + Добавить точку →
        </Link>
      </div>

      {/* Map */}
      <div
        ref={mapDivRef}
        className="rounded-xl border border-gray-200 overflow-hidden mb-3"
        style={{ height: 480 }}
      />

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-xs text-gray-500 flex-wrap">
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-600 mr-1 align-middle" />Склад (база)</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-600 mr-1 align-middle" />Магазин</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500 mr-1 align-middle" />Доставка</span>
        <span className="ml-auto text-gray-400">Кликни на маркер — подробности</span>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 text-center py-4">Загрузка…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Shops */}
          <div className="bg-white rounded-xl shadow-sm p-3">
            <div className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-2">
              Точки
              <span className="text-emerald-600">{shopsOnMap.length} на карте</span>
              {shopsNoCoord.length > 0 && <span className="text-gray-300">· {shopsNoCoord.length} без координат</span>}
            </div>
            <div className="flex flex-col divide-y divide-gray-50">
              {shops.map((s) => (
                <div key={s.id} className="flex items-center gap-2 py-1.5 text-xs">
                  <span>{TYPE_ICON[s.type || 'shop']}</span>
                  <span className="flex-1 font-medium truncate">{s.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${DIR_DOT[s.direction] || 'bg-gray-100 text-gray-500'}`}>
                    {s.direction}
                  </span>
                  {s.lat && s.lng
                    ? <span className="text-emerald-500 text-[10px]">✓</span>
                    : <span className="text-gray-300 text-[10px]">—</span>}
                </div>
              ))}
            </div>
            {shopsNoCoord.length > 0 && (
              <Link href="/logistics/shops" className="text-xs text-blue-500 hover:underline mt-2 block">
                Добавить координаты →
              </Link>
            )}
          </div>

          {/* Active deliveries */}
          <div className="bg-white rounded-xl shadow-sm p-3">
            <div className="text-xs font-semibold text-gray-500 mb-2">
              Активные доставки с адресом ({activeWithAddr.length})
            </div>
            {activeWithAddr.length === 0 ? (
              <div className="text-xs text-gray-400 py-2">Нет доставок с адресом</div>
            ) : (
              <div className="flex flex-col divide-y divide-gray-50">
                {activeWithAddr.slice(0, 12).map((d) => (
                  <div key={d.id} className="flex items-start gap-2 py-1.5 text-xs">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{d.client_name || 'Без названия'}</div>
                      <div className="text-gray-400 truncate">{d.address}</div>
                    </div>
                    {geocodeMap[d.id] ? (
                      <span className="text-emerald-500 text-[10px] shrink-0">✓ на карте</span>
                    ) : (
                      <button
                        onClick={() => geocodeDelivery(d)}
                        disabled={geocoding !== null}
                        className="text-blue-500 text-[10px] shrink-0 hover:underline disabled:opacity-40">
                        {geocoding === d.id ? '⏳' : '📍 найти'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
