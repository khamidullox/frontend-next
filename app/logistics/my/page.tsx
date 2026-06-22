'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listDeliveries, updateDelivery, Delivery, DeliveryStatus,
  DELIVERY_STATUS_LABEL, DOC_TYPE_LABEL,
  listRoutes, startRoute, finishRoute, sendTrackPoint, addDeliveriesToRoute, Route,
  listShops, Shop, resolveDeliveryPoint,
} from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import PushSubscribe from '@/components/PushSubscribe';
import MiniMap, { MapPoint } from '@/components/MiniMap';
import { useLivePoll } from '@/lib/useLivePoll';

const TRACK_INTERVAL_MS = 45_000;

function fmtTime(iso?: string | null) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
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
  const [showMap, setShowMap] = useState(true);

  const load = useCallback(async () => {
    try {
      setItems(await listDeliveries());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRoute = useCallback(async () => {
    try {
      const routes = await listRoutes();
      setRoute(routes.find((r) => r.status === 'active') || null);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadRoute(); }, [loadRoute]);
  useEffect(() => { listShops().then(setShops).catch(() => {}); }, []);

  const refresh = useCallback(() => { load(); loadRoute(); }, [load, loadRoute]);

  // Автообновление без ручного F5. Push уже уведомляет о новых назначениях,
  // поэтому опрос реже и только пока вкладка видима — бережёт квоту Firestore.
  useLivePoll(refresh, 60_000);

  async function setStatus(id: string, status: DeliveryStatus) {
    setBusyId(id);
    setError('');
    try {
      const updated = await updateDelivery(id, { status });
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

  const routeDeliveries = useMemo(
    () => (route ? items.filter((d) => d.route_id === route.id) : []),
    [route, items]
  );
  const routeKm = routeDeliveries.reduce((s, d) => s + (d.km || 0), 0);
  const unassignedToRoute = items.filter((d) => !d.route_id && ['new', 'assigned', 'on_way'].includes(d.status));

  // Остановки маршрута на карте: одна точка на адрес (несколько накладных в одну точку —
  // одна остановка с общим списком), пронумерованы по порядку, отмечены зелёным когда доставлены.
  const mapStops = useMemo<MapPoint[]>(() => {
    const sorted = [...routeDeliveries].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const order: string[] = [];
    const groups = new Map<string, { lat: number; lng: number; names: string[]; done: boolean }>();
    for (const d of sorted) {
      const pt = resolveDeliveryPoint(d, shops);
      if (!pt) continue;
      const key = d.shop_id || `${pt.lat.toFixed(3)},${pt.lng.toFixed(3)}`;
      let g = groups.get(key);
      if (!g) { g = { ...pt, names: [], done: true }; groups.set(key, g); order.push(key); }
      g.names.push(d.client_name || d.to_name || d.address || '—');
      if (d.status !== 'delivered' && d.status !== 'returned') g.done = false;
    }
    return order.map((key, i) => {
      const g = groups.get(key)!;
      return {
        lat: g.lat, lng: g.lng, num: i + 1,
        color: g.done ? '#10b981' : '#f97316',
        label: `${i + 1}. ${g.names.join(', ')}`,
      };
    });
  }, [routeDeliveries, shops]);

  const mapPoints = useMemo<MapPoint[]>(() => {
    const pts = [...mapStops];
    if (myPos) pts.push({ lat: myPos.lat, lng: myPos.lng, color: '#2563eb', label: '📍 Я' });
    return pts;
  }, [mapStops, myPos]);

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

  return (
    <div>
      <PushSubscribe />
      <div className="mb-4">
        <h2 className="text-xl font-bold">🚚 Мои доставки</h2>
        {session && (
          <p className="text-xs text-gray-400 mt-0.5">{session.name}</p>
        )}
      </div>

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {/* Маршрут (заход) */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        {route ? (
          <>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <div className="font-semibold text-sm">🧭 Маршрут в пути · начат {fmtTime(route.started_at)}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {routeDeliveries.length} доставок{routeKm > 0 ? ` · 🛣️ ${routeKm * 2} км` : ''}
                </div>
                {(activeWeight > 0 || activeVolL > 0) && (
                  <div className="text-xs text-gray-400 mt-0.5">
                    🚐 Осталось развезти: {activeWeight > 0 && `${Math.round(activeWeight)} кг`}
                    {activeWeight > 0 && activeVolL > 0 && ' · '}
                    {activeVolL > 0 && `${(activeVolL / 1000).toFixed(1)} м³`}
                  </div>
                )}
              </div>
              <button onClick={handleFinishRoute} disabled={routeBusy}
                className="px-3 py-2 bg-red-500 hover:bg-red-600 disabled:bg-gray-200 text-white text-xs font-semibold rounded-lg whitespace-nowrap">
                {routeBusy ? '⏳…' : '🏁 Закончить маршрут'}
              </button>
            </div>
            {geoError ? (
              <p className="text-xs text-amber-600">⚠️ Геолокация: {geoError}. Разрешите доступ, чтобы быть видимым на карте.</p>
            ) : (
              <p className="text-xs text-emerald-600">📡 Местоположение передаётся логисту</p>
            )}
            {unassignedToRoute.length > 0 && (
              <p className="text-xs text-gray-400 mt-1">
                Добавляю {unassignedToRoute.length} новых доставок в этот заход…
              </p>
            )}
          </>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm text-gray-500">
                {unassignedToRoute.length > 0
                  ? `Готовы к выезду: ${unassignedToRoute.length} доставок`
                  : 'Нет назначенных доставок для выезда'}
              </div>
              {(activeWeight > 0 || activeVolL > 0) && (
                <div className="text-xs text-gray-400 mt-0.5">
                  🚐 Всего к загрузке: {activeWeight > 0 && `${Math.round(activeWeight)} кг`}
                  {activeWeight > 0 && activeVolL > 0 && ' · '}
                  {activeVolL > 0 && `${(activeVolL / 1000).toFixed(1)} м³`}
                </div>
              )}
            </div>
            <button onClick={handleStartRoute} disabled={routeBusy}
              className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-200 text-white text-xs font-semibold rounded-lg whitespace-nowrap">
              {routeBusy ? '⏳…' : '🚀 Начать маршрут'}
            </button>
          </div>
        )}
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
              <MiniMap points={mapPoints} routeLine height={280} />
              <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500 flex-wrap">
                <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#f97316' }} /> осталось</span>
                <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#10b981' }} /> доставлено</span>
                {myPos && <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#2563eb' }} /> я</span>}
              </div>
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
            <DeliveryCard key={d.id} d={d} busy={busyId === d.id} onSet={setStatus} />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Завершённые ({done.length})</div>
            {doneKm > 0 && <div className="text-xs font-semibold text-emerald-600">🛣️ всего {doneKm} км</div>}
          </div>
          <div className="flex flex-col gap-2 opacity-70">
            {done.map((d) => (
              <DeliveryCard key={d.id} d={d} busy={busyId === d.id} onSet={setStatus} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DeliveryCard({
  d, busy, onSet,
}: {
  d: Delivery;
  busy: boolean;
  onSet: (id: string, s: DeliveryStatus) => void;
}) {
  const actions = nextActions(d.status);
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col gap-2">
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
          <div className="font-bold text-base mt-1">{d.client_name || 'Без названия'}</div>
          {d.address && <div className="text-sm text-gray-600 mt-0.5">📍 {d.address}</div>}
          {d.note && <div className="text-xs text-gray-400 mt-0.5">📝 {d.note}</div>}
          {d.km > 0 && <div className="text-xs text-emerald-600 font-medium mt-0.5">🛣️ {d.km} км</div>}
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
        <div className="flex gap-2 flex-wrap pt-1">
          {actions.map((a) => (
            <button key={a.status} disabled={busy} onClick={() => onSet(d.id, a.status)}
              className={`flex-1 min-w-[130px] py-3 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors ${a.cls}`}>
              {busy ? '⏳…' : a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
