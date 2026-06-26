'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import Link from 'next/link';
import AdminGate from '@/components/AdminGate';
import {
  listRoutes, listDrivers, listDeliveries, deleteRouteApi,
  fetchLogisticsSettings, saveLogisticsSettings, LogisticsSettings, LoadRateTier, CAP_DEFAULT_KEY, vehicleFamily, defaultCapacity,
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
// Выезд считается недогруженным, если фактический вес/объём меньше этой доли
// вместимости машины — тогда (если задана) применяется сниженная ставка за точку.
const LOW_LOAD_THRESHOLD = 0.5;

function rateForType(transport: string | null | undefined, rates: Record<string, number>): number {
  const key = (transport || '').trim();
  if (key && rates[key] !== undefined) return rates[key];
  const family = vehicleFamily(key);
  if (family && rates[family] !== undefined) return rates[family];
  return rates[CAP_DEFAULT_KEY] ?? 0;
}

// Сетка тарифов для вида транспорта: точная модель → семейство → «Прочие» (тот же
// принцип, что и rateForType). Пустой массив — сетка не настроена для этого типа.
function tiersForType(transport: string | null | undefined, tiersByType: Record<string, LoadRateTier[]>): LoadRateTier[] {
  const key = (transport || '').trim();
  if (key && tiersByType[key]?.length) return tiersByType[key];
  const family = vehicleFamily(key);
  if (family && tiersByType[family]?.length) return tiersByType[family];
  return tiersByType[CAP_DEFAULT_KEY] || [];
}

// Первый тариф (по возрастанию max_ratio), в который попадает загрузка; null —
// открытый верхний тариф, подходит любой загрузке выше предыдущих границ.
function pickTier(ratio: number, tiers: LoadRateTier[]): LoadRateTier | null {
  if (!tiers.length) return null;
  const sorted = [...tiers].sort((a, b) => (a.max_ratio ?? Infinity) - (b.max_ratio ?? Infinity));
  for (const t of sorted) {
    if (t.max_ratio == null || ratio < t.max_ratio) return t;
  }
  return sorted[sorted.length - 1];
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
  // shop_id значит разное в зависимости от kind: для warehouse_dispatch это пункт
  // назначения (магазин) — годится для дедупа. Для shop_to_client это, наоборот,
  // магазин-ОТПРАВИТЕЛЬ (откуда забрали товар) — у двух доставок к разным клиентам
  // с одного магазина он совпадает, и без этой развилки они считались бы одной и
  // той же точкой (ровно тот же баг, что чинили в lib/deliveries.ts для км).
  if (d.kind === 'shop_to_client') {
    if (d.lat != null && d.lng != null) return `${d.lat.toFixed(4)},${d.lng.toFixed(4)}`;
    // Без пина координат адрес — вольный текст со слов магазина: разные клиенты в
    // одном кишлаке/районе нередко получают одинаковое слово («Joydam», «Markaz» и
    // т.п.), хотя это разные люди и разные точки. Телефон клиента — надёжный
    // идентификатор получателя, поэтому в приоритете перед текстом адреса.
    return normalizeName(d.client_phone || d.client_name || d.address || '') || 'no-dest';
  }
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
  // Синхронный «снимок» settings — функции сохранения ниже читают/пишут его напрямую,
  // не через обновитель setSettings(prev => ...). Раньше next вычислялся ВНУТРИ такого
  // обновителя и читался сразу следующей строкой — но React не гарантирует, что
  // обновитель выполнится до неё, и на практике next иногда уходил на сервер пустым
  // объектом (реальная причина, по которой КПИ/ставки не сохранялись).
  const settingsRef = useRef<LogisticsSettings | null>(null);
  const [rateType, setRateType] = useState<string>(CAP_DEFAULT_KEY);
  const rateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([listRoutes(), listDrivers(), listDeliveries(), fetchLogisticsSettings()])
      .then(([r, d, dl, s]) => { setRoutes(r); setDrivers(d); setDeliveries(dl); setSettings(s); settingsRef.current = s; })
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

  // next считаем синхронно из settingsRef (не из обновителя setSettings — см. комментарий
  // у объявления settingsRef выше).
  async function saveRate(val: string) {
    if (!settingsRef.current) return;
    const n = Math.max(0, Number(val) || 0);
    const next = { ...settingsRef.current.rate_by_type, [effectiveRateType]: n };
    settingsRef.current = { ...settingsRef.current, rate_by_type: next };
    setSettings(settingsRef.current);
    try {
      const saved = await saveLogisticsSettings({ rate_by_type: next });
      settingsRef.current = saved;
      setSettings(saved);
    } catch (e) {
      alert(`Не удалось сохранить КПИ: ${(e as Error).message}`);
    }
  }

  const currentPointRate = settings?.point_rate_by_type[effectiveRateType] ?? 0;
  async function savePointRate(val: string) {
    if (!settingsRef.current) return;
    const n = Math.max(0, Number(val) || 0);
    const next = { ...settingsRef.current.point_rate_by_type, [effectiveRateType]: n };
    settingsRef.current = { ...settingsRef.current, point_rate_by_type: next };
    setSettings(settingsRef.current);
    try {
      const saved = await saveLogisticsSettings({ point_rate_by_type: next });
      settingsRef.current = saved;
      setSettings(saved);
    } catch (e) {
      alert(`Не удалось сохранить ставку за точку: ${(e as Error).message}`);
    }
  }

  const currentLowLoadPointRate = settings?.point_rate_low_load_by_type[effectiveRateType] ?? 0;
  async function saveLowLoadPointRate(val: string) {
    if (!settingsRef.current) return;
    const n = Math.max(0, Number(val) || 0);
    const next = { ...settingsRef.current.point_rate_low_load_by_type, [effectiveRateType]: n };
    settingsRef.current = { ...settingsRef.current, point_rate_low_load_by_type: next };
    setSettings(settingsRef.current);
    try {
      const saved = await saveLogisticsSettings({ point_rate_low_load_by_type: next });
      settingsRef.current = saved;
      setSettings(saved);
    } catch (e) {
      alert(`Не удалось сохранить сниженную ставку: ${(e as Error).message}`);
    }
  }

  const currentFuelRate = settings?.fuel_rate_by_type[effectiveRateType] ?? 0;
  async function saveFuelRate(val: string) {
    if (!settingsRef.current) return;
    const n = Math.max(0, Number(val) || 0);
    const next = { ...settingsRef.current.fuel_rate_by_type, [effectiveRateType]: n };
    settingsRef.current = { ...settingsRef.current, fuel_rate_by_type: next };
    setSettings(settingsRef.current);
    try {
      const saved = await saveLogisticsSettings({ fuel_rate_by_type: next });
      settingsRef.current = saved;
      setSettings(saved);
    } catch (e) {
      alert(`Не удалось сохранить ставку топлива: ${(e as Error).message}`);
    }
  }

  // Тарифная сетка по загрузке — отдельная локальная форма (строки редактируются
  // свободно, сохраняем явной кнопкой, а не по onBlur каждой ячейки, чтобы не уйти
  // на сервер с незаконченной строкой посередине правки).
  interface TierRow { max_ratio: string; km_rate: string; point_rate: string }
  const [tierRows, setTierRows] = useState<TierRow[]>([]);
  useEffect(() => {
    const tiers = settings?.load_rate_tiers_by_type[effectiveRateType] ?? [];
    setTierRows(tiers.map((t) => ({
      max_ratio: t.max_ratio == null ? '' : String(Math.round(t.max_ratio * 100)),
      km_rate: String(t.km_rate),
      point_rate: String(t.point_rate),
    })));
  }, [effectiveRateType, settings]);

  function addTierRow() {
    setTierRows((prev) => [...prev, { max_ratio: '', km_rate: '0', point_rate: '0' }]);
  }
  function removeTierRow(i: number) {
    setTierRows((prev) => prev.filter((_, idx) => idx !== i));
  }
  function updateTierRow(i: number, field: keyof TierRow, val: string) {
    setTierRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
  }
  async function saveTiers() {
    if (!settingsRef.current) return;
    const tiers: LoadRateTier[] = tierRows
      .map((r) => ({
        max_ratio: r.max_ratio.trim() === '' ? null : Math.max(0, Number(r.max_ratio) || 0) / 100,
        km_rate: Math.max(0, Number(r.km_rate) || 0),
        point_rate: Math.max(0, Number(r.point_rate) || 0),
      }))
      .sort((a, b) => (a.max_ratio ?? Infinity) - (b.max_ratio ?? Infinity));
    const next = { ...settingsRef.current.load_rate_tiers_by_type, [effectiveRateType]: tiers };
    settingsRef.current = { ...settingsRef.current, load_rate_tiers_by_type: next };
    setSettings(settingsRef.current);
    try {
      const saved = await saveLogisticsSettings({ load_rate_tiers_by_type: next });
      settingsRef.current = saved;
      setSettings(saved);
    } catch (e) {
      alert(`Не удалось сохранить тарифную сетку: ${(e as Error).message}`);
    }
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

  const driverByUsername = useMemo(() => new Map(drivers.map((d) => [d.username, d])), [drivers]);

  // Один проход по доставкам периода — группируем по выезду (tripKey): км, точки,
  // вес/объём (для загрузки), вид транспорта, водитель. Дальше и доля загрузки
  // выезда, и КПИ за км/точку считаются на основе этой единой агрегации по выезду.
  const tripAggs = useMemo(() => {
    const m = new Map<string, { km: number; stopKeys: Set<string>; weight: number; volL: number; transport: string; username: string; driverKey: string }>();
    for (const d of periodDeliveries) {
      if (d.status === 'returned') continue;
      const tk = tripKey(d);
      const cur = m.get(tk) || {
        km: 0, stopKeys: new Set<string>(), weight: 0, volL: 0,
        transport: '', username: '', driverKey: d.driver_username || d.driver_name || '—',
      };
      cur.km += d.km || 0;
      cur.stopKeys.add(tripStopKey(d));
      cur.weight += d.total_weight || 0;
      cur.volL += d.total_volume_l || 0;
      if (!cur.transport && d.transport) cur.transport = d.transport;
      if (!cur.username && d.driver_username) cur.username = d.driver_username;
      m.set(tk, cur);
    }
    return m;
  }, [periodDeliveries]);

  // Загрузка каждого выезда (вес/объём против вместимости машины) — нужна и для
  // сниженной ставки за точку (старый режим без тарифной сетки), и для выбора тарифа
  // в сетке (новый режим). null — вместимость машины неизвестна (не настроена),
  // скидку/тариф в этом случае не применяем, чтобы не срезать оплату водителю из-за
  // отсутствующей настройки, а не реальной недогрузки.
  const tripFillRatio = useMemo(() => {
    const ratios = new Map<string, number | null>();
    if (!settings) { for (const tk of tripAggs.keys()) ratios.set(tk, null); return ratios; }
    for (const [tk, v] of tripAggs) {
      const driver = driverByUsername.get(v.username);
      const cap = driver && (driver.capacity_kg > 0 || driver.capacity_m3 > 0)
        ? { kg: driver.capacity_kg, m3: driver.capacity_m3 }
        : defaultCapacity(v.transport || driver?.transport, settings);
      if (!cap.kg && !cap.m3) { ratios.set(tk, null); continue; }
      const wRatio = cap.kg > 0 ? v.weight / cap.kg : 0;
      const vRatio = cap.m3 > 0 ? v.volL / (cap.m3 * 1000) : 0;
      ratios.set(tk, Math.max(wRatio, vRatio));
    }
    return ratios;
  }, [tripAggs, driverByUsername, settings]);

  // Агрегация по водителю: суммируем выезды (tripAggs). Если для вида транспорта
  // настроена тарифная сетка по загрузке — ставка за км/точку берётся из тарифа,
  // в который попала загрузка ЭТОГО выезда; иначе — обычная ставка (с учётом
  // прежней сниженной ставки за недогруз < 50%, если она настроена).
  const driverStats = useMemo(() => {
    const rates = settings?.rate_by_type ?? {};
    const pointRates = settings?.point_rate_by_type ?? {};
    const lowLoadPointRates = settings?.point_rate_low_load_by_type ?? {};
    const fuelRates = settings?.fuel_rate_by_type ?? {};
    const tiersByType = settings?.load_rate_tiers_by_type ?? {};

    const m = new Map<string, { username: string; name: string; car: string; transport: string; trips: number; stops: number; km: number; points: number; kpi: number; pointKpi: number; fuel: number }>();
    for (const d of drivers) {
      m.set(d.username, { username: d.username, name: d.name, car: d.car_number || '', transport: d.transport || '', trips: 0, stops: 0, km: 0, points: 0, kpi: 0, pointKpi: 0, fuel: 0 });
    }

    for (const [tk, agg] of tripAggs) {
      const key = agg.driverKey;
      const cur = m.get(key) || { username: key, name: key, car: '', transport: agg.transport, trips: 0, stops: 0, km: 0, points: 0, kpi: 0, pointKpi: 0, fuel: 0 };
      const ratio = tripFillRatio.get(tk) ?? null;
      const tiers = tiersForType(agg.transport, tiersByType);
      const tier = ratio != null ? pickTier(ratio, tiers) : null;

      let kmRate: number;
      let pointRate: number;
      if (tier) {
        kmRate = tier.km_rate;
        pointRate = tier.point_rate;
      } else {
        kmRate = rateForType(agg.transport, rates);
        const fullPointRate = rateForType(agg.transport, pointRates);
        const lowLoadRate = rateForType(agg.transport, lowLoadPointRates);
        pointRate = (ratio != null && ratio < LOW_LOAD_THRESHOLD && lowLoadRate > 0) ? lowLoadRate : fullPointRate;
      }

      cur.trips += 1;
      cur.stops += agg.stopKeys.size;
      cur.km += agg.km;
      cur.kpi += Math.round(agg.km * kmRate);
      cur.pointKpi += Math.round(agg.stopKeys.size * pointRate);
      // Топливо — по фактически пройденному пути (туда-обратно), отсюда ×2; тарифная
      // сетка на топливо не влияет, своя ставка по виду транспорта, как и раньше.
      cur.fuel += Math.round(agg.km * 2 * rateForType(agg.transport, fuelRates));
      if (!cur.transport && agg.transport) cur.transport = agg.transport;
      m.set(key, cur);
    }

    // points (число накладных, не точек) и номер машины — из исходных доставок периода.
    for (const d of periodDeliveries) {
      if (d.status === 'returned') continue;
      const key = d.driver_username || d.driver_name || '—';
      const cur = m.get(key);
      if (!cur) continue;
      cur.points += 1;
      if (!cur.car && d.car_number) cur.car = d.car_number;
    }

    return [...m.values()].sort((a, b) => b.points - a.points || b.km - a.km || a.name.localeCompare(b.name, 'ru'));
  }, [drivers, periodDeliveries, tripAggs, tripFillRatio, settings]);

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
          <span className="text-xs text-gray-500 whitespace-nowrap">📉 За точку, если выезд &lt;50% загружен:</span>
          <input key={`pt-low-${effectiveRateType}`} type="number" min={0} step={500} defaultValue={currentLowLoadPointRate}
            onBlur={(e) => saveLowLoadPointRate(e.target.value)}
            className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right outline-none focus:border-blue-400" />
          <span className="text-[11px] text-gray-400">сум/точку</span>
          <span className="w-px h-6 bg-gray-200 mx-1" />
          <span className="text-xs text-gray-500 whitespace-nowrap">⛽ Топливо (сум/км):</span>
          <input key={`fuel-${effectiveRateType}`} type="number" min={0} step={100} defaultValue={currentFuelRate}
            onBlur={(e) => saveFuelRate(e.target.value)}
            className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right outline-none focus:border-blue-400" />
          <span className="text-[11px] text-gray-400 basis-full">
            КПИ — пройденный км (в одну сторону) × ставка транспорта. За точку — число точек доставки (магазин за выезд,
            независимо от числа накладных/складов) × ставка; если за весь выезд вес/объём в машине меньше 50% её
            вместимости — вместо обычной ставки берётся сниженная (0 — скидка не применяется). Топливо — по факту
            туда-обратно (км × 2 × ставка), своя ставка для каждого вида транспорта — выберите его в списке выше.
          </span>
        </div>
      )}

      {/* Тарифная сетка по загрузке — своя для каждого вида транспорта (выбран выше) */}
      {settings && (
        <div className="bg-white rounded-xl shadow-sm p-3 mb-4">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <span className="text-xs text-gray-500">
              🪜 Тарифная сетка по загрузке для «{effectiveRateType === CAP_DEFAULT_KEY ? 'Прочие' : effectiveRateType}»
              — если задана, заменяет обычные ставки за км/точку выше для этого типа:
            </span>
            <button onClick={addTierRow}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 whitespace-nowrap">
              + тариф
            </button>
          </div>

          {tierRows.length === 0 && (
            <p className="text-xs text-gray-400 mb-2">Сетка не настроена — используются обычные ставки выше.</p>
          )}

          {tierRows.map((r, i) => (
            <div key={i} className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-xs text-gray-500 whitespace-nowrap">загрузка до</span>
              <input type="number" min={0} max={100} value={r.max_ratio} placeholder="100 и выше"
                onChange={(e) => updateTierRow(i, 'max_ratio', e.target.value)}
                className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right outline-none focus:border-blue-400" />
              <span className="text-xs text-gray-400">%</span>
              <span className="text-xs text-gray-500 whitespace-nowrap ml-2">км</span>
              <input type="number" min={0} value={r.km_rate}
                onChange={(e) => updateTierRow(i, 'km_rate', e.target.value)}
                className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right outline-none focus:border-blue-400" />
              <span className="text-xs text-gray-500 whitespace-nowrap ml-2">точка</span>
              <input type="number" min={0} value={r.point_rate}
                onChange={(e) => updateTierRow(i, 'point_rate', e.target.value)}
                className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right outline-none focus:border-blue-400" />
              <button onClick={() => removeTierRow(i)} className="text-sm text-red-500 hover:text-red-700 ml-1">✕</button>
            </div>
          ))}

          {tierRows.length > 0 && (
            <button onClick={saveTiers}
              className="mt-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
              💾 Сохранить сетку
            </button>
          )}

          <p className="text-[11px] text-gray-400 mt-2">
            «Загрузка до» — верхняя граница доли вместимости машины (вес или объём, что больше), при которой действует
            этот тариф. Пустое поле в последней строке — открытый тариф для самой высокой загрузки. Строки сортируются
            по возрастанию автоматически при сохранении. Загрузка считается по выезду целиком (все доставки одного
            рейса), не по отдельной точке.
          </p>
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
                                    {d.status === 'returned' && d.return_note && (
                                      <div className="text-xs text-red-600 mt-0.5">↩️ Причина возврата: {d.return_note}</div>
                                    )}
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
