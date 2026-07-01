'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listDeliveries, updateDelivery, Delivery, DeliveryStatus,
  DELIVERY_STATUS_LABEL, DOC_TYPE_LABEL, DocType,
  listRoutes, startRoute, finishRoute, sendTrackPoint, addDeliveriesToRoute, Route,
  listShops, Shop, resolveDeliveryPoint, resolvePickupPoint,
  listAvailableOffers, claimOffer, ShopOffer, listAvailableDocs, getMyCapacity, MyCapacity,
} from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import PushSubscribe from '@/components/PushSubscribe';
import MiniMap, { MapPoint } from '@/components/MiniMap';
import { useLivePoll } from '@/lib/useLivePoll';
import { fmtDateTime } from '@/lib/format';
import { haversineKm } from '@/lib/geo';

const TRACK_INTERVAL_MS = 45_000;

// Маршрут с несколькими точками сразу в Яндекс.Картах (запускает навигацию в самом
// приложении карт через все остановки по порядку, не по одной).
function buildYandexRouteUrl(points: { lat: number; lng: number }[]): string {
  const rtext = points.map((p) => `${p.lat},${p.lng}`).join('~');
  return `https://yandex.ru/maps/?rtext=${encodeURIComponent(rtext)}&rtt=auto`;
}

// Маршрут от текущего местоположения до одной точки (пустой пункт до «~» —
// Яндекс сам подставит позицию пользователя).
function buildYandexSinglePointUrl(lat: number, lng: number): string {
  return `https://yandex.ru/maps/?rtext=~${lat},${lng}&rtt=auto`;
}

// Текущая геопозиция водителя — фолбэк точки клиента для заявок магазина без своей
// отметки на карте (магазин не всегда её ставит при создании). null при отказе/таймауте —
// в этом случае просто не передаём координаты, как и раньше.
function getCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 30_000 }
    );
  });
}

function statusClass(s: DeliveryStatus): string {
  switch (s) {
    case 'delivered': return 'bg-green-100 text-green-700';
    case 'on_way': return 'bg-blue-100 text-blue-700';
    case 'returned': return 'bg-red-100 text-red-700';
    case 'assigned': return 'bg-amber-100 text-amber-700';
    default: return 'bg-gray-100 text-gray-600';
  }
}

// Какие действия доступны водителю в зависимости от текущего статуса.
function nextActions(s: DeliveryStatus): { status: DeliveryStatus; label: string; cls: string }[] {
  switch (s) {
    case 'new':
    case 'assigned':
      return [{ status: 'on_way', label: '🚚 Взять в путь', cls: 'bg-blue-500 hover:bg-blue-600' }];
    case 'on_way':
      return [
        { status: 'delivered', label: '✅ Доставлено', cls: 'bg-green-500 hover:bg-green-600' },
        { status: 'returned', label: '↩️ Возврат', cls: 'bg-red-500 hover:bg-red-600' },
      ];
    default:
      return [];
  }
}

