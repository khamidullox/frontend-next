'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import AdminGate from '@/components/AdminGate';
import { listRoutes, listDrivers, listDeliveries, deleteRouteApi, Route, UserInfo, Delivery, DeliveryStatus } from '@/lib/api';

function fmt(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
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

// Дата завершения доставки: из истории (delivered/returned), иначе updated_at.
function completedAt(d: Delivery): string {
  const h = (d.history || []).filter(x => x.status === 'delivered' || x.status === 'returned');
  return h.length ? h[h.length - 1].at : d.updated_at;
}

function ReportsContent() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [drivers, setDrivers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [quick, setQuick] = useState<'today' | 'week' | 'month' | 'all'>('all');

  // Раскрытый водитель (username).
  const [openDriver, setOpenDriver] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listRoutes(), listDrivers(), listDeliveries()])
      .then(([r, d, dl]) => { setRoutes(r); setDrivers(d); setDeliveries(dl); })
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

  // Завершённые доставки (доставлено/возврат) в рамках периода — основа отчёта.
  const periodDeliveries = useMemo(() => deliveries.filter(d => {
    if (d.status !== 'delivered' && d.status !== 'returned') return false;
    const when = completedAt(d);
    if (filterFrom && when < filterFrom) return false;
    if (filterTo && when > filterTo + 'T23:59:59') return false;
    return true;
  }), [deliveries, filterFrom, filterTo]);

  // Маршруты в периоде (для счётчика «маршрутов» и очистки пустых).
  const periodRoutes = useMemo(() => routes.filter(r => {
    if (filterFrom && r.started_at < filterFrom) return false;
    if (filterTo && r.started_at > filterTo + 'T23:59:59') return false;
    return true;
  }), [routes, filterFrom, filterTo]);

  // Агрегация по водителю: доставки, км, маршруты.
  const driverStats = useMemo(() => {
    const m = new Map<string, { username: string; name: string; car: string; routes: number; km: number; points: number }>();
    for (const d of drivers) {
      m.set(d.username, { username: d.username, name: d.name, car: d.car_number || '', routes: 0, km: 0, points: 0 });
    }
    for (const d of periodDeliveries) {
      const key = d.driver_username || d.driver_name || '—';
      const cur = m.get(key) || { username: key, name: d.driver_name || key, car: d.car_number || '', routes: 0, km: 0, points: 0 };
      cur.km += d.km || 0;
      cur.points += 1;
      if (!cur.car && d.car_number) cur.car = d.car_number;
      m.set(key, cur);
    }
    for (const r of periodRoutes) {
      const key = r.driver_username || r.driver_name;
      const cur = m.get(key);
      if (cur) cur.routes += 1;
    }
    return [...m.values()].sort((a, b) => b.points - a.points || b.km - a.km || a.name.localeCompare(b.name, 'ru'));
  }, [drivers, periodDeliveries, periodRoutes]);

  const totals = useMemo(() => driverStats.reduce((s, d) => ({
    km: s.km + d.km, routes: s.routes + d.routes, points: s.points + d.points,
  }), { km: 0, routes: 0, points: 0 }), [driverStats]);

  // Пустые маршруты (без привязанных доставок) — кандидаты на удаление.
  const emptyRoutes = useMemo(() => routes.filter(r => (r.delivery_ids?.length || 0) === 0), [routes]);

  async function removeEmpty() {
    if (emptyRoutes.length === 0) return;
    if (!confirm(`Удалить ${emptyRoutes.length} пустых маршрутов (без доставок)?`)) return;
    const ids = emptyRoutes.map(r => r.id);
    for (const id of ids) {
      await deleteRouteApi(id).catch(() => {});
    }
    setRoutes(prev => prev.filter(r => !ids.includes(r.id)));
  }

  const periodLabel = quick === 'today' ? 'сегодня' : quick === 'week' ? 'за 7 дней' : quick === 'month' ? 'за 30 дней' : 'за всё время';

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Link href="/logistics" className="text-sm text-gray-500 hover:text-gray-700">← Логистика</Link>
        <h2 className="text-xl font-bold ml-1">📊 Отчёты по водителям</h2>
        {emptyRoutes.length > 0 && (
          <button onClick={removeEmpty}
            className="ml-auto px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold rounded-lg whitespace-nowrap">
            🗑 Удалить пустые ({emptyRoutes.length})
          </button>
        )}
        <span className={`text-sm text-gray-400 ${emptyRoutes.length > 0 ? '' : 'ml-auto'}`}>{driverStats.filter(d => d.routes > 0).length} активных · {periodLabel}</span>
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
          { label: 'Водителей', value: driverStats.filter(d => d.points > 0).length },
          { label: 'Доставок', value: totals.points },
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
            const driverDeliveries = periodDeliveries
              .filter(d => (d.driver_username || d.driver_name || '—') === ds.username)
              .sort((a, b) => completedAt(b).localeCompare(completedAt(a)));
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
                      <span className="text-xs text-gray-500">📦 {ds.points} доставок</span>
                      {ds.routes > 0 && <span className="text-xs text-gray-400">🧭 {ds.routes} маршрутов</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold text-emerald-600">{ds.km} км</div>
                    <div className="text-[10px] text-gray-400">туда-обратно {ds.km * 2} км</div>
                  </div>
                  <span className="text-gray-400 text-sm shrink-0">{isOpen ? '▲' : '▼'}</span>
                </button>

                {/* Доставки водителя */}
                {isOpen && (
                  <div className="border-t border-gray-100 bg-gray-50/50">
                    {driverDeliveries.length === 0 ? (
                      <p className="text-gray-400 text-sm p-4 text-center">Нет доставок за период</p>
                    ) : (
                      <div className="flex flex-col divide-y divide-gray-100">
                        {driverDeliveries.map((d, i) => (
                          <div key={d.id} className="px-4 py-2.5 flex items-start gap-2">
                            <span className="text-xs text-gray-300 w-5 shrink-0">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">
                                {d.doc_number ? `№ ${d.doc_number} · ` : ''}{d.client_name || d.to_name || d.from_name || '—'}
                              </div>
                              {d.address && <div className="text-xs text-gray-400 truncate">📍 {d.address}</div>}
                              <div className="flex flex-wrap gap-2 mt-0.5">
                                <span className="text-xs text-gray-400">📅 {fmt(completedAt(d))}</span>
                                {d.km > 0 && <span className="text-xs text-emerald-600">🛣️ {d.km} км</span>}
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
  );
}
