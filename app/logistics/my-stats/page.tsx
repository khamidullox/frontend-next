'use client';

import { useEffect, useState, useMemo } from 'react';
import { listDeliveries, getMyRates, Delivery, DeliveryStatus, MyTripRate } from '@/lib/api';
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

// Точка доставки в рамках выезда (магазин/клиент) — платят за точку, не за накладную.
function destKey(d: Delivery): string {
  if (d.kind === 'shop_to_client') {
    if (d.lat != null && d.lng != null) return `${d.lat.toFixed(4)},${d.lng.toFixed(4)}`;
    return (d.client_phone || d.client_name || d.address || '').trim().toLowerCase() || 'no-dest';
  }
  return d.shop_id || (d.to_name || d.client_name || d.address || '').trim().toLowerCase() || 'no-dest';
}

// КПИ выезда: км × своя ставка за км + число точек × своя ставка за точку (ставки
// приходят с сервера через /api/logistics/my-rates — не вся тарифная таблица, только
// то, что относится к выездам этого водителя, см. lib.kmRate/pointRate комментарий там).
function tripEarnings(group: Delivery[], rate: MyTripRate | undefined) {
  if (!rate) return { kmPay: 0, pointPay: 0, points: 0 };
  const km = group.reduce((s, d) => s + (d.km || 0), 0);
  const points = new Set(group.map(destKey)).size;
  return {
    kmPay: Math.round(km * rate.kmRate),
    pointPay: Math.round(points * rate.pointRate),
    points,
  };
}