export default function MyDeliveriesPage() {
  const { session } = useAuth();
  const [items, setItems] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const [route, setRoute] = useState<Route | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [shops, setShops] = useState<Shop[]>([]);
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [offers, setOffers] = useState<ShopOffer[]>([]);
  const [availableDocs, setAvailableDocs] = useState<Delivery[]>([]);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [myCap, setMyCap] = useState<MyCapacity | null>(null);
  // Вкладка: «мои» (взятые заказы) или «свободные» (можно взять). Переключается
  // кнопками и свайпом — водителю по умолчанию видны его взятые заказы.
  const [view, setView] = useState<'mine' | 'free'>('free');
  const touchX = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) { touchX.current = e.touches[0].clientX; }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (dx > 60) setView('mine');      // свайп вправо → мои взятые
    else if (dx < -60) setView('free'); // свайп влево → свободные
  }

  const load = useCallback(async () => {
    try {
      setItems(await listDeliveries());
      setOffers(await listAvailableOffers());
      setAvailableDocs(await listAvailableDocs());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { getMyCapacity().then(setMyCap).catch(() => {}); }, []);

  const loadRoute = useCallback(async () => {
    try {
      const routes = await listRoutes();
      setRoute(routes.find((r) => r.status === 'active') || null);
    } catch { /* ignore */ }
  }, []);

  async function claim(id: string) {
    setClaimingId(id);
    setError('');
    try {
      await claimOffer(id);
      await Promise.all([load(), loadRoute()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setClaimingId(null);
    }
  }

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRoute(); }, [loadRoute]);
  useEffect(() => { listShops().then(setShops).catch(() => {}); }, []);

  const refresh = useCallback(() => { load(); loadRoute(); }, [load, loadRoute]);

  // Автообновление без ручного F5. Push уже уведомляет о новых назначениях,
  // поэтому опрос реже и только пока вкладка видима — бережёт квоту Firestore.
  useLivePoll(refresh, 60_000);

  async function setStatus(id: string, status: DeliveryStatus, returnNote?: string, pos?: { lat: number; lng: number } | null) {
    setBusyId(id);
    setError('');
    try {
      const updated = await updateDelivery(id, {
        status, return_note: returnNote,
        ...(pos ? { lat: pos.lat, lng: pos.lng } : {}),
      });
      setItems((prev) => prev.map((d) => (d.id === id ? updated : d)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleStartRoute() {
    setRouteBusy(true);
    setError('');
    try {
      const r = await startRoute();
      setRoute(r);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRouteBusy(false);
    }
  }

  async function handleFinishRoute() {
    if (!route) return;
    setRouteBusy(true);
    setError('');
    try {
      await finishRoute(route.id);
      setRoute(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRouteBusy(false);
    }
  }

  // GPS: пока есть активный маршрут — раз в TRACK_INTERVAL_MS отправляем позицию.
  const routeIdRef = useRef<string | null>(null);
  routeIdRef.current = route?.id ?? null;

  useEffect(() => {
    if (!route || typeof navigator === 'undefined' || !('geolocation' in navigator)) return;

    let cancelled = false;
    function tick() {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled || !routeIdRef.current) return;
          setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          sendTrackPoint({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            speed: pos.coords.speed ?? undefined,
            heading: pos.coords.heading ?? undefined,
          }).catch(() => {});
          setGeoError('');
        },
        (err) => setGeoError(err.message || 'Не удалось определить местоположение'),
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 }
      );
    }
    tick();
    const id = setInterval(tick, TRACK_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [route]);

  // Держим экран включённым во время маршрута — иначе телефон сам блокируется от
  // бездействия, браузер уходит в фон и передача координат останавливается. Не
  // спасает от ручной блокировки кнопкой питания или закрытия вкладки — это
  // ограничение мобильных браузеров, тут ничего не сделать.
  const hasRoute = !!route;
  const [wakeLockOn, setWakeLockOn] = useState(false);
  useEffect(() => {
    if (!hasRoute || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lock: any = null;
    async function acquire() {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lock = await (navigator as any).wakeLock.request('screen');
        if (cancelled) { lock.release().catch(() => {}); return; }
        setWakeLockOn(true);
        lock.addEventListener('release', () => setWakeLockOn(false));
      } catch {
        setWakeLockOn(false);
      }
    }
    acquire();
    const onVisible = () => { if (!document.hidden && !lock) acquire(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release?.().catch(() => {});
    };
  }, [hasRoute]);

  const routeDeliveries = useMemo(
    () => (route ? items.filter((d) => d.route_id === route.id) : []),
    [route, items]
  );
  const routeKm = routeDeliveries.reduce((s, d) => s + (d.km || 0), 0);
  const unassignedToRoute = items.filter((d) => !d.route_id && ['new', 'assigned', 'on_way'].includes(d.status));

  // Остановки маршрута на карте: одна точка на адрес (несколько накладных в одну точку —
  // одна остановка с общим списком), пронумерованы по порядку. Полностью доставленные
  // точки убираются с карты совсем (их видно в «Завершённые» ниже) — на карте только то,
  // куда ещё нужно доехать.
  const mapStops = useMemo<MapPoint[]>(() => {
    const sorted = [...routeDeliveries].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const order: string[] = [];
    const groups = new Map<string, { lat: number; lng: number; names: string[]; done: boolean }>();
    for (const d of sorted) {
      const pt = resolveDeliveryPoint(d, shops);
      if (!pt) continue;
      // То же самое: shop_id для shop_to_client — это магазин, откуда забрали товар,
      // а не куда везут. Иначе вторая доставка к другому клиенту с того же магазина
      // пропадала бы с карты водителя совсем (объединялась с первой).
      const key = d.kind !== 'shop_to_client' && d.shop_id
        ? d.shop_id
        : `${pt.lat.toFixed(3)},${pt.lng.toFixed(3)}`;
      let g = groups.get(key);
      if (!g) { g = { ...pt, names: [], done: true }; groups.set(key, g); order.push(key); }
      g.names.push(d.client_name || d.to_name || d.address || '—');
      if (d.status !== 'delivered' && d.status !== 'returned') g.done = false;
    }
    const pending = order.map((key) => groups.get(key)!).filter((g) => !g.done);
    return pending.map((g, i) => ({
      lat: g.lat, lng: g.lng, num: i + 1,
      color: '#f97316',
      label: `${i + 1}. ${g.names.join(', ')}`,
    }));
  }, [routeDeliveries, shops]);

  // Места выдачи товара (склад/магазин) для доставок, которые ещё не взяли в путь —
  // отдельная иконка 📦, чтобы на карте было видно, куда заехать ПЕРЕД доставкой клиенту.
  const pickupPoints = useMemo<MapPoint[]>(() => {
    const notTaken = routeDeliveries.filter((d) => d.status === 'new' || d.status === 'assigned');
    const seen = new Map<string, { lat: number; lng: number; name: string }>();
    for (const d of notTaken) {
      const pt = resolvePickupPoint(d, shops);
      if (!pt) continue;
      const key = `${pt.lat.toFixed(4)},${pt.lng.toFixed(4)}`;
      if (!seen.has(key)) {
        seen.set(key, { ...pt, name: d.kind === 'shop_to_client' ? (d.shop_name || 'магазин') : (d.from_name || 'склад') });
      }
    }
    return [...seen.values()].map((p) => ({
      lat: p.lat, lng: p.lng, icon: '📦', color: '#D97706',
      label: `📦 Место выдачи: ${p.name}`,
    }));
  }, [routeDeliveries, shops]);

  const mapPoints = useMemo<MapPoint[]>(() => {
    const pts = [...pickupPoints, ...mapStops];
    if (myPos) pts.push({ lat: myPos.lat, lng: myPos.lng, color: '#2563eb', label: '📍 Я' });
    return pts;
  }, [pickupPoints, mapStops, myPos]);

  // Точки для «Поехали»: текущая позиция → сначала места выдачи (ещё не забрал товар
  // у магазина/склада — pickupPoints), затем остановки клиентам (mapStops). Раньше сюда
  // шли только mapStops, и навигация сразу везла к клиенту, минуя магазин.
  const navPoints = useMemo(() => {
    const pickup = pickupPoints.map((s) => ({ lat: s.lat, lng: s.lng }));
    const pending = mapStops.map((s) => ({ lat: s.lat, lng: s.lng }));
    const all = [...pickup, ...pending];
    return myPos ? [myPos, ...all] : all;
  }, [pickupPoints, mapStops, myPos]);

  // Путь по дорогам (OSRM) от текущей позиции через ещё не доставленные остановки —
  // иначе на карте просто прямая линия «по воздуху», не следующая по реальным дорогам.
  const [routePath, setRoutePath] = useState<[number, number][] | null>(null);
  useEffect(() => {
    const pending = mapStops;
    let cancelled = false;
    if (!myPos || !pending.length) {
      Promise.resolve().then(() => { if (!cancelled) setRoutePath(null); });
      return () => { cancelled = true; };
    }
    const coordsParam = [`${myPos.lng},${myPos.lat}`, ...pending.map((s) => `${s.lng},${s.lat}`)].join(';');
    fetch(`https://router.project-osrm.org/route/v1/driving/${coordsParam}?overview=full&geometries=geojson`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const ro = j.routes?.[0];
        setRoutePath(ro ? (ro.geometry.coordinates as number[][]).map(([ln, la]) => [la, ln] as [number, number]) : null);
      })
      .catch(() => { if (!cancelled) setRoutePath(null); });
    return () => { cancelled = true; };
  }, [myPos, mapStops]);

  // Путь по дорогам до мест выдачи товара — отдельный, оранжевый, отличается от
  // основного синего маршрута к клиентам (см. цвет в MiniMap secondaryPath).
  const [pickupPath, setPickupPath] = useState<[number, number][] | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!myPos || !pickupPoints.length) {
      Promise.resolve().then(() => { if (!cancelled) setPickupPath(null); });
      return () => { cancelled = true; };
    }
    const coordsParam = [`${myPos.lng},${myPos.lat}`, ...pickupPoints.map((s) => `${s.lng},${s.lat}`)].join(';');
    fetch(`https://router.project-osrm.org/route/v1/driving/${coordsParam}?overview=full&geometries=geojson`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const ro = j.routes?.[0];
        setPickupPath(ro ? (ro.geometry.coordinates as number[][]).map(([ln, la]) => [la, ln] as [number, number]) : null);
      })
      .catch(() => { if (!cancelled) setPickupPath(null); });
    return () => { cancelled = true; };
  }, [myPos, pickupPoints]);

  // Авто-присоединение: пока маршрут активен, все активные доставки водителя
  // (в т.ч. назначенные логистом после старта) подтягиваем в этот заход — один
  // маршрут с внутренними доставками, а не отдельные.
  const attachingRef = useRef(false);
  useEffect(() => {
    if (!route || attachingRef.current) return;
    const orphans = items.filter((d) => !d.route_id && ['new', 'assigned', 'on_way'].includes(d.status));
    if (orphans.length === 0) return;
    attachingRef.current = true;
    addDeliveriesToRoute(route.id, orphans.map((d) => d.id))
      .then(() => load())
      .catch(() => {})
      .finally(() => { attachingRef.current = false; });
  }, [route, items, load]);

  const active = items.filter((d) => d.status !== 'delivered' && d.status !== 'returned');
  const done = items.filter((d) => d.status === 'delivered' || d.status === 'returned');
  const doneKm = done.reduce((s, d) => s + (d.km || 0), 0);

  // Заказы из рассылки: показываем ВСЕ открытые заявки без ограничения по радиусу —
  // водитель сам решает, что взять. Если позиция известна, считаем расстояние и
  // сортируем «ближние сверху», но ничего не скрываем.
  const nearbyOffers = (() => {
    const withDist = offers.map((o) => ({
      o,
      dist: (myPos && o.pickup_lat != null && o.pickup_lng != null)
        ? haversineKm(myPos.lat, myPos.lng, o.pickup_lat, o.pickup_lng) : null,
    }));
    return withDist.sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9));
  })();

  // Сколько всего «взял с собой» в этот выезд — уменьшается по мере доставки по частям.
  const activeWeight = active.reduce((s, d) => s + (d.total_weight || 0), 0);
  const activeVolL = active.reduce((s, d) => s + (d.total_volume_l || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] gap-3 text-gray-500">
        <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        Загрузка…
      </div>
    );
  }

  const freeCount = nearbyOffers.length + availableDocs.length;

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <PushSubscribe />
      <div className="mb-3">
        <h2 className="text-xl font-bold">🚚 Мои доставки</h2>
        {session && (
          <p className="text-xs text-gray-400 mt-0.5">{session.name}</p>
        )}
      </div>

      {/* Вкладки: мои взятые / свободные (можно листать свайпом) */}
      <div className="flex gap-1 mb-3 bg-gray-100 rounded-xl p-1">
        <button onClick={() => setView('free')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg ${view === 'free' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
          📢 Свободные ({freeCount})
        </button>
        <button onClick={() => setView('mine')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg ${view === 'mine' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
          🚚 Мои ({active.length})
        </button>
      </div>

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {/* Моя текущая загрузка — сколько уже взял с собой относительно вместимости
          своей машины, чтобы было понятно, есть ли место под новый заказ ниже. */}
      {view === 'mine' && myCap && (activeWeight > 0 || activeVolL > 0) && (() => {
        const pctKg = myCap.capacity_kg > 0 ? Math.min(100, Math.round((activeWeight / myCap.capacity_kg) * 100)) : null;
        const pctM3 = myCap.capacity_m3 > 0 ? Math.min(100, Math.round((activeVolL / 1000 / myCap.capacity_m3) * 100)) : null;
        const pct = Math.max(pctKg ?? 0, pctM3 ?? 0);
        const barColor = pct >= 90 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-500' : 'bg-emerald-500';
        return (
          <div className="mb-3 bg-white border border-gray-200 rounded-xl p-3">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>🚐 Моя загрузка</span>
              <span>
                {Math.round(activeWeight)}/{myCap.capacity_kg} кг
                {myCap.capacity_m3 > 0 && ` · ${(activeVolL / 1000).toFixed(1)}/${myCap.capacity_m3} м³`}
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })()}

      {/* Заказы из рассылки рядом — водитель берёт сам */}
      {view === 'free' && nearbyOffers.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
          <div className="text-xs font-bold text-amber-700 mb-2">📢 Свободные заказы ({nearbyOffers.length})</div>
          <div className="flex flex-col gap-1.5">
            {nearbyOffers.map(({ o, dist }) => {
              const mapText = o.address || o.client_name || o.shop_name || '';
              return (
              <div key={o.id} className="bg-white rounded-lg p-2 pl-2.5 border-l-4 border-amber-400 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold break-words">🏪 {o.shop_name || 'Магазин'} → {o.client_name || 'клиент'}</div>
                  {o.address && <div className="text-[11px] text-gray-400 mt-0.5 break-words">📍 {o.address}</div>}
                  {mapText && (
                    <div className="flex gap-2 mt-0.5">
                      <a href={`https://yandex.ru/maps/?text=${encodeURIComponent(mapText)}`} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()} className="text-[11px] text-red-500 hover:underline">🗺️ Яндекс</a>
                      <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapText)}`} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()} className="text-[11px] text-blue-500 hover:underline">Google</a>
                    </div>
                  )}
                  {o.items.length > 0 && (
                    <div className="text-[11px] text-gray-400 mt-0.5 truncate">📦 {o.items.map((it) => `${it.name} ×${it.qty}`).join(', ')}</div>
                  )}
                  {(o.total_weight || o.total_volume_l) ? (
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      ⚖️ {o.total_weight ? `${Math.round(o.total_weight)} кг` : ''}{o.total_weight && o.total_volume_l ? ' · ' : ''}{o.total_volume_l ? `${(o.total_volume_l / 1000).toFixed(2)} м³` : ''}
                    </div>
                  ) : null}
                  {dist != null && <div className="text-[11px] text-amber-600 mt-0.5">~{Math.round(dist)} км до места выдачи</div>}
                </div>
                <button onClick={() => claim(o.id)} disabled={claimingId === o.id}
                  className="shrink-0 px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white text-xs font-semibold rounded-lg whitespace-nowrap">
                  {claimingId === o.id ? '⏳…' : '✋ Взять'}
                </button>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Собранные накладные/заказы/перемещения без водителя — без геопривязки (в
          отличие от заявок магазина выше), поэтому без расстояния, просто список. */}
      {view === 'free' && availableDocs.length > 0 && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5">
          <div className="text-xs font-bold text-emerald-700 mb-2">📦 Собранные, ждут водителя ({availableDocs.length})</div>
          <div className="flex flex-col gap-1.5">
            {availableDocs.map((d) => {
              const destLabel = d.from_name && d.to_name
                ? `${d.from_name} → ${d.to_name}`           /* накладная/перемещение: склад → склад */
                : (d.client_name || d.to_name || d.from_name || '—'); /* заказ: клиент (person_name) */
              const mapText = d.address || destLabel;
              return (
              <div key={d.id} className="bg-white rounded-lg p-2 pl-2.5 border-l-4 border-emerald-400 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold break-words">
                    {(d.doc_type && DOC_TYPE_LABEL[d.doc_type as DocType]) || d.doc_type || 'Документ'} {d.doc_number ? `№${d.doc_number}` : ''}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5 break-words">{destLabel}</div>
                  {d.address && <div className="text-[11px] text-gray-400 mt-0.5 break-words">📍 {d.address}</div>}
                  {mapText && mapText !== '—' && (
                    <div className="flex gap-2 mt-0.5">
                      <a href={`https://yandex.ru/maps/?text=${encodeURIComponent(mapText)}`} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()} className="text-[11px] text-red-500 hover:underline">🗺️ Яндекс</a>
                      <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapText)}`} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()} className="text-[11px] text-blue-500 hover:underline">Google</a>
                    </div>
                  )}
                  {d.items.length > 0 && (
                    <div className="text-[11px] text-gray-400 mt-0.5 truncate">📦 {d.items.map((it) => `${it.name} ×${it.qty}`).join(', ')}</div>
                  )}
                  {(d.total_weight || d.total_volume_l) ? (
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      ⚖️ {d.total_weight ? `${Math.round(d.total_weight)} кг` : ''}{d.total_weight && d.total_volume_l ? ' · ' : ''}{d.total_volume_l ? `${(d.total_volume_l / 1000).toFixed(2)} м³` : ''}
                    </div>
                  ) : null}
                </div>
                <button onClick={() => claim(d.id)} disabled={claimingId === d.id}
                  className="shrink-0 px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white text-xs font-semibold rounded-lg whitespace-nowrap">
                  {claimingId === d.id ? '⏳…' : '✋ Взять'}
                </button>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {view === 'mine' && (<>
      {active.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm p-4 text-sm text-gray-500 mb-3">
          Взятых заказов нет. Откройте вкладку «📢 Свободные» (или свайпните влево), чтобы взять заказ.
        </div>
      )}
      {/* Маршрут (заход) — закреплён сверху и сделан компактным, чтобы не перекрывать
          список заказов под собой; подробности (км/загрузка/геолокация) под кнопкой,
          мелким шрифтом, а не в большом блоке как раньше. */}
      <div className="sticky top-14 z-20 -mx-4 px-4 pt-2 pb-2 mb-3 bg-gray-50/95 backdrop-blur-sm">
        <div className="bg-white rounded-xl shadow-sm px-3 py-2">
          {route ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-xs truncate">🧭 В пути · {routeDeliveries.length} доставок{routeKm > 0 ? ` · ${routeKm} км` : ''}</div>
                </div>
                <button onClick={handleFinishRoute} disabled={routeBusy}
                  className="shrink-0 px-2.5 py-1.5 bg-red-500 hover:bg-red-600 disabled:bg-gray-200 text-white text-xs font-semibold rounded-lg whitespace-nowrap">
                  {routeBusy ? '⏳…' : '🏁 Закончить'}
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400 flex-wrap">
                {geoError ? (
                  <span className="text-amber-600">⚠️ {geoError}</span>
                ) : (
                  <span className="text-emerald-600">📡 передаётся логисту</span>
                )}
                {(activeWeight > 0 || activeVolL > 0) && (
                  <span>🚐 осталось: {activeWeight > 0 && `${Math.round(activeWeight)} кг`}{activeWeight > 0 && activeVolL > 0 && ' · '}{activeVolL > 0 && `${(activeVolL / 1000).toFixed(1)} м³`}</span>
                )}
                {!wakeLockOn && <span className="text-amber-600">⚠️ не блокируйте телефон</span>}
                {unassignedToRoute.length > 0 && <span>+{unassignedToRoute.length} новых добавляются…</span>}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 text-xs text-gray-500 truncate">
                {unassignedToRoute.length > 0
                  ? `Готовы к выезду: ${unassignedToRoute.length} доставок`
                  : 'Нет назначенных доставок'}
                {(activeWeight > 0 || activeVolL > 0) && (
                  <span className="text-gray-400"> · 🚐 {activeWeight > 0 && `${Math.round(activeWeight)} кг`}{activeWeight > 0 && activeVolL > 0 && ' · '}{activeVolL > 0 && `${(activeVolL / 1000).toFixed(1)} м³`}</span>
                )}
              </div>
              <button onClick={handleStartRoute} disabled={routeBusy}
                className="shrink-0 px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-200 text-white text-xs font-semibold rounded-lg whitespace-nowrap">
                {routeBusy ? '⏳…' : '🚀 Начать маршрут'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Карта маршрута: остановки по порядку + моё текущее местоположение */}
      {route && mapStops.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-3 mb-4">
          <button onClick={() => setShowMap((v) => !v)}
            className="w-full flex items-center justify-between text-sm font-semibold">
            <span>🗺️ Карта маршрута <span className="text-gray-400 font-normal">({mapStops.length})</span></span>
            <span className="text-gray-400 text-xs">{showMap ? '▲' : '▼'}</span>
          </button>
          {showMap && (
            <div className="mt-2">
              <MiniMap points={mapPoints} path={routePath ?? undefined} secondaryPath={pickupPath ?? undefined} secondaryPathColor="#D97706" routeLine height={280} />
              <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500 flex-wrap">
                {pickupPoints.length > 0 && (
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#D97706' }} /> 📦 место выдачи</span>
                )}
                <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#f97316' }} /> осталось</span>
                {myPos && <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#2563eb' }} /> я</span>}
                {pickupPath && (
                  <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5" style={{ background: '#D97706' }} /> путь до выдачи</span>
                )}
                {routePath && (
                  <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5" style={{ background: '#2563eb' }} /> путь к клиенту</span>
                )}
              </div>
              {navPoints.length > 0 && (
                <a href={buildYandexRouteUrl(navPoints)} target="_blank" rel="noopener noreferrer"
                  className="mt-3 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-semibold">
                  🚀 Поехали
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {items.length === 0 && (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">Доставок пока нет</div>
      )}

      {active.length > 0 && (
        <div className="flex flex-col gap-2.5 mb-5">
          {active.map((d) => (
            <DeliveryCard key={d.id} d={d} busy={busyId === d.id} onSet={setStatus} shops={shops} />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-3">
          <button onClick={() => setShowDone((v) => !v)}
            className="w-full flex items-center justify-between">
            <span className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Завершённые ({done.length})</span>
            <span className="flex items-center gap-2">
              {doneKm > 0 && <span className="text-xs font-semibold text-emerald-600">🛣️ {doneKm} км</span>}
              <span className="text-gray-400 text-xs">{showDone ? '▲' : '▼'}</span>
            </span>
          </button>
          {showDone && (
            <div className="flex flex-col gap-2 opacity-70 mt-3">
              {done.map((d) => (
                <DeliveryCard key={d.id} d={d} busy={busyId === d.id} onSet={setStatus} shops={shops} />
              ))}
            </div>
          )}
        </div>
      )}
      </>)}

      {view === 'free' && freeCount === 0 && (
        <div className="bg-white rounded-xl shadow-sm p-4 text-sm text-gray-500">
          Свободных заказов сейчас нет.
        </div>
      )}
    </div>
  );
}

function DeliveryCard({
  d, busy, onSet, shops,
}: {
  d: Delivery;
  busy: boolean;
  onSet: (id: string, s: DeliveryStatus, returnNote?: string, pos?: { lat: number; lng: number } | null) => void;
  shops: Shop[];
}) {
  const actions = nextActions(d.status);
  // Пока не взял в путь — может понадобиться сначала доехать до места выдачи
  // (склад/магазин), если водитель сейчас далеко или в другом месте.
  const pickup = (d.status === 'new' || d.status === 'assigned') ? resolvePickupPoint(d, shops) : null;
  return (
    <div className="bg-white rounded-xl shadow-sm p-2.5 flex flex-col gap-1.5">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {d.doc_type && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
              {DOC_TYPE_LABEL[d.doc_type]} № {d.doc_number || d.doc_id}
            </span>
          )}
          {d.kind === 'shop_to_client' && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 ml-1">
              🏪 {d.shop_name || 'Заявка магазина'}
            </span>
          )}
          <div className="font-bold text-sm mt-0.5">{d.client_name || 'Без названия'}</div>
          {d.address && <div className="text-xs text-gray-600 mt-0.5">📍 {d.address}</div>}
          {d.client_phone && (
            <a href={`tel:${d.client_phone}`}
              className="mt-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 text-green-700 text-sm font-semibold active:bg-green-100">
              📞 {d.client_phone}
            </a>
          )}
          {d.items.length > 0 && (
            <div className="text-xs text-gray-500 mt-0.5">📦 {d.items.map((it) => `${it.name} ×${it.qty}`).join(', ')}</div>
          )}
          {d.note && <div className="text-xs text-gray-400 mt-0.5">📝 {d.note}</div>}
          {d.km > 0 && <div className="text-xs text-emerald-600 font-medium mt-0.5">🛣️ {d.km} км</div>}
          {pickup && (
            <a href={buildYandexSinglePointUrl(pickup.lat, pickup.lng)} target="_blank" rel="noopener noreferrer"
              className="mt-2 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-50 text-amber-700 text-xs font-semibold hover:bg-amber-100">
              📍 Дойти до места выдачи{d.kind === 'shop_to_client' ? ` (${d.shop_name || 'магазин'})` : d.from_name ? ` (${d.from_name})` : ''}
            </a>
          )}
          {d.address && (
            <div className="flex gap-2 mt-2">
              <a href={`https://yandex.ru/maps/?text=${encodeURIComponent(d.address)}`} target="_blank" rel="noopener noreferrer"
                className="px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100">
                🗺️ Яндекс.Карты
              </a>
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}`} target="_blank" rel="noopener noreferrer"
                className="px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-semibold hover:bg-blue-100">
                🗺️ Google Maps
              </a>
            </div>
          )}
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusClass(d.status)}`}>
          {DELIVERY_STATUS_LABEL[d.status]}
        </span>
      </div>

      {actions.length > 0 && (
        <div className="flex gap-2 pt-1">
          {actions.map((a) => (
            <button key={a.status} disabled={busy}
              onClick={async () => {
                if (a.status === 'returned') {
                  // Причина возврата обязательна — без неё менеджер не поймёт, что
                  // произошло, а заявка магазина (если это она) уйдёт обратно в очередь.
                  const reason = window.prompt('Укажите причину возврата (обязательно):');
                  if (!reason || !reason.trim()) return;
                  onSet(d.id, a.status, reason.trim());
                  return;
                }
                // Доставка без своей точки на карте (заявка магазина без отметки, либо
                // заказ из Smartup без person_latitude/longitude) — берём геопозицию
                // водителя в момент «Доставлено» как точку клиента, чтобы км считались
                // не от нуля и точка сохранилась на будущее (не запрашиваем повторно).
                if (a.status === 'delivered' && d.lat == null && d.lng == null) {
                  const pos = await getCurrentPosition();
                  onSet(d.id, a.status, undefined, pos);
                  return;
                }
                onSet(d.id, a.status);
              }}
              className={`flex-1 py-2.5 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors ${a.cls}`}>
              {busy ? '⏳…' : a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
