'use client';

import { useEffect, useState, useMemo } from 'react';
import { listDeliveries, Delivery, DeliveryStatus } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { fmtDateTimeYear as fmt } from '@/lib/format';

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  new: 'Новая', assigned: 'Назначено', on_way: 'В пути', delivered: 'Доставлено', returned: 'Возврат',
};
const STATUS_COLOR: Record<DeliveryStatus, string> = {
  new: 'text-gray-400', assigned: 'text-amber-500', on_way: 'text-blue-500',
  delivered: 'text-green-600', returned: 'text-red-500',
};

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Дата завершения доставки: из истории (delivered/returned), иначе updated_at.
function completedAt(d: Delivery): string {
  const h = (d.history || []).filter((x) => x.status === 'delivered' || x.status === 'returned');
  return h.length ? h[h.length - 1].at : d.updated_at;
}

// Ключ «выезда»: реальный маршрут (route_id), либо — если доставка завершена
// напрямую без маршрута — группируем по минуте завершения (такие накладные
// обычно отмечают «Доставлено» одной пачкой за один выезд).
function tripKey(d: Delivery): string {
  if (d.route_id) return `r:${d.route_id}`;
  return `t:${completedAt(d).slice(0, 16)}`;
}

// «Мои расчёты» — то же, что у логиста в «Отчётах по водителям», но только для
// своих доставок (сервер сам отдаёт водителю лишь его данные, см. /api/deliveries).
export default function MyStatsPage() {
  const { session } = useAuth();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [quick, setQuick] = useState<'today' | 'week' | 'month' | 'all'>('all');

  useEffect(() => {
    listDeliveries()
      .then(setDeliveries)
      .catch((e) => setError((e as Error).message))
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

  const periodDeliveries = useMemo(() => deliveries.filter((d) => {
    if (d.status !== 'delivered' && d.status !== 'returned') return false;
    const when = completedAt(d);
    if (filterFrom && when < filterFrom) return false;
    if (filterTo && when > filterTo + 'T23:59:59') return false;
    return true;
  }), [deliveries, filterFrom, filterTo]);

  const trips = useMemo(() => {
    const sorted = [...periodDeliveries].sort((a, b) => completedAt(b).localeCompare(completedAt(a)));
    const map = new Map<string, Delivery[]>();
    for (const d of sorted) {
      const k = tripKey(d);
      const arr = map.get(k) || [];
      arr.push(d);
      map.set(k, arr);
    }
    return [...map.values()];
  }, [periodDeliveries]);

  const totalKm = periodDeliveries.reduce((s, d) => s + (d.km || 0), 0);
  const periodLabel = quick === 'today' ? 'сегодня' : quick === 'week' ? 'за 7 дней' : quick === 'month' ? 'за 30 дней' : 'за всё время';

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold">📊 Мои расчёты</h2>
        {session && <p className="text-xs text-gray-400 mt-0.5">{session.name}</p>}
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
        <input type="date" value={filterFrom} onChange={(e) => { setFilterFrom(e.target.value); setQuick('all'); }}
          className="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
        <span className="self-center text-gray-400 text-sm">—</span>
        <input type="date" value={filterTo} onChange={(e) => { setFilterTo(e.target.value); setQuick('all'); }}
          className="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
      </div>

      {/* Сводка */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: 'Выездов', value: trips.length },
          { label: 'Доставок', value: periodDeliveries.length },
          { label: 'Км (туда-обратно)', value: `${totalKm * 2} км` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl shadow-sm p-3 text-center">
            <div className="text-lg font-bold text-blue-600">{value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{label}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 mb-3">Показано {periodLabel}</p>

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-2 text-gray-500">
          <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          Загрузка…
        </div>
      ) : trips.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">Нет завершённых доставок за период</div>
      ) : (
        <div className="flex flex-col gap-2">
          {trips.map((group, gi) => {
            const tripKm = group.reduce((s, d) => s + (d.km || 0), 0);
            return (
              <div key={tripKey(group[0])} className="rounded-xl border border-gray-100 overflow-hidden bg-white shadow-sm">
                <div className="px-3 py-2 bg-gray-50 flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-700">🚐 Выезд {gi + 1}</span>
                  <span className="text-xs text-gray-400">· {group.length} {group.length === 1 ? 'накладная' : 'накладных'}</span>
                  {tripKm > 0 && <span className="text-xs text-emerald-600">🛣️ {tripKm * 2} км</span>}
                  <span className="text-xs text-gray-400 ml-auto">📅 {fmt(completedAt(group[0]))}</span>
                </div>
                <div className="flex flex-col divide-y divide-gray-100">
                  {group.map((d, i) => (
                    <div key={d.id} className="px-3 py-2 flex items-start gap-2">
                      <span className="text-xs text-gray-300 w-5 shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {d.doc_number ? `№ ${d.doc_number} · ` : ''}{d.client_name || d.to_name || d.from_name || '—'}
                        </div>
                        {d.address && <div className="text-xs text-gray-400 truncate">📍 {d.address}</div>}
                        <div className="flex flex-wrap gap-2 mt-0.5">
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
