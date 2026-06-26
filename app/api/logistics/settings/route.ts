import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { getLogisticsSettings, setLogisticsSettings, LogisticsSettings, LoadRateTier } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withRole('manager', async () => {
    return Response.json({ data: await getLogisticsSettings() });
  });
}

// Чистит карту «вид транспорта → число» (ставки за км/точку/топливо — все по одному
// принципу ключей: точная модель, семейство LABO/Газель, или CAP_DEFAULT_KEY «Прочие»).
function cleanRateMap(val: unknown): Record<string, number> | null {
  if (!val || typeof val !== 'object') return null;
  const clean: Record<string, number> = {};
  for (const [type, n] of Object.entries(val as Record<string, unknown>)) {
    if (!type) continue;
    clean[type] = Math.max(0, Number(n) || 0);
  }
  return clean;
}

// Тарифная сетка по загрузке: { type: [{max_ratio, km_rate, point_rate}, ...] }.
// max_ratio = null/отсутствует — открытый верхний тариф; сортируем по возрастанию.
function cleanTiersByType(val: unknown): Record<string, LoadRateTier[]> | null {
  if (!val || typeof val !== 'object') return null;
  const clean: Record<string, LoadRateTier[]> = {};
  for (const [type, arr] of Object.entries(val as Record<string, unknown>)) {
    if (!type || !Array.isArray(arr)) continue;
    const tiers: LoadRateTier[] = arr
      .map((t) => {
        const o = t as { max_ratio?: unknown; km_rate?: unknown; point_rate?: unknown };
        const maxRatio = o?.max_ratio === null || o?.max_ratio === undefined ? null : Math.max(0, Number(o.max_ratio) || 0);
        return {
          max_ratio: maxRatio,
          km_rate: Math.max(0, Number(o?.km_rate) || 0),
          point_rate: Math.max(0, Number(o?.point_rate) || 0),
        };
      })
      .sort((a, b) => (a.max_ratio ?? Infinity) - (b.max_ratio ?? Infinity));
    clean[type] = tiers;
  }
  return clean;
}

export async function PATCH(request: NextRequest) {
  return withRole('manager', async () => {
    const body = await request.json().catch(() => ({}));
    const patch: Partial<LogisticsSettings> = {};
    if (body.cap_by_type && typeof body.cap_by_type === 'object') {
      const clean: Record<string, { kg: number; m3: number }> = {};
      for (const [type, val] of Object.entries(body.cap_by_type as Record<string, { kg?: unknown; m3?: unknown }>)) {
        if (!type) continue;
        clean[type] = { kg: Math.max(0, Number(val?.kg) || 0), m3: Math.max(0, Number(val?.m3) || 0) };
      }
      patch.cap_by_type = clean;
    }
    const rateClean = cleanRateMap(body.rate_by_type);
    if (rateClean) patch.rate_by_type = rateClean;
    const pointRateClean = cleanRateMap(body.point_rate_by_type);
    if (pointRateClean) patch.point_rate_by_type = pointRateClean;
    const pointRateLowLoadClean = cleanRateMap(body.point_rate_low_load_by_type);
    if (pointRateLowLoadClean) patch.point_rate_low_load_by_type = pointRateLowLoadClean;
    const fuelRateClean = cleanRateMap(body.fuel_rate_by_type);
    if (fuelRateClean) patch.fuel_rate_by_type = fuelRateClean;
    const tiersClean = cleanTiersByType(body.load_rate_tiers_by_type);
    if (tiersClean) patch.load_rate_tiers_by_type = tiersClean;
    if (Object.keys(patch).length) await setLogisticsSettings(patch);
    // Перечитываем сразу здесь же (на сервере, без отдельного round-trip от клиента) —
    // чтобы исключить любую неоднозначность с таймингом при диагностике «не сохраняется».
    const saved = await getLogisticsSettings();
    return Response.json({ ok: true, saved });
  });
}
