'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import Link from 'next/link';
import AdminGate from '@/components/AdminGate';
import {
  listRoutes, listDrivers, listDeliveries, deleteRouteApi,
  fetchLogisticsSettings, saveLogisticsSettings, LogisticsSettings, CAP_DEFAULT_KEY, vehicleFamily,
  Route, UserInfo, Delivery, DeliveryStatus,
} from '@/lib/api';
import { fmtDateTimeYear as fmt } from '@/lib/format';
import { normalizeName } from '@/lib/normalize';

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

// Ставка для вида транспорта: точная модель → семейство → «Прочие».
// Используется и для ставки за км, и для ставки за точку (передаётся нужная таблица).
function rateForType(transport: string | null | undefined, rates: Record<string, number>): number {
  const key = (transport || '').trim();
  if (key && rates[key] !== undefined) return rates[key];
  const family = vehicleFamily(key);
  if (family && rates[family] !== undefined) return rates[family];
  return rates[CAP_DEFAULT_KEY] ?? 0;
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

// Ключ «выезда»: реальный маршрут (route_id), либо — если доставка завершена
// напрямую без маршрута — группируем по водителю + минуте завершения (такие
// накладные обычно отмечают «Доставлено» одной пачкой за один выезд).
function tripKey(d: Delivery): string {
  if (d.route_id) return `r:${d.route_id}`;
  const driverKey = d.driver_username || d.driver_name || '—';
  return `t:${driverKey}:${completedAt(d).slice(0, 16)}`;
}

// Точка доставки = пункт назначения (магазин/клиент). Несколько накладных с разных
// складов в один магазин — это одна точка. shop_id, иначе нормализованное имя получателя.
function destKey(d: Delivery): string {
  return d.shop_id || normalizeName(d.to_name || d.client_name || d.address || '') || 'no-dest';
}

// «Точка за выезд»: одна и та же точка в разных выездах считается отдельно.
function tripStopKey(d: Delivery): string {
  return `${tripKey(d)}::${destKey(d)}`;
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

  // КПИ — ставка за км по виду транспорта (редактируется прямо в отчёте).
  const [settings, setSettings] = useState<LogisticsSettings | null>(null);
  const [rateType, setRateType] = useState<string>(CAP_DEFAULT_KEY);
  const rateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([listRoutes(), listDrivers(), listDeliveries(), fetchLogisticsSettings()])
      .then(([r, d, dl, s]) => { setRoutes(r); setDrivers(d); setDeliveries(dl); setSettings(s); })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const vehicleTypes = useMemo(() => {
    const set = new Set<string>();
    for (const d of drivers) {
      const t = (d.transport || '').trim();
      if (t) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [drivers]);

  const FAMILY_TYPES = ['LABO', 'Газель'];
  const rateTypeOptions = [CAP_DEFAULT_KEY, ...FAMILY_TYPES, ...vehicleTypes];
  const effectiveRateType = rateTypeOptions.includes(rateType) ? rateType : CAP_DEFAULT_KEY;
  const currentRate = settings?.rate_by_type[effectiveRateType] ?? 0;

  async function saveRate(val: string) {
    if (!settings) return;
    const n = Math.max(0, Number(val) || 0);
    const next = { ...settings.rate_by_type, [effectiveRateType]: n };
    setSettings((prev) => (prev ? { ...prev, rate_by_type: next } : prev));
    await saveLogisticsSettings({ rate_by_type: next }).catch(() => {});
  }

  const currentPointRate = settings?.point_rate_by_type[effectiveRateType] ?? 0;
  async function savePointRate(val: string) {
    if (!settings) return;
    const n = Math.max(0, Number(val) || 0);
    const next = { ...settings.point_rate_by_type, [effectiveRateType]: n };
    setSettings((prev) => (prev ? { ...prev, point_rate_by_type: next } : prev));
    await saveLogisticsSettings({ point_rate_by_type: next }).catch(() => {});
  }

  const currentFuelRate = settings?.fuel_rate_by_type[effectiveRateType] ?? 0;
  async function saveFuelRate(val: string) {
    if (!settings) return;
    const n = Math.max(0, Number(val) || 0);
    const next = { ...settings.fuel_rate_by_type, [effectiveRateType]: n };
    setSettings((prev) => (prev ? { ...prev, fuel_rate_by_type: next } : prev));
    await saveLogisticsSettings({ fuel_rate_by_type: next }).catch(() => {});
  }

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

  // Агрегация по водителю: доставки, км, выезды (уникальные tripKey), точки доставки
  // (уникальные tripStopKey — несколько накладных с разных складов в один магазин за
  // один выезд считаются одной точкой; тот же магазин в другом выезде — другая точка).
  const driverStats = useMemo(() => {
    const m = new Map<string, { username: string; name: string; car: string; transport: string; trips: Set<string>; stops: Set<string>; km: number; points: number }>();
    for (const d of drivers) {
      m.set(d.username, { username: d.username, name: d.name, car: d.car_number || '', transport: d.transport || '', trips: new Set(), stops: new Set(), km: 0, points: 0 });
    }
    for (const d of periodDeliveries) {
      const key = d.driver_username || d.driver_name || '—';
      const cur = m.get(key) || { username: key, name: d.driver_name || key, car: d.car_number || '', transport: d.transport || '', trips: new Set<string>(), stops: new Set<string>(), km: 0, points: 0 };
      cur.km += d.km || 0;
      cur.points += 1;
      cur.trips.add(tripKey(d));
      cur.stops.add(tripStopKey(d));
      if (!cur.car && d.car_number) cur.car = d.car_number;
      if (!cur.transport && d.transport) cur.transport = d.transport;
      m.set(key, cur);
    }
    const rates = settings?.rate_by_type ?? {};
    const pointRates = settings?.point_rate_by_type ?? {};
    const fuelRates = settings?.fuel_rate_by_type ?? {};
    return [...m.values()]
      .map(d => ({
        username: d.username, name: d.name, car: d.car, km: d.km, points: d.points, trips: d.trips.size,
        stops: d.stops.size,
        kpi: Math.round(d.km * rateForType(d.transport, rates)),
        pointKpi: Math.round(d.stops.size * rateForType(d.transport, pointRates)),
        // Топливо — по фактически пройденному пути (туда-обратно), отсюда ×2, ставка своя
        // для каждого вида транспорта (расход у LABO и Газели разный).
        fuel: Math.round(d.km * 2 * rateForType(d.transport, fuelRates)),
      }))
      .sort((a, b) => b.points - a.points || b.km - a.km || a.name.localeCompare(b.name, 'ru'));
  }, [drivers, periodDeliveries, settings]);

  const totals = useMemo(() => driverStats.reduce((s, d) => ({
    km: s.km + d.km, trips: s.trips + d.trips, points: s.points + d.points, stops: s.stops + d.stops,
    kpi: s.kpi + d.kpi, pointKpi: s.pointKpi + d.pointKpi, fuel: s.fuel + d.fuel,
  }), { km: 0, trips: 0, points: 0, stops: 0, kpi: 0, pointKpi: 0, fuel: 0 }), [driverStats]);

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
        <Link href="/logistics/clients"
          className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700">
          👥 База клиентов
        </Link>
        {emptyRoutes.length > 0 && (
          <button onClick={removeEmpty}
            className="ml-auto px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold rounded-lg whitespace-nowrap">
            🗑 Удалить пустые ({emptyRoutes.length})
          </button>
        )}
        <span className={`text-sm text-gray-400 ${emptyRoutes.length > 0 ? '' : 'ml-auto'}`}>{driverStats.filter(d => d.trips > 0).length} активных · {periodLabel}</span>
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

      {/* КПИ — ставка за км по виду транспорта */}
      {settings && (
        <div className="bg-white rounded-xl shadow-sm p-3 mb-4 flex flex-wrap items-center gap-3">
          <span className="text-xs text-gray-500 whitespace-nowrap">💰 КПИ (сум/км):</span>
          <select value={effectiveRateType} onChange={(e) => setRateType(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-400 max-w-[220px]">
            <option value={CAP_DEFAULT_KEY}>Прочие (по умолчанию)</option>
            {FAMILY_TYPES.map((t) => (
              <option key={t} value={t}>{t} (все модели)</option>
            ))}
            {vehicleTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input key={effectiveRateType} ref={rateInputRef} type="number" min={0} step={100} defaultValue={currentRate}
            onBlur={(e) => saveRate(e.target.value)}
            className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right outline-none focus:border-blue-400" />
          <span className="text-[11px] text-gray-400">сум/км</span>
          <span className="w-px h-6 bg-gray-200 mx-1" />
          <span className="text-xs text-gray-500 whitespace-nowrap">📍 За точку:</span>
          <input key={`pt-${effectiveRateType}`} type="number" min={0} step={500} defaultValue={currentPointRate}
            onBlur={(e) => savePointRate(e.target.value)}
            className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right outline-none focus:border-blue-400" />
          <span className="text-[11px] text-gray-400">сум/точку</span>
          <span className="w-px h-6 bg-gray-200 mx-1" />
          <span className="text-xs text-gray-500 whitespace-nowrap">⛽ Топливо (сум/км):</span>
          <input key={`fuel-${effectiveRateType}`} type="number" min={0} step={100} defaultValue={currentFuelRate}
            onBlur={(e) => saveFuelRate(e.target.value)}
            className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right outline-none focus:border-blue-400" />
          <span className="text-[11px] text-gray-400 basis-full">
            КПИ — пройденный км (в одну сторону) × ставка транспорта. За точку — число точек доставки (магазин за выезд,
            независимо от числа накладных/складов) × ставка. Топливо — по факту туда-обратно (км × 2 × ставка), своя
            ставка для каждого вида транспорта — выберите его в списке выше.
          </span>
        </div>
      )}

      {/* Сводка по всем */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-8 gap-2 mb-4">
        {[
          { label: 'Выездов', value: `${totals.trips}` },
          { label: 'Точек доставки', value: `${totals.stops}` },
          { label: 'Доставок', value: `${totals.points}` },
          { label: 'Км (туда-обратно)', value: `${totals.km * 2} км` },
          { label: 'КПИ за км', value: `${totals.kpi.toLocaleString('ru-RU')} сум` },
          { label: 'КПИ за точки', value: `${totals.pointKpi.toLocaleString('ru-RU')} сум` },
          { label: 'Топливо', value: `${totals.fuel.toLocaleString('ru-RU')} сум` },
          { label: 'Итого расходы', value: `${(totals.kpi + totals.pointKpi + totals.fuel).toLocaleString('ru-RU')} сум`, accent: true },
        ].map(({ label, value, accent }) => (
          <div key={label} className="bg-white rounded-xl shadow-sm p-3 text-center">
            <div className={`text-lg font-bold ${accent ? 'text-rose-600' : 'text-blue-600'}`}>{value}</div>
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
            // Группируем доставки в «выезды»: по реальному маршруту, либо синтетически
            // по времени завершения (см. tripKey) — так видно сколько было заходов.
            const tripMap = new Map<string, Delivery[]>();
            for (const d of driverDeliveries) {
              const k = tripKey(d);
              const arr = tripMap.get(k) || [];
              arr.push(d);
              tripMap.set(k, arr);
            }
            const trips = [...tripMap.values()];
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
                      {ds.stops > 0 && <span className="text-xs text-gray-500">📍 {ds.stops} точек</span>}
                      {ds.trips > 0 && <span className="text-xs text-gray-400">🚐 {ds.trips} выездов</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold text-emerald-600">{ds.km} км</div>
                    <div className="text-[10px] text-gray-400">туда-обратно {ds.km * 2} км</div>
                    {ds.kpi > 0 && <div className="text-[11px] font-semibold text-amber-600 mt-0.5">💰 за км {ds.kpi.toLocaleString('ru-RU')} сум</div>}
                    {ds.pointKpi > 0 && <div className="text-[11px] font-semibold text-amber-600">📍 за точки {ds.pointKpi.toLocaleString('ru-RU')} сум</div>}
                    {ds.fuel > 0 && <div className="text-[11px] text-gray-500">⛽ {ds.fuel.toLocaleString('ru-RU')} сум</div>}
                  </div>
                  <span className="text-gray-400 text-sm shrink-0">{isOpen ? '▲' : '▼'}</span>
                </button>

                {/* Доставки водителя, сгруппированные по выездам */}
                {isOpen && (
                  <div className="border-t border-gray-100 bg-gray-50/50 p-2.5 flex flex-col gap-2">
                    {trips.length === 0 ? (
                      <p className="text-gray-400 text-sm py-4 text-center">Нет доставок за период</p>
                    ) : (
                      trips.map((group, gi) => {
                        const tripKm = group.reduce((s, d) => s + (d.km || 0), 0);
                        const stopsInTrip = new Set(group.map((d) => destKey(d))).size;
                        return (
                          <div key={tripKey(group[0])} className="rounded-lg border border-gray-100 overflow-hidden bg-white">
                            <div className="px-3 py-1.5 bg-gray-100 flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold text-gray-600">🚐 Выезд {gi + 1}</span>
                              <span className="text-[11px] text-gray-400">· {group.length} {group.length === 1 ? 'накладная' : 'накладных'}</span>
                              <span className="text-[11px] text-gray-400">· {stopsInTrip} {stopsInTrip === 1 ? 'точка' : 'точек'}</span>
                              {tripKm > 0 && <span className="text-[11px] text-emerald-600">🛣️ {tripKm} км</span>}
                              <span className="text-[11px] text-gray-400 ml-auto">📅 {fmt(completedAt(group[0]))}</span>
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
                                    {d.lat != null && d.lng != null && (
                                      <div className="text-xs truncate">
                                        <a href={`https://yandex.ru/maps/?pt=${d.lng},${d.lat}&z=16&l=map`} target="_blank" rel="noopener noreferrer"
                                          className="text-emerald-600 hover:underline">🗺️ Яндекс</a>
                                        {' · '}
                                        <a href={`https://www.google.com/maps?q=${d.lat},${d.lng}`} target="_blank" rel="noopener noreferrer"
                                          className="text-emerald-600 hover:underline">Google</a>
                                        <span className="text-gray-400"> · {d.lat.toFixed(5)}, {d.lng.toFixed(5)}</span>
                                      </div>
                                    )}
                                    {d.shop_name && <div className="text-xs text-gray-400 truncate">🏪 откуда: {d.shop_name}</div>}
                                    {d.client_phone && (
                                      <div className="text-xs text-gray-400 truncate">
                                        📞 <a href={`tel:${d.client_phone}`} className="text-sky-600">{d.client_phone}</a>
                                      </div>
                                    )}
                                    <div className="flex flex-wrap gap-2 mt-0.5">
                                      {d.km > 0 && <span className="text-xs text-emerald-600">🛣️ {d.km} км</span>}
                                      {d.shop_distance_km != null && d.shop_distance_km !== d.km && (
                                        <span className="text-xs text-gray-400" title="Прямое расстояние от магазина до клиента, без учёта цепочки маршрута">
                                          🏪→📍 {d.shop_distance_km} км
                                        </span>
                                      )}
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
                      })
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
