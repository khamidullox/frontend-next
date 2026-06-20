'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminGate from '@/components/AdminGate';
import LogisticsTabs from '@/components/LogisticsTabs';
import {
  listShopRequests, updateDelivery, addDeliveriesToRoute, listDrivers, listRoutes,
  Delivery, DeliveryStatus, DELIVERY_STATUS_LABEL, UserInfo, Route,
} from '@/lib/api';

function statusClass(s: DeliveryStatus): string {
  switch (s) {
    case 'delivered': return 'bg-green-100 text-green-700';
    case 'on_way': return 'bg-blue-100 text-blue-700';
    case 'returned': return 'bg-red-100 text-red-700';
    case 'assigned': return 'bg-amber-100 text-amber-700';
    default: return 'bg-gray-100 text-gray-600';
  }
}

function fmt(iso?: string | null) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

export default function ShopRequestsManagerPage() {
  return (
    <AdminGate min="manager">
      <ShopRequestsContent />
    </AdminGate>
  );
}

function ShopRequestsContent() {
  const [items, setItems] = useState<Delivery[]>([]);
  const [drivers, setDrivers] = useState<UserInfo[]>([]);
  const [activeRoutes, setActiveRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [reqs, drv, routes] = await Promise.all([listShopRequests(), listDrivers(), listRoutes()]);
      setItems(reqs);
      setDrivers(drv);
      setActiveRoutes(routes.filter((r) => r.status === 'active'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const routeByDriver = useMemo(() => {
    const m = new Map<string, Route>();
    for (const r of activeRoutes) m.set(r.driver_username, r);
    return m;
  }, [activeRoutes]);

  async function assign(d: Delivery, driverUsername: string) {
    setBusyId(d.id);
    setError('');
    try {
      const updated = await updateDelivery(d.id, { driver_username: driverUsername || null });
      setItems((prev) => prev.map((x) => (x.id === d.id ? updated : x)));

      // Если водитель уже в пути с активным маршрутом — присоединяем доставку сразу.
      const route = routeByDriver.get(driverUsername);
      if (route) {
        await addDeliveriesToRoute(route.id, [d.id]);
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const pending = items.filter((d) => !['delivered', 'returned'].includes(d.status));
  const done = items.filter((d) => ['delivered', 'returned'].includes(d.status));

  return (
    <div>
      <LogisticsTabs />
      <h2 className="text-xl font-bold mb-3">🏪 Заявки магазинов <span className="text-sm text-gray-400 font-normal">({pending.length})</span></h2>

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {loading ? (
        <div className="text-gray-500 text-sm">Загрузка…</div>
      ) : pending.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">Заявок нет</div>
      ) : (
        <div className="flex flex-col gap-2 mb-5">
          {pending.map((d) => {
            const onActiveRoute = !!d.route_id;
            const driverHasActiveRoute = d.driver_username ? routeByDriver.has(d.driver_username) : false;
            return (
              <div key={d.id} className="bg-white rounded-xl shadow-sm p-3 flex flex-col gap-2">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                        🏪 {d.shop_name || 'Магазин'}
                      </span>
                      <span className="truncate">🚚 {d.client_name || 'Без названия'}</span>
                    </div>
                    {d.address && <div className="text-xs text-gray-500 mt-0.5">📍 {d.address}</div>}
                    {d.note && <div className="text-xs text-gray-400 mt-0.5">📝 {d.note}</div>}
                    <div className="text-xs text-gray-400 mt-0.5">
                      {d.direction && <span className="mr-2">🧭 {d.direction}</span>}
                      создано {fmt(d.created_at)}
                    </div>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusClass(d.status)}`}>
                    {DELIVERY_STATUS_LABEL[d.status]}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <select value={d.driver_username || ''} disabled={busyId === d.id}
                    onChange={(e) => assign(d, e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-400">
                    <option value="">— назначить водителя —</option>
                    {drivers.map((dr) => (
                      <option key={dr.username} value={dr.username}>
                        {dr.name}{dr.car_number ? ` · ${dr.car_number}` : ''}{routeByDriver.has(dr.username) ? ' · в пути' : ''}
                      </option>
                    ))}
                  </select>
                  {onActiveRoute && (
                    <span className="text-[11px] text-emerald-600">✓ в маршруте водителя</span>
                  )}
                  {!onActiveRoute && driverHasActiveRoute && (
                    <span className="text-[11px] text-amber-600">водитель уже в пути — добавится в текущий заход</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {done.length > 0 && (
        <>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Завершённые ({done.length})</div>
          <div className="flex flex-col gap-2 opacity-70">
            {done.map((d) => (
              <div key={d.id} className="bg-white rounded-xl shadow-sm px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">🏪 {d.shop_name} · {d.client_name}</div>
                  {d.address && <div className="text-xs text-gray-400 mt-0.5 truncate">📍 {d.address}</div>}
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full shrink-0 ${statusClass(d.status)}`}>
                  {DELIVERY_STATUS_LABEL[d.status]}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
