'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import AdminGate from '@/components/AdminGate';
import { listRoutes, listDrivers, getRoute, Route, RouteWithDeliveries, UserInfo, Delivery, DeliveryStatus } from '@/lib/api';

function fmt(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
function duration(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}ч ${m}м` : `${m}м`;
}

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  new: 'Новая', assigned: 'Назначено', on_way: 'В пути', delivered: 'Доставлено', returned: 'Возврат',
};
const STATUS_COLOR: Record<DeliveryStatus, string> = {
  new: 'text-gray-400', assigned: 'text-amber-500', on_way: 'text-blue-500',
  delivered: 'text-green-600', returned: 'text-red-500',
};

// Локальная дата YYYY-MM-DD (для быстрых фильтров «сегодня» и т.п.).
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function LogisticsReportsPage() {
  return (
    <AdminGate min="manager">
      <ReportsContent />
    </AdminGate>
  );
}

function ReportsContent() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [drivers, setDrivers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [quick, setQuick] = useState<'today' | 'week' | 'month' | 'all'>('all');

  // Раскрытый водитель (username) и детали его маршрутов.
  const [openDriver, setOpenDriver] = useState<string | null>(null);
  const [routeDetail, setRouteDetail] = useState<Record<string, RouteWithDeliveries | null>>({});
  const [loadingRoute, setLoadingRoute] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listRoutes(), listDrivers()])
      .then(([r, d]) => { setRoutes(r); setDrivers(d); })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  function applyQuick(q: typeof quick) {
    setQuick(q);
    const now = new Date();
    if (q === 'all') { setFilterFrom(''); setFilterTo(''); return; }
    if (q === 'today') { const t = isoDate(now); setFilterFrom(t); setFilterTo(t); return; }
    const from = new Date(now);
    from.setDate(from.getDate() - (q === 'week' ? 7 : 30));
    setFilterFrom(isoDate(from)); setFilterTo(isoDate(now));
  }

  // Маршруты в рамках выбранного периода.
  const periodRoutes = useMemo(() => routes.filter(r => {
    if (filterFrom && r.started_at < filterFrom) return false;
    if (filterTo && r.started_at > filterTo + 'T23:59:59') return false;
    return true;
  }), [routes, filterFrom, filterTo]);

  // Агрегация по каждому водителю: маршруты, км, точки.
  const driverStats = useMemo(() => {
    const m = new Map<string, { username: string; name: string; car: string; routes: number; km: number; points: number }>();
    // Сначала заводим всех водителей (чтобы показать и тех, у кого 0).
    for (const d of drivers) {
      m.set(d.username, { username: d.username, name: d.name, car: d.car_number || '', routes: 0, km: 0, points: 0 });
    }
    for (const r of periodRoutes) {
      const key = r.driver_username || r.driver_name;
      const cur = m.get(key) || { username: key, name: r.driver_name, car: r.car_number || '', routes: 0, km: 0, points: 0 };
      cur.routes += 1;
      cur.km += r.total_km || 0;
      cur.points += r.delivery_ids.length;
      if (!cur.car && r.car_number) cur.car = r.car_number;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.km - a.km || b.routes - a.routes || a.name.localeCompare(b.name, 'ru'));
  }, [drivers, periodRoutes]);

  const totals = useMemo(() => driverStats.reduce((s, d) => ({
    km: s.km + d.km, routes: s.routes + d.routes, points: s.points + d.points,
  }), { km: 0, routes: 0, points: 0 }), [driverStats]);

  async function toggleRoute(id: string) {
    if (routeDetail[id] !== undefined) {
      setRouteDetail(p => { const n = { ...p }; delete n[id]; return n; });
      return;
    }
    setLoadingRoute(id);
    try {
      const full = await getRoute(id);
      setRouteDetail(p => ({ ...p, [id]: full }));
    } catch {
      setRouteDetail(p => ({ ...p, [id]: null }));
    } finally {
      setLoadingRoute(null);
    }
  }

  const periodLabel = quick === 'today' ? 'сегодня' : quick === 'week' ? 'за 7 дней' : quick === 'month' ? 'за 30 дней' : 'за всё время';

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Link href="/logistics" className="text-sm text-gray-500 hover:text-gray-700">← Логистика</Link>
        <h2 className="text-xl font-bold ml-1">📊 Отчёты по водителям</h2>
        <span className="text-sm text-gray-400 ml-auto">{driverStats.filter(d => d.routes > 0).length} активных · {periodLabel}</span>
      </div>

      {/* Быстрые периоды + диапазон дат */}
      <div className="bg-white rounded-xl shadow-sm p-3 mb-4 flex flex-wrap gap-2 items-center">
        {([['today', 'Сегодня'], ['week', '7 дней'], ['month', '30 дней'], ['all', 'Всё время']] as const).map(([q, label]) => (
          <button key={q} onClick={() => applyQuick(q)}
            className={`px-3 py-1.5 text-sm font-semibold rounded-lg ${quick === q ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {label}
          </button>
        ))}
        <span className="w-px h-6 bg-gray-200 mx-1" />
        <input type="date" value={filterFrom} onChange={e => { setFilterFrom(e.target.value); setQuick('all'); }}
          className="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
        <span className="self-center text-gray-400 text-sm">—</span>
        <input type="date" value={filterTo} onChange={e => { setFilterTo(e.target.value); setQuick('all'); }}
          className="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
      </div>

      {/* Сводка по всем */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {[
          { label: 'Водителей', value: driverStats.filter(d => d.routes > 0).length },
          { label: 'Маршрутов', value: totals.routes },
          { label: 'Км (туда)', value: `${totals.km} км` },
          { label: 'Км (туда-обратно)', value: `${totals.km * 2} км` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl shadow-sm p-3 text-center">
            <div className="text-lg font-bold text-blue-600">{value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-gray-500">
          <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          Загрузка…
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {driverStats.map(ds => {
            const isOpen = openDriver === ds.username;
            const driverRoutes = periodRoutes
              .filter(r => (r.driver_username || r.driver_name) === ds.username)
              .sort((a, b) => b.started_at.localeCompare(a.started_at));
            return (
              <div key={ds.username} className="bg-white rounded-xl shadow-sm overflow-hidden">
                {/* Строка водителя */}
                <button onClick={() => setOpenDriver(isOpen ? null : ds.username)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{ds.name}</span>
                      {ds.car && <span className="text-xs text-gray-400">🚗 {ds.car}</span>}
                    </div>
                    <div className="flex flex-wrap gap-3 mt-1">
                      <span className="text-xs text-gray-500">🧭 {ds.routes} маршрутов</span>
                      <span className="text-xs text-gray-500">📦 {ds.points} точек</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold text-emerald-600">{ds.km} км</div>
                    <div className="text-[10px] text-gray-400">туда-обратно {ds.km * 2} км</div>
                  </div>
                  <span className="text-gray-400 text-sm shrink-0">{isOpen ? '▲' : '▼'}</span>
                </button>

                {/* Маршруты водителя */}
                {isOpen && (
                  <div className="border-t border-gray-100 bg-gray-50/50">
                    {driverRoutes.length === 0 ? (
                      <p className="text-gray-400 text-sm p-4 text-center">Нет маршрутов за период</p>
                    ) : (
                      <div className="flex flex-col divide-y divide-gray-100">
                        {driverRoutes.map(r => {
                          const detail = routeDetail[r.id];
                          const deliveries: Delivery[] = detail?.deliveries || [];
                          const delivered = deliveries.filter(d => d.status === 'delivered').length;
                          const dur = duration(r.started_at, r.finished_at);
                          return (
                            <div key={r.id}>
                              <button onClick={() => toggleRoute(r.id)}
                                className="w-full text-left px-4 py-2.5 flex items-start gap-3 hover:bg-white transition-colors">
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap gap-2 items-center">
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${r.status === 'finished' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                      {r.status === 'finished' ? '✅ Завершён' : '🟢 Активен'}
                                    </span>
                                    <span className="text-xs text-gray-400">📅 {fmtDate(r.started_at)}</span>
                                    <span className="text-xs text-gray-400">🕐 {fmt(r.started_at)}</span>
                                    {dur && <span className="text-xs text-blue-500">⏱ {dur}</span>}
                                  </div>
                                  <div className="flex flex-wrap gap-3 mt-1">
                                    {r.total_km > 0 && <span className="text-xs font-medium text-emerald-600">🛣️ {r.total_km} км</span>}
                                    <span className="text-xs text-gray-500">📦 {r.delivery_ids.length} точек</span>
                                    {detail && <span className="text-xs text-green-600">✓ {delivered} доставлено</span>}
                                  </div>
                                </div>
                                <span className="text-gray-400 text-xs shrink-0 mt-1">
                                  {loadingRoute === r.id ? '⏳' : routeDetail[r.id] !== undefined ? '▲' : '▼'}
                                </span>
                              </button>
                              {routeDetail[r.id] !== undefined && (
                                <div className="px-4 pb-2">
                                  {detail === null ? (
                                    <p className="text-red-500 text-xs py-2">Ошибка загрузки</p>
                                  ) : deliveries.length === 0 ? (
                                    <p className="text-gray-400 text-xs py-2 text-center">Нет доставок</p>
                                  ) : (
                                    <div className="flex flex-col divide-y divide-gray-100 bg-white rounded-lg border border-gray-100">
                                      {deliveries.map((d, i) => (
                                        <div key={d.id} className="px-3 py-2 flex items-start gap-2">
                                          <span className="text-xs text-gray-300 w-4 shrink-0">{i + 1}</span>
                                          <div className="flex-1 min-w-0">
                                            <div className="text-sm font-medium truncate">{d.client_name || d.to_name || '—'}</div>
                                            {d.address && <div className="text-xs text-gray-400 truncate">📍 {d.address}</div>}
                                            <div className="flex flex-wrap gap-2 mt-0.5">
                                              {d.km > 0 && <span className="text-xs text-gray-400">🛣️ {d.km} км</span>}
                                              {d.direction && <span className="text-xs text-sky-500">{d.direction}</span>}
                                            </div>
                                          </div>
                                          <span className={`text-xs font-medium shrink-0 ${STATUS_COLOR[d.status]}`}>
                                            {STATUS_LABEL[d.status]}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
