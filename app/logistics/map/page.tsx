'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import AdminGate from '@/components/AdminGate';
import LogisticsTabs from '@/components/LogisticsTabs';
import { listShops, listDeliveries, listUsers, Shop, Delivery, UserInfo } from '@/lib/api';
import type { GpsLocation } from '@/lib/gps';

const GPS_POLL_MS = 30_000;
const GPS_OFFLINE_MS = 30 * 60_000; // старше 30 мин — офлайн

const TYPE_ICON: Record<string, string> = { warehouse: '🏭', shop: '🏪' };
const TYPE_COLOR: Record<string, string> = { warehouse: '#185FA5', shop: '#0F6E56' };
const DIR_DOT: Record<string, string> = {
  'Север': 'bg-blue-100 text-blue-700',
  'Юг': 'bg-green-100 text-green-700',
  'Восток': 'bg-orange-100 text-orange-700',
  'Запад': 'bg-purple-100 text-purple-700',
  'Центр': 'bg-amber-100 text-amber-700',
};

function parseGpsTime(t: string): Date {
  // "2025/06/20 10:23:45" → Date
  return new Date(t.replace(/\//g, '-'));
}

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
  const tileLayerRef = useRef<unknown>(null);
  const boundsSetRef = useRef(false);
  const [mapStyle, setMapStyle] = useState<'osm' | 'yandex' | 'satellite'>('yandex');
  const [shops, setShops] = useState<Shop[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [gpsLocations, setGpsLocations] = useState<GpsLocation[]>([]);
  const [gpsLoaded, setGpsLoaded] = useState(false);
  const [drivers, setDrivers] = useState<UserInfo[]>([]);
  const [geocodeMap, setGeocodeMap] = useState<Record<string, [number, number]>>({});
  const [geocoding, setGeocoding] = useState<string | null>(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gpsError, setGpsError] = useState(false);
  const [selectedGps, setSelectedGps] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listShops(), listDeliveries(), listUsers()])
      .then(([s, d, u]) => {
        setShops(s);
        setDeliveries(d.filter((x) => !['delivered', 'returned'].includes(x.status)));
        setDrivers(u.filter((x) => x.role === 'driver'));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const fetchGps = useCallback(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    fetch('/api/gps', { cache: 'no-store', signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        clearTimeout(timer);
        if (data.ok && Array.isArray(data.locations)) {
          setGpsLocations(data.locations);
          setGpsError(false);
        } else {
          setGpsError(true);
        }
      })
      .catch(() => setGpsError(true))
      .finally(() => setGpsLoaded(true));
  }, []);

  useEffect(() => {
    fetchGps();
    const id = setInterval(fetchGps, GPS_POLL_MS);
    return () => clearInterval(id);
  }, [fetchGps]);

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

  const TILES = {
    osm:       { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',  attr: '© OpenStreetMap contributors', max: 19 },
    yandex:    { url: 'https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=1&lang=ru_RU', attr: '© Яндекс', max: 20 },
    satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: '© Esri', max: 20 },
  };

  useEffect(() => {
    if (!leafletReady || !mapDivRef.current || mapRef.current) return;
    const L = getL();
    const map = L.map(mapDivRef.current).setView([40.461, 71.755], 12);
    const t = TILES[mapStyle];
    tileLayerRef.current = L.tileLayer(t.url, { attribution: t.attr, maxZoom: t.max }).addTo(map);
    mapRef.current = map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletReady]);

  // Смена тайл-слоя без пересоздания карты
  useEffect(() => {
    const L = getL();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any;
    if (!L || !map) return;
    if (tileLayerRef.current) (tileLayerRef.current as any).remove();
    const t = TILES[mapStyle];
    tileLayerRef.current = L.tileLayer(t.url, { attribution: t.attr, maxZoom: t.max }).addTo(map);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapStyle]);

  const renderMarkers = useCallback(() => {
    const L = getL();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any;
    if (!L || !map) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (markersRef.current as any[]).forEach((m) => m.remove());
    markersRef.current = [];
    const coords: [number, number][] = [];

    // Точки (склады, магазины)
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

    // Доставки с геокодингом
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

    // GPS-трекеры (gps16888.com)
    const now = Date.now();
    gpsLocations.forEach((v) => {
      if (!v.lat || !v.lng) return;
      const lastSeen = parseGpsTime(v.sys_time).getTime();
      const ageMs = now - lastSeen;
      const isOffline = ageMs > GPS_OFFLINE_MS;
      const isMoving = v.speed > 2;
      const isSelected = selectedGps === v.user_id;

      let bgColor = isOffline ? '#9CA3AF' : isMoving ? '#16A34A' : '#D97706';
      if (isSelected) bgColor = '#2563EB';
      const border = isSelected ? '3px solid #93C5FD' : '2px solid rgba(255,255,255,0.9)';

      const speedLabel = isMoving ? ` · ${v.speed} км/ч` : '';
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:${bgColor};color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;border:${border};box-shadow:0 2px 8px rgba(0,0,0,0.3);">🚚 ${v.user_name}${speedLabel}</div>`,
        iconAnchor: [0, 14],
      });

      const marker = L.marker([v.lat, v.lng], { icon, zIndexOffset: 1000 })
        .addTo(map)
        .bindPopup(
          `<b>🚚 ${v.user_name}</b><br>` +
          `Скорость: ${v.speed} км/ч<br>` +
          (isOffline ? `<span style="color:#EF4444">⚫ Офлайн</span>` :
           isMoving ? `<span style="color:#16A34A">🟢 Едет</span>` :
           `<span style="color:#D97706">🟡 Стоит</span>`) + '<br>' +
          `<small style="color:#888">GPS: ${new Date(lastSeen).toLocaleString('ru-RU')}</small>`
        );
      markersRef.current.push(marker);
      coords.push([v.lat, v.lng]);
    });

    // Приближаем только при первой загрузке, потом не двигаем карту
    if (coords.length > 0 && !boundsSetRef.current) {
      map.fitBounds(L.latLngBounds(coords).pad(0.3));
      boundsSetRef.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shops, deliveries, geocodeMap, gpsLocations, selectedGps]);

  useEffect(() => {
    if (leafletReady && mapRef.current) renderMarkers();
  }, [leafletReady, renderMarkers]);

  // Центрирование карты при клике на машину в списке
  function focusVehicle(v: GpsLocation) {
    setSelectedGps(v.user_id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any;
    if (map && v.lat && v.lng) {
      map.setView([v.lat, v.lng], 15, { animate: true });
    }
  }

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

  const now = Date.now();
  const onlineVehicles = gpsLocations.filter(
    (v) => now - parseGpsTime(v.sys_time).getTime() < GPS_OFFLINE_MS
  );
  const movingVehicles = onlineVehicles.filter((v) => v.speed > 2);

  const shopsOnMap = shops.filter((s) => s.lat && s.lng);
  const shopsNoCoord = shops.filter((s) => !s.lat || !s.lng);
  const activeWithAddr = deliveries.filter((d) => d.address);

  // Сортируем GPS-машины: едущие сначала, потом стоящие, потом офлайн
  const sortedGps = [...gpsLocations].sort((a, b) => {
    const aOnline = now - parseGpsTime(a.sys_time).getTime() < GPS_OFFLINE_MS;
    const bOnline = now - parseGpsTime(b.sys_time).getTime() < GPS_OFFLINE_MS;
    if (aOnline !== bOnline) return aOnline ? -1 : 1;
    return b.speed - a.speed;
  });

  return (
    <div>
      <LogisticsTabs />
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="text-xl font-bold">
          🗺️ Карта · {movingVehicles.length} едут · {onlineVehicles.length - movingVehicles.length} стоят
        </h2>
        {gpsError && (
          <span className="text-xs text-red-500 bg-red-50 px-2 py-1 rounded-lg">⚠️ GPS недоступен</span>
        )}
        <Link href="/logistics/shops" className="ml-auto text-xs text-blue-500 hover:underline">
          + Добавить точку →
        </Link>
      </div>

      {/* Переключатель карты */}
      <div className="flex gap-1 mb-2">
        {(['yandex', 'satellite', 'osm'] as const).map((s) => (
          <button key={s} onClick={() => setMapStyle(s)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${mapStyle === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:border-blue-400'}`}>
            {s === 'yandex' ? '🗺 Яндекс' : s === 'satellite' ? '🛰 Спутник' : '🌍 OSM'}
          </button>
        ))}
      </div>

      <div className="flex gap-3 mb-3" style={{ alignItems: 'flex-start' }}>
        {/* Карта */}
        <div
          ref={mapDivRef}
          className="rounded-xl border border-gray-200 overflow-hidden flex-1"
          style={{ height: 500, minWidth: 0 }}
        />

        {/* Список GPS-машин */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col"
          style={{ width: 260, minWidth: 220, maxHeight: 500, overflowY: 'auto' }}>
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-100 sticky top-0 bg-white flex items-center gap-2">
            <span>GPS-трекеры</span>
            {gpsLoaded && <span className="ml-auto text-gray-400">{gpsLocations.length} устройств</span>}
            {!gpsLoaded && <span className="ml-auto text-gray-300">загрузка…</span>}
          </div>
          {!gpsLoaded ? (
            <div className="px-3 py-6 text-xs text-gray-300 text-center">⏳</div>
          ) : gpsError ? (
            <div className="px-3 py-4 text-xs text-red-400 text-center">
              ⚠️ Нет соединения с GPS<br/>
              <span className="text-gray-400">Проверьте GPS_MDS_TOKEN в Vercel</span>
            </div>
          ) : sortedGps.length === 0 ? (
            <div className="px-3 py-4 text-xs text-gray-400 text-center">
              Нет устройств<br/>
              <span className="text-gray-300">Добавьте GPS ID водителям</span>
            </div>
          ) : (
            sortedGps.map((v) => {
              const lastSeen = parseGpsTime(v.sys_time).getTime();
              const ageMs = now - lastSeen;
              const isOffline = ageMs > GPS_OFFLINE_MS;
              const isMoving = v.speed > 2;
              const isSelected = selectedGps === v.user_id;
              const driver = drivers.find((d) => d.gps_user_id === v.user_id);
              return (
                <button
                  key={v.user_id}
                  onClick={() => focusVehicle(v)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50' : ''}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${isOffline ? 'bg-gray-400' : isMoving ? 'bg-green-500' : 'bg-amber-400'}`} />
                    <span className="text-xs font-semibold truncate">{v.user_name}</span>
                  </div>
                  {driver && (
                    <div className="text-[10px] text-blue-600 mt-0.5 pl-3.5 truncate">
                      👤 {driver.name} · {driver.car_number}
                    </div>
                  )}
                  <div className="text-[10px] text-gray-400 mt-0.5 pl-3.5">
                    {isOffline
                      ? `⚫ офлайн · ${Math.round(ageMs / 60_000)} мин назад`
                      : isMoving
                      ? `🟢 ${v.speed} км/ч · едет`
                      : '🟡 стоит'}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Легенда */}
      <div className="flex items-center gap-4 mb-4 text-xs text-gray-500 flex-wrap">
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-600 mr-1 align-middle" />Склад</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-600 mr-1 align-middle" />Магазин</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500 mr-1 align-middle" />Доставка</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-600 mr-1 align-middle" />🚚 Едет (GPS)</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 mr-1 align-middle" />🚚 Стоит (GPS)</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-400 mr-1 align-middle" />🚚 Офлайн (GPS)</span>
        <span className="ml-auto text-gray-400">Обновление каждые 30 сек</span>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 text-center py-4">Загрузка…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Точки */}
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

          {/* Активные доставки */}
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