// «Мои расчёты» — то же, что у логиста в «Отчётах по водителям», но только для
// своих доставок (сервер сам отдаёт водителю лишь его данные, см. /api/deliveries),
// плюс свои ставки за км/точку (см. /api/logistics/my-rates) — без доступа к полной
// тарифной таблице, которая видна только менеджеру.
export default function MyStatsPage() {
  const { session } = useAuth();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [rates, setRates] = useState<Record<string, MyTripRate>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [quick, setQuick] = useState<'today' | 'week' | 'thisMonth' | 'all'>('today');

  useEffect(() => {
    Promise.all([listDeliveries(), getMyRates()])
      .then(([d, r]) => { setDeliveries(d); setRates(r); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  function applyQuick(q: typeof quick) {
    setQuick(q);
    const now = new Date();
    if (q === 'all') { setFilterFrom(''); setFilterTo(''); return; }
    if (q === 'today') { const t = isoDate(now); setFilterFrom(t); setFilterTo(t); return; }
    if (q === 'thisMonth') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      setFilterFrom(isoDate(from)); setFilterTo(isoDate(now));
      return;
    }
    const from = new Date(now);
    from.setDate(from.getDate() - 7);
    setFilterFrom(isoDate(from)); setFilterTo(isoDate(now));
  }

  // Применяем дефолтный быстрый фильтр («сегодня») при первой загрузке.
  useEffect(() => { applyQuick('today'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const periodDeliveries = useMemo(() => deliveries.filter((d) => {
    if (d.status !== 'delivered' && d.status !== 'returned') return false;
    const when = completedAt(d);
    if (filterFrom && when < filterFrom) return false;
    if (filterTo && when > filterTo + 'T23:59:59') return false;
    return true;
  }), [deliveries, filterFrom, filterTo]);

  // Сегодняшние доставки — отдельно от выбранного фильтра периода, чтобы «сколько
  // заработал сегодня» было видно всегда, даже если открыт «Этот месяц»/«Всё время».
  const todayDeliveries = useMemo(() => {
    const t = isoDate(new Date());
    return deliveries.filter((d) => d.status === 'delivered' && completedAt(d).slice(0, 10) === t);
  }, [deliveries]);

  function groupTrips(list: Delivery[]) {
    const sorted = [...list].sort((a, b) => completedAt(b).localeCompare(completedAt(a)));
    const map = new Map<string, Delivery[]>();
    for (const d of sorted) {
      const k = tripKey(d);
      const arr = map.get(k) || [];
      arr.push(d);
      map.set(k, arr);
    }
    return [...map.values()];
  }

  const trips = useMemo(() => groupTrips(periodDeliveries), [periodDeliveries]);
  const todayTrips = useMemo(() => groupTrips(todayDeliveries), [todayDeliveries]);

  const totalKm = periodDeliveries.reduce((s, d) => s + (d.km || 0), 0);
  const periodEarnings = trips.reduce((s, group) => {
    const e = tripEarnings(group.filter((d) => d.status === 'delivered'), rates[tripKey(group[0])]);
    return { kmPay: s.kmPay + e.kmPay, pointPay: s.pointPay + e.pointPay };
  }, { kmPay: 0, pointPay: 0 });
  const todayEarnings = todayTrips.reduce((s, group) => {
    const e = tripEarnings(group, rates[tripKey(group[0])]);
    return { kmPay: s.kmPay + e.kmPay, pointPay: s.pointPay + e.pointPay };
  }, { kmPay: 0, pointPay: 0 });

  const periodLabel = quick === 'today' ? 'сегодня' : quick === 'week' ? 'за 7 дней' : quick === 'thisMonth' ? 'за этот месяц' : 'за всё время';

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold">📊 Мои расчёты</h2>
        {session && <p className="text-xs text-gray-400 mt-0.5">{session.name}</p>}
      </div>

      {/* Сегодня — всегда видно, независимо от выбранного периода ниже */}
      {(todayEarnings.kmPay > 0 || todayEarnings.pointPay > 0 || todayDeliveries.length > 0) && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-4 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-semibold text-emerald-700">📅 Сегодня</span>
          <span className="flex items-center gap-3 text-xs flex-wrap">
            <span className="text-gray-500">{todayDeliveries.length} доставок</span>
            {todayEarnings.kmPay > 0 && <span className="font-semibold text-amber-600">🛣️ {todayEarnings.kmPay.toLocaleString('ru-RU')} сум</span>}
            {todayEarnings.pointPay > 0 && <span className="font-semibold text-amber-600">📍 {todayEarnings.pointPay.toLocaleString('ru-RU')} сум</span>}
            <span className="font-bold text-emerald-700">
              = {(todayEarnings.kmPay + todayEarnings.pointPay).toLocaleString('ru-RU')} сум
            </span>
          </span>
        </div>
      )}

      {/* Быстрые периоды + диапазон дат */}
      <div className="bg-white rounded-xl shadow-sm p-3 mb-4 flex flex-wrap gap-2 items-center">
        {([['today', 'Сегодня'], ['week', '7 дней'], ['thisMonth', 'Этот месяц'], ['all', 'Всё время']] as const).map(([q, label]) => (
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

      {/* Сводка за выбранный период */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        {[
          { label: 'Выездов', value: trips.length },
          { label: 'Доставок', value: periodDeliveries.length },
          { label: 'Км (туда-обратно)', value: `${totalKm * 2} км` },
          { label: 'Итого', value: `${(periodEarnings.kmPay + periodEarnings.pointPay).toLocaleString('ru-RU')} сум` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl shadow-sm p-3 text-center">
            <div className="text-lg font-bold text-blue-600">{value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{label}</div>
          </div>
        ))}
      </div>
      {(periodEarnings.kmPay > 0 || periodEarnings.pointPay > 0) && (
        <div className="bg-white rounded-xl shadow-sm p-3 mb-4 flex items-center justify-center gap-4 text-sm">
          <span className="text-gray-500">🛣️ за км: <span className="font-semibold text-amber-600">{periodEarnings.kmPay.toLocaleString('ru-RU')} сум</span></span>
          <span className="text-gray-300">·</span>
          <span className="text-gray-500">📍 за точки: <span className="font-semibold text-amber-600">{periodEarnings.pointPay.toLocaleString('ru-RU')} сум</span></span>
        </div>
      )}
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
            const rate = rates[tripKey(group[0])];
            const e = tripEarnings(group.filter((d) => d.status === 'delivered'), rate);
            const billedStops = new Set<string>();
            return (
              <div key={tripKey(group[0])} className="rounded-xl border border-gray-100 overflow-hidden bg-white shadow-sm">
                <div className="px-3 py-2 bg-gray-50 flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-700">🚐 Выезд {gi + 1}</span>
                  <span className="text-xs text-gray-400">· {group.length} {group.length === 1 ? 'накладная' : 'накладных'}</span>
                  {tripKm > 0 && <span className="text-xs text-emerald-600">🛣️ {tripKm * 2} км</span>}
                  {e.kmPay > 0 && <span className="text-xs font-semibold text-amber-600">💰 {e.kmPay.toLocaleString('ru-RU')} сум за км</span>}
                  {e.pointPay > 0 && <span className="text-xs font-semibold text-amber-600">📍 {e.pointPay.toLocaleString('ru-RU')} сум за точки</span>}
                  <span className="text-xs text-gray-400 ml-auto">📅 {fmt(completedAt(group[0]))}</span>
                </div>
                <div className="flex flex-col divide-y divide-gray-100">
                  {group.map((d, i) => {
                    const dk = destKey(d);
                    const showPay = d.status === 'delivered' && rate && rate.pointRate > 0 && !billedStops.has(dk);
                    if (showPay) billedStops.add(dk);
                    return (
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
                        <div className="flex flex-col items-end shrink-0 gap-0.5">
                          <span className={`text-xs font-medium ${STATUS_COLOR[d.status]}`}>
                            {STATUS_LABEL[d.status]}
                          </span>
                          {showPay && (
                            <span className="text-[11px] font-semibold text-amber-600 whitespace-nowrap">
                              💰 {rate!.pointRate.toLocaleString('ru-RU')} сум
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
