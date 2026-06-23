'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import AdminGate from '@/components/AdminGate';
import LogisticsTabs from '@/components/LogisticsTabs';
import { listShops, listDeliveries, listUsers, listVehiclePositions, Shop, Delivery, UserInfo } from '@/lib/api';

interface GpsLocation {
  user_name: string;
  user_id: string;
  lat: number;
  lng: number;
  speed: number;
  sys_time: string;
  heart_time: string;
  alarm: number;
  sim_id: string;
  source?: 'tracker' | 'phone'; // tracker = gps16888.com, phone = телефон водителя
}

const GPS_POLL_MS = 30_000;
const GPS_OFFLINE_MS = 5 * 60_000;
const GPS_JITTER_M = 30; // меньше — считаем дрожанием сигнала, не движением

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface RouteStop {
  coords: [number, number];
  label: string;
  order: number; // порядок объезда от OSRM Trip (1, 2, 3… без учёта текущей позиции = 0)
}

interface RouteInfo {
  userId: string;
  path: [number, number][];
  durationMin: number;
  distanceKm: number;
  stops: RouteStop[];
}

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
  const routeLayersRef = useRef<unknown[]>([]);
  const geocodeMapRef = useRef<Record<string, [number, number]>>({});
  const [mapStyle, setMapStyle] = useState<'osm' | 'yandex' | 'satellite'>('osm');
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [trackerLocations, setTrackerLocations] = useState<GpsLocation[]>([]);
  const [phoneLocations, setPhoneLocations] = useState<GpsLocation[]>([]);
  const [gpsLoaded, setGpsLoaded] = useState(false);
  const [drivers, setDrivers] = useState<UserInfo[]>([]);
  const [geocodeMap, setGeocodeMap] = useState<Record<string, [number, number]>>({});
  const [geocoding, setGeocoding] = useState<string | null>(null);
  const [leafletReady, setLeafletReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gpsError, setGpsError] = useState(false);
  // Выбранные машины (user_id) — клик переключает; пусто = показываем все маршруты.
  const [selectedGps, setSelectedGps] = useState<Set<string>>(new Set());

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

  const prevGpsRef = useRef<Record<string, { lat: number; lng: number; t: number }>>({});

  const fetchGps = useCallback(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    fetch('/api/gps', { cache: 'no-store', signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        clearTimeout(timer);
        if (data.ok && Array.isArray(data.locations)) {
          const now = Date.now();
          const withMovement: GpsLocation[] = (data.locations as GpsLocation[]).map((loc) => {
            const prev = prevGpsRef.current[loc.user_id];
            let speed = loc.speed;
            if (prev) {
              const meters = haversineMeters(prev.lat, prev.lng, loc.lat, loc.lng);
              const seconds = Math.max(1, (now - prev.t) / 1000);
              if (meters > GPS_JITTER_M) {
                const kmh = (meters / 1000) / (seconds / 3600);
                speed = Math.max(speed, Math.round(kmh));
              }
            }
            prevGpsRef.current[loc.user_id] = { lat: loc.lat, lng: loc.lng, t: now };
            return { ...loc, speed, source: 'tracker' as const };
          });
          setTrackerLocations(withMovement);
          setGpsError(false);
        } else {
          setGpsError(true);
        }
      })
      .catch(() => setGpsError(true))
      .finally(() => setGpsLoaded(true));
  }, []);

  // Позиции с телефонов водителей (страница «Мои доставки» шлёт их при активном маршруте).
  const fetchPhone = useCallback(() => {
    listVehiclePositions()
      .then((positions) => {
        const mapped: GpsLocation[] = positions
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
          .map((p) => ({
            user_name: p.driver_name || p.username,
            user_id: `phone:${p.username}`,
            lat: p.lat,
            lng: p.lng,
            // geolocation.speed в м/с → км/ч
            speed: p.speed != null ? Math.round(p.speed * 3.6) : 0,
            sys_time: p.at || p.updated_at,
            heart_time: p.updated_at,
            alarm: 0,
            sim_id: '',
            source: 'phone' as const,
          }));
        setPhoneLocations(mapped);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchGps();
    fetchPhone();
    const id = setInterval(() => { fetchGps(); fetchPhone(); }, GPS_POLL_MS);
    return () => clearInterval(id);
  }, [fetchGps, fetchPhone]);

  // Объединяем трекеры и телефоны. Если у водителя есть и трекер, и телефон —
  // показываем трекер (выделенное устройство), телефон не дублируем.
  const gpsLocations = useMemo(() => {
    const trackerDriverIds = new Set(
      drivers.filter((d) => d.gps_user_id && trackerLocations.some((t) => t.user_id === d.gps_user_id))
        .map((d) => d.username)
    );
    const phoneFiltered = phoneLocations.filter((p) => {
      const username = p.user_id.replace(/^phone:/, '');
      return !trackerDriverIds.has(username);
    });
    return [...trackerLocations, ...phoneFiltered];
  }, [trackerLocations, phoneLocations, drivers]);

  // Обновляем ref синхронно чтобы избежать цикла зависимостей
  geocodeMapRef.current = geocodeMap;

  // Резолвит точку назначения доставки (как на карте водителя): ручные координаты →
  // shop_id → название склада/магазина → ранее геокодированный адрес → геокодинг адреса.
  const resolveDest = useCallback(async (delivery: Delivery): Promise<[number, number] | null> => {
    if (delivery.lat != null && delivery.lng != null) return [delivery.lat, delivery.lng];
    if (delivery.shop_id) {
      const shop = shops.find((s) => s.id === delivery.shop_id);
      if (shop?.lat && shop?.lng) return [shop.lat, shop.lng];
    }
    const destName = delivery.to_name || delivery.shop_name;
    if (destName) {
      const shop = shops.find((s) => s.name === destName || s.name.includes(destName) || destName.includes(s.name));
      if (shop?.lat && shop?.lng) return [shop.lat, shop.lng];
    }
    const cached = geocodeMapRef.current[delivery.id];
    if (cached) return cached;
    if (delivery.address) {
      try {
        const q = encodeURIComponent(`${delivery.address}, Андижан, Узбекистан`);
        const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`, {
          headers: { 'Accept-Language': 'ru' },
        });
        const geo = (await r.json()) as { lat: string; lon: string }[];
        if (geo.length > 0) {
          const dest: [number, number] = [parseFloat(geo[0].lat), parseFloat(geo[0].lon)];
          geocodeMapRef.current = { ...geocodeMapRef.current, [delivery.id]: dest };
          setGeocodeMap((prev) => ({ ...prev, [delivery.id]: dest }));
          return dest;
        }
      } catch { /* ignore */ }
    }
    return null;
  }, [shops]);

  // База (склад-источник) для этой пачки доставок — нужна, чтобы последней остановкой
  // оптимизатор оставил точку, ближайшую к базе, а не случайную дальнюю (иначе обратно
  // до склада ехать дальше, чем нужно).
  const resolveBase = useCallback((forDeliveries: Delivery[]): [number, number] | null => {
    const fromNames = [...new Set(forDeliveries.map((d) => d.from_name).filter(Boolean) as string[])];
    for (const name of fromNames) {
      const wh = shops.find((s) => s.type === 'warehouse' && (s.name === name || s.name.includes(name) || name.includes(s.name)));
      if (wh?.lat && wh?.lng) return [wh.lat, wh.lng];
    }
    const warehouses = shops.filter((s) => s.type === 'warehouse' && s.lat && s.lng);
    return warehouses.length === 1 ? [warehouses[0].lat!, warehouses[0].lng!] : null;
  }, [shops]);

  // Строит маршрут водителя по ВСЕМ его текущим «в пути» доставкам сразу (а не только
  // по одной первой): один запрос к OSRM Trip даёт и оптимальный порядок объезда точек,
  // и путь по реальным дорогам (а не прямую линию через горы/границы).
  const computeRoutes = useCallback(async () => {
    if (!gpsLocations.length) { setRoutes([]); return; }
    const results: RouteInfo[] = [];
    await Promise.all(gpsLocations.map(async (gps) => {
      // Трекер сопоставляем по gps_user_id, телефон — по username (phone:<username>).
      const driver = gps.source === 'phone'
        ? drivers.find((d) => d.username === gps.user_id.replace(/^phone:/, ''))
        : drivers.find((d) => d.gps_user_id === gps.user_id);
      if (!driver) return;
      // Не только «в пути» — также назначенные, но ещё не взятые (driver уже в активном
      // заходе): иначе на карте видна только первая остановка, а назначенные дальше — нет.
      const onWay = deliveries.filter(
        (d) => d.driver_username === driver.username && ['new', 'assigned', 'on_way'].includes(d.status)
      );
      if (!onWay.length) return;

      // Одна и та же точка назначения у нескольких накладных — одна остановка на карте.
      const stopsMap = new Map<string, { coords: [number, number]; label: string }>();
      for (const delivery of onWay) {
        const dest = await resolveDest(delivery);
        if (!dest) continue;
        const key = delivery.shop_id || `${dest[0].toFixed(3)},${dest[1].toFixed(3)}`;
        if (!stopsMap.has(key)) {
          stopsMap.set(key, { coords: dest, label: delivery.to_name || delivery.shop_name || delivery.client_name || '' });
        }
      }
      const stops = [...stopsMap.values()];
      if (!stops.length) return;

      try {
        const base = resolveBase(onWay);
        const coordsList = [`${gps.lng},${gps.lat}`, ...stops.map((s) => `${s.coords[1]},${s.coords[0]}`)];
        if (base) coordsList.push(`${base[1]},${base[0]}`);
        const destParam = base ? '&destination=last' : '';
        const r = await fetch(
          `https://router.project-osrm.org/trip/v1/driving/${coordsList.join(';')}?source=first${destParam}&roundtrip=false&geometries=geojson&overview=full`
        );
        const j = await r.json();
        const trip = j.trips?.[0];
        if (!trip || !Array.isArray(j.waypoints)) return;
        // waypoints[0] — текущая позиция водителя; дальше — наши stops в том же порядке ввода
        // (последняя точка — база, если есть, ей order не присваиваем — она не остановка-доставка).
        const orderedStops: RouteStop[] = stops.map((s, i) => ({
          ...s,
          order: j.waypoints[i + 1]?.waypoint_index ?? i + 1,
        })).sort((a, b) => a.order - b.order);
        results.push({
          userId: gps.user_id,
          path: (trip.geometry.coordinates as number[][]).map(([ln, la]) => [la, ln] as [number, number]),
          durationMin: Math.round(trip.duration / 60),
          distanceKm: Math.round(trip.distance / 100) / 10,
          stops: orderedStops,
        });
      } catch { /* ignore */ }
    }));
    setRoutes(results);
  }, [gpsLocations, drivers, deliveries, resolveDest, resolveBase]);

  useEffect(() => { computeRoutes(); }, [computeRoutes]);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (routeLayersRef.current as any[]).forEach((l) => l.remove());
    routeLayersRef.current = [];
    const coords: [number, number][] = [];

    // Маршруты водителей — путь по дорогам через ВСЕ их текущие остановки в оптимальном порядке (OSRM Trip).
    // Если что-то выбрано в списке устройств — показываем только маршруты выбранных машин.
    const visibleRoutes = selectedGps.size > 0 ? routes.filter((r) => selectedGps.has(r.userId)) : routes;
    visibleRoutes.forEach((route) => {
      const eta = new Date(Date.now() + route.durationMin * 60_000);
      const etaStr = eta.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const stopsList = route.stops.map((s) => `${s.order}. ${s.label || 'без названия'}`).join('<br>');

      const poly = L.polyline(route.path, { color: '#2563EB', weight: 5, opacity: 0.75, dashArray: '12,6' })
        .bindPopup(
          `<b>🗺 Маршрут · ${route.stops.length} ${route.stops.length === 1 ? 'остановка' : 'остановок'}</b><br>` +
          `${stopsList}<br>${route.distanceKm} км · ~${route.durationMin} мин<br>Прибытие к последней около <b>${etaStr}</b>`
        )
        .addTo(map);
      routeLayersRef.current.push(poly);

      route.stops.forEach((stop) => {
        // Контрастный цвет относительно синей линии маршрута — иначе номер сливается с ней.
        const stopIcon = L.divIcon({
          className: '',
          html: `<div style="background:#EA580C;color:#fff;width:24px;height:24px;border-radius:50%;border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;box-shadow:0 2px 6px rgba(0,0,0,0.45)">${stop.order}</div>`,
          iconSize: [24, 24], iconAnchor: [12, 12],
        });
        const stopM = L.marker(stop.coords, { icon: stopIcon, zIndexOffset: 500 })
          .bindPopup(`<b>${stop.order}. ${stop.label || 'без названия'}</b>`)
          .addTo(map);
        routeLayersRef.current.push(stopM);
      });
    });

    // Точки (склады, магазины) — текст светло-жёлтый вместо белого: лучше видно
    // на пёстрой подложке карты, плюс чуть уменьшенный размер подписи.
    shops.filter((s) => s.lat && s.lng).forEach((shop) => {
      const color = TYPE_COLOR[shop.type || 'shop'] || '#5F5E5A';
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:${color};color:#FDE68A;font-size:10px;font-weight:700;padding:2px 7px;border-radius:18px;white-space:nowrap;border:1.5px solid rgba(255,255,255,0.85);box-shadow:0 2px 6px rgba(0,0,0,0.25);">${TYPE_ICON[shop.type || 'shop'] || '📍'} ${shop.name}</div>`,
        iconAnchor: [0, 12],
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
      const isSelected = selectedGps.has(v.user_id);

      let bgColor = isOffline ? '#9CA3AF' : isMoving ? '#16A34A' : '#D97706';
      if (isSelected) bgColor = '#2563EB';
      const border = isSelected ? '3px solid #93C5FD' : '2px solid rgba(255,255,255,0.9)';

      const speedLabel = isMoving ? ` · ${v.speed} км/ч` : '';
      const vIcon = v.source === 'phone' ? '📱' : '🚚';
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:${bgColor};color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;border:${border};box-shadow:0 2px 8px rgba(0,0,0,0.3);">${vIcon} ${v.user_name}${speedLabel}</div>`,
        iconAnchor: [0, 14],
      });

      const marker = L.marker([v.lat, v.lng], { icon, zIndexOffset: 1000 })
        .addTo(map)
        .bindPopup(
          `<b>${vIcon} ${v.user_name}</b>${v.source === 'phone' ? ' <small style="color:#888">(телефон)</small>' : ''}<br>` +
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
  }, [shops, deliveries, geocodeMap, gpsLocations, selectedGps, routes]);

  useEffect(() => {
    if (leafletReady && mapRef.current) renderMarkers();
  }, [leafletReady, renderMarkers]);

  // Клик по машине в списке — переключает её в выборе (можно выбрать несколько,
  // тогда на карте остаются только их маршруты) и центрирует карту на ней.
  function focusVehicle(v: GpsLocation) {
    setSelectedGps((prev) => {
      const next = new Set(prev);
      if (next.has(v.user_id)) next.delete(v.user_id);
      else next.add(v.user_id);
      return next;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any;
    if (map && v.lat && v.lng) {
      map.setView([v.lat, v.lng], 15, { animate: true });
    }
  }

  function clearSelection() {
    setSelectedGps(new Set());
  }

  // Клик по точке/доставке в списке ниже карты — центрирует карту на её координатах.
  function focusPoint(lat: number, lng: number) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = mapRef.current as any;
    if (map) map.setView([lat, lng], 16, { animate: true });
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

      {/* Карта на весь экран */}
      <div
        ref={mapDivRef}
        className="rounded-xl border border-gray-200 overflow-hidden w-full mb-3"
        style={{ height: '55vh' }}
      />

      {/* GPS-трекеры под картой */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-3">
        <div className="px-3 py-2 text-xs font-semibold text-gray-500 border-b border-gray-100 flex items-center gap-2">
          <span>GPS · трекеры и телефоны</span>
          <span className="text-[10px] text-gray-400 font-normal">(клик — показать маршрут, можно выбрать несколько)</span>
          <div className="ml-auto flex items-center gap-2">
            {selectedGps.size > 0 && (
              <button onClick={clearSelection} className="text-blue-500 hover:underline font-semibold whitespace-nowrap">
                ✕ Показать все ({selectedGps.size})
              </button>
            )}
            {gpsLoaded && <span className="text-gray-400 whitespace-nowrap">{gpsLocations.length} устройств</span>}
            {!gpsLoaded && <span className="text-gray-300 whitespace-nowrap">загрузка…</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 p-2">

          {!gpsLoaded ? (
            <div className="px-3 py-3 text-xs text-gray-300">⏳ загрузка…</div>
          ) : gpsError && sortedGps.length === 0 ? (
            <div className="px-3 py-3 text-xs text-red-400">⚠️ Нет соединения с GPS</div>
          ) : sortedGps.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-400">Нет устройств · добавьте GPS ID водителю или попросите водителя начать маршрут в приложении (📱)</div>
          ) : (
            sortedGps.map((v) => {
              const lastSeen = parseGpsTime(v.sys_time).getTime();
              const ageMs = now - lastSeen;
              const isOffline = ageMs > GPS_OFFLINE_MS;
              const isMoving = v.speed > 2;
              const isSelected = selectedGps.has(v.user_id);
              const driver = v.source === 'phone'
                ? drivers.find((d) => d.username === v.user_id.replace(/^phone:/, ''))
                : drivers.find((d) => d.gps_user_id === v.user_id);
              const route = routes.find((r) => r.userId === v.user_id);
              const eta = route ? new Date(Date.now() + route.durationMin * 60_000) : null;
              return (
                <button
                  key={v.user_id}
                  onClick={() => focusVehicle(v)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${isSelected ? 'bg-blue-50 border-blue-200' : 'border-gray-100 hover:bg-gray-50'}`}
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isOffline ? 'bg-gray-400' : isMoving ? 'bg-green-500' : 'bg-amber-400'}`} />
                  <div>
                    <div className="text-xs font-semibold">{v.source === 'phone' ? '📱' : '🚚'} {v.user_name}</div>
                    {driver && <div className="text-[10px] text-blue-600">{driver.name} · {driver.car_number}</div>}
                    <div className="text-[10px] text-gray-400">
                      {isOffline ? `⚫ ${Math.round(ageMs / 60_000)} мин назад` : isMoving ? `🟢 ${v.speed} км/ч` : '🟡 стоит'}
                    </div>
                    {route && (
                      <div className="text-[10px] text-blue-700 font-medium">
                        🗺 {route.distanceKm} км · ~{route.durationMin} мин · прибытие {eta!.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
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
              {shops.map((s) => {
                const hasCoords = !!(s.lat && s.lng);
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={!hasCoords}
                    onClick={() => hasCoords && focusPoint(s.lat!, s.lng!)}
                    title={hasCoords ? 'Показать на карте' : undefined}
                    className={`w-full flex items-center gap-2 py-1.5 text-xs text-left ${hasCoords ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'}`}
                  >
                    <span>{TYPE_ICON[s.type || 'shop']}</span>
                    <span className="flex-1 font-medium truncate">{s.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${DIR_DOT[s.direction] || 'bg-gray-100 text-gray-500'}`}>
                      {s.direction}
                    </span>
                    {hasCoords
                      ? <span className="text-emerald-500 text-[10px]">✓</span>
                      : <span className="text-gray-300 text-[10px]">—</span>}
                  </button>
                );
              })}
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
                {activeWithAddr.slice(0, 12).map((d) => {
                  const coords = geocodeMap[d.id];
                  return (
                    <div key={d.id} className="flex items-start gap-2 py-1.5 text-xs">
                      <button
                        type="button"
                        disabled={!coords}
                        onClick={() => coords && focusPoint(coords[0], coords[1])}
                        title={coords ? 'Показать на карте' : undefined}
                        className={`flex-1 min-w-0 text-left ${coords ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'}`}
                      >
                        <div className="font-medium truncate">{d.client_name || 'Без названия'}</div>
                        <div className="text-gray-400 truncate">{d.address}</div>
                      </button>
                      {coords ? (
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
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
