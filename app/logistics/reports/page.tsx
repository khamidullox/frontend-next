'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import AdminGate from '@/components/AdminGate';
import { listRoutes, getRoute, Route, RouteWithDeliveries, Delivery, DeliveryStatus } from '@/lib/api';

function fmt(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
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

export default function LogisticsReportsPage() {
  return (
    <AdminGate min="manager">
      <ReportsContent />
    </AdminGate>
  );
}

function ReportsContent() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Record<string, RouteWithDeliveries | null>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const [filterDriver, setFilterDriver] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'finished'>('all');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  useEffect(() => {
    listRoutes()
      .then(setRoutes)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const drivers = useMemo(() => [...new Set(routes.map(r => r.driver_name))].sort(), [routes]);

  const filtered = useMemo(() => {
    return routes.filter(r => {
      if (filterDriver && r.driver_name !== filterDriver) return false;
      if (filterStatus !== 'all' && r.status !== filterStatus) return false;
      if (filterFrom && r.started_at < filterFrom) return false;
      if (filterTo && r.started_at > filterTo + 'T23:59:59') return false;
      return true;
    });
  }, [routes, filterDriver, filterStatus, filterFrom, filterTo]);

  // Агрегаты по фильтру
  const totals = useMemo(() => filtered.reduce((s, r) => ({
    km: s.km + (r.total_km || 0),
    routes: s.routes + 1,
  }), { km: 0, routes: 0 }), [filtered]);

  async function toggleRoute(id: string) {
    if (expanded[id] !== undefined) {
      setExpanded(p => ({ ...p, [id]: undefined as unknown as null }));
      return;
    }
    setLoadingId(id);
    try {
      const full = await getRoute(id);
      setExpanded(p => ({ ...p, [id]: full }));
    } catch {
      setExpanded(p => ({ ...p, [id]: null }));
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Link href="/logistics" className="text-sm text-gray-500 hover:text-gray-700">← Логистика</Link>
        <h2 className="text-xl font-bold ml-1">📊 Отчёты по маршрутам</h2>
        <span className="text-sm text-gray-400 ml-auto">{filtered.length} маршрутов</span>
      </div>

      {/* Фильтры */}
      <div className="bg-white rounded-xl shadow-sm p-3 mb-4 flex flex-wrap gap-2">
        <select value={filterDriver} onChange={e => setFilterDriver(e.target.value)}
          className="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white outline-none focus:border-blue-400">
          <option value="">👤 Все водители</option>
          {drivers.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}
          className="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white outline-none focus:border-blue-400">
          <option value="all">Все статусы</option>
          <option value="finished">✅ Завершённые</option>
          <option value="active">🟢 Активные</option>
        </select>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
          className="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
        <span className="self-center text-gray-400 text-sm">—</span>
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
          className="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
        {(filterDriver || filterStatus !== 'all' || filterFrom || filterTo) && (
          <button onClick={() => { setFilterDriver(''); setFilterStatus('all'); setFilterFrom(''); setFilterTo(''); }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2">✕ Сбросить</button>
        )}
      </div>

      {/* Сводка */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {[
            { label: 'Маршрутов', value: totals.routes },
            { label: 'Км (туда)', value: `${totals.km} км` },
            { label: 'Км (туда-обратно)', value: `${totals.km * 2} км` },
            { label: 'Ср. км на маршрут', value: totals.routes > 0 ? `${Math.round(totals.km / totals.routes)} км` : '—' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-xl shadow-sm p-3 text-center">
              <div className="text-lg font-bold text-blue-600">{value}</div>
              <div className="text-xs text-gray-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-gray-500">
          <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          Загрузка маршрутов…
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-10 text-center text-gray-400">Маршрутов не найдено</div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map(r => {
            const detail = expanded[r.id];
            const isLoading = loadingId === r.id;

            // Суммарная загрузка из доставок маршрута (если загружен)
            const deliveries: Delivery[] = detail?.deliveries || [];
            const totalWeight = deliveries.reduce((s, d) => s + (d.total_weight || 0), 0);
            const totalVolL = deliveries.reduce((s, d) => s + (d.total_volume_l || 0), 0);
            const delivered = deliveries.filter(d => d.status === 'delivered').length;
            const returned = deliveries.filter(d => d.status === 'returned').length;
            const dur = duration(r.started_at, r.finished_at);

            return (
              <div key={r.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                {/* Заголовок маршрута */}
                <button onClick={() => toggleRoute(r.id)}
                  className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{r.driver_name}</span>
                      {r.car_number && <span className="text-xs text-gray-400">🚗 {r.car_number}</span>}
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        r.status === 'finished' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {r.status === 'finished' ? '✅ Завершён' : '🟢 Активен'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-1">
                      <span className="text-xs text-gray-400">📅 {fmtDate(r.started_at)}</span>
                      <span className="text-xs text-gray-400">🕐 {fmt(r.started_at)}</span>
                      {r.finished_at && <span className="text-xs text-gray-400">→ {fmt(r.finished_at)}</span>}
                      {dur && <span className="text-xs text-blue-500">⏱ {dur}</span>}
                    </div>
                    <div className="flex flex-wrap gap-3 mt-1">
                      {r.total_km > 0 && (
                        <>
                          <span className="text-xs font-medium text-emerald-600">🛣️ {r.total_km} км (туда)</span>
                          <span className="text-xs text-gray-400">= {r.total_km * 2} км туда-обратно</span>
                        </>
                      )}
                      <span className="text-xs text-gray-500">📦 {r.delivery_ids.length} точек</span>
                      {detail && totalWeight > 0 && (
                        <span className="text-xs text-gray-500">⚖️ {Math.round(totalWeight)} кг</span>
                      )}
                      {detail && totalVolL > 0 && (
                        <span className="text-xs text-gray-500">📐 {(totalVolL / 1000).toFixed(2)} м³</span>
                      )}
                      {detail && (
                        <span className="text-xs text-green-600">✓ {delivered} доставлено</span>
                      )}
                      {detail && returned > 0 && (
                        <span className="text-xs text-red-500">↩ {returned} возврат</span>
                      )}
                    </div>
                  </div>
                  <span className="text-gray-400 text-sm shrink-0 mt-1">
                    {isLoading ? '⏳' : expanded[r.id] !== undefined ? '▲' : '▼'}
                  </span>
                </button>

                {/* Детали доставок */}
                {expanded[r.id] !== undefined && (
                  <div className="border-t border-gray-100">
                    {detail === null ? (
                      <p className="text-red-500 text-sm p-4">Ошибка загрузки</p>
                    ) : detail && deliveries.length === 0 ? (
                      <p className="text-gray-400 text-sm p-4 text-center">Нет доставок</p>
                    ) : (
                      <div className="flex flex-col divide-y divide-gray-50">
                        {deliveries.map((d, i) => (
                          <div key={d.id} className="px-4 py-2.5 flex items-start gap-3">
                            <span className="text-xs text-gray-300 w-5 shrink-0 mt-0.5">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{d.client_name || '—'}</div>
                              {d.address && <div className="text-xs text-gray-400 truncate">📍 {d.address}</div>}
                              <div className="flex flex-wrap gap-2 mt-0.5">
                                {d.km > 0 && <span className="text-xs text-gray-400">🛣️ {d.km} км</span>}
                                {d.total_weight > 0 && <span className="text-xs text-gray-400">⚖️ {d.total_weight} кг</span>}
                                {d.total_volume_l > 0 && <span className="text-xs text-gray-400">📦 {(d.total_volume_l / 1000).toFixed(2)} м³</span>}
                                {d.direction && <span className="text-xs text-blue-400">{d.direction}</span>}
                              </div>
                            </div>
                            <span className={`text-xs font-medium shrink-0 ${STATUS_COLOR[d.status]}`}>
                              {STATUS_LABEL[d.status]}
                            </span>
                          </div>
                        ))}
                        {/* Итого по маршруту */}
                        {deliveries.length > 0 && (
                          <div className="px-4 py-2.5 bg-gray-50 flex flex-wrap gap-4 text-xs font-semibold text-gray-600">
                            <span>Итого: {deliveries.length} точек</span>
                            {r.total_km > 0 && <span>🛣️ {r.total_km} × 2 = {r.total_km * 2} км</span>}
                            {totalWeight > 0 && <span>⚖️ {Math.round(totalWeight)} кг</span>}
                            {totalVolL > 0 && <span>📐 {(totalVolL / 1000).toFixed(2)} м³</span>}
                            <span className="text-green-600">✓ {delivered}/{deliveries.length}</span>
                          </div>
                        )}
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
