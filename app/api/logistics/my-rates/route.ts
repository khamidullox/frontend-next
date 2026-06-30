import { getSession } from '@/lib/auth';
import { listDeliveriesForDriver, Delivery } from '@/lib/deliveries';
import { getUserRaw } from '@/lib/users';
import { getLogisticsSettings, vehicleFamily, defaultCapacity, LoadRateTier, LogisticsSettings } from '@/lib/settings';
import { normalizeName } from '@/lib/normalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Выезд считается недогруженным, если факт. вес/объём меньше этой доли вместимости —
// тогда (если задана) применяется сниженная ставка за точку. Та же логика, что в
// отчёте логиста (app/logistics/reports/page.tsx) — здесь только своя версия для
// «Мои расчёты» водителя, чтобы не раскрывать ему ВСЮ тарифную таблицу через
// /api/logistics/settings (она доступна только менеджеру).
const LOW_LOAD_THRESHOLD = 0.5;

function completedAt(d: Delivery): string {
  const h = (d.history || []).filter((x) => x.status === 'delivered' || x.status === 'returned');
  return h.length ? h[h.length - 1].at : d.updated_at;
}

function tripKey(d: Delivery): string {
  if (d.route_id) return `r:${d.route_id}`;
  return `t:${completedAt(d).slice(0, 16)}`;
}

function destKey(d: Delivery): string {
  if (d.kind === 'shop_to_client') {
    if (d.lat != null && d.lng != null) return `${d.lat.toFixed(4)},${d.lng.toFixed(4)}`;
    return normalizeName(d.client_phone || d.client_name || d.address || '') || 'no-dest';
  }
  return d.shop_id || normalizeName(d.to_name || d.client_name || d.address || '') || 'no-dest';
}

function rateForType(transport: string | null | undefined, rates: Record<string, number>): number {
  const key = (transport || '').trim();
  if (key && rates[key] !== undefined) return rates[key];
  const family = vehicleFamily(key);
  if (family && rates[family] !== undefined) return rates[family];
  return rates['__default__'] ?? 0;
}

function tiersForType(transport: string | null | undefined, tiersByType: Record<string, LoadRateTier[]>): LoadRateTier[] {
  const key = (transport || '').trim();
  if (key && tiersByType[key]?.length) return tiersByType[key];
  const family = vehicleFamily(key);
  if (family && tiersByType[family]?.length) return tiersByType[family];
  return tiersByType['__default__'] || [];
}

function pickTier(ratio: number, tiers: LoadRateTier[]): LoadRateTier | null {
  if (!tiers.length) return null;
  const sorted = [...tiers].sort((a, b) => (a.max_ratio ?? Infinity) - (b.max_ratio ?? Infinity));
  for (const t of sorted) {
    if (t.max_ratio == null || ratio < t.max_ratio) return t;
  }
  return sorted[sorted.length - 1];
}

// Своя ставка за км/точку для каждого выезда водителя — НЕ вся тарифная таблица
// (она остаётся видна только менеджеру через /api/logistics/settings). Возвращает
// { [tripKey]: { kmRate, pointRate } }, клиент сам считает kmPay = км × kmRate и
// pointPay = число точек × pointRate (см. app/logistics/my-stats/page.tsx).
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });

  const [deliveries, driver, settings] = await Promise.all([
    listDeliveriesForDriver(s.username),
    getUserRaw(s.username),
    getLogisticsSettings(),
  ]);

  const tripAggs = new Map<string, { km: number; stopKeys: Set<string>; weight: number; volL: number; transport: string }>();
  for (const d of deliveries) {
    if (d.status !== 'delivered') continue;
    const tk = tripKey(d);
    const cur = tripAggs.get(tk) || { km: 0, stopKeys: new Set<string>(), weight: 0, volL: 0, transport: '' };
    cur.km += d.km || 0;
    cur.stopKeys.add(`${tk}::${destKey(d)}`);
    cur.weight += d.total_weight || 0;
    cur.volL += d.total_volume_l || 0;
    if (!cur.transport && d.transport) cur.transport = d.transport;
    tripAggs.set(tk, cur);
  }

  const cap = driver && ((driver.capacity_kg ?? 0) > 0 || (driver.capacity_m3 ?? 0) > 0)
    ? { kg: driver.capacity_kg ?? 0, m3: driver.capacity_m3 ?? 0 }
    : null;

  const out: Record<string, { kmRate: number; pointRate: number }> = {};
  for (const [tk, agg] of tripAggs) {
    const c = cap ?? defaultCapacity(agg.transport || driver?.transport, settings);
    let ratio: number | null = null;
    if (c.kg > 0 || c.m3 > 0) {
      const wRatio = c.kg > 0 ? agg.weight / c.kg : 0;
      const vRatio = c.m3 > 0 ? agg.volL / (c.m3 * 1000) : 0;
      ratio = Math.max(wRatio, vRatio);
    }
    const tiers = tiersForType(agg.transport, settings.load_rate_tiers_by_type);
    const tier = ratio != null ? pickTier(ratio, tiers) : null;

    let kmRate: number;
    let pointRate: number;
    if (tier) {
      kmRate = tier.km_rate;
      pointRate = tier.point_rate;
    } else {
      kmRate = rateForType(agg.transport, settings.rate_by_type);
      const fullPointRate = rateForType(agg.transport, settings.point_rate_by_type);
      const lowLoadRate = rateForType(agg.transport, settings.point_rate_low_load_by_type);
      pointRate = (ratio != null && ratio < LOW_LOAD_THRESHOLD && lowLoadRate > 0) ? lowLoadRate : fullPointRate;
    }
    out[tk] = { kmRate, pointRate };
  }

  return Response.json({ data: out });
}
