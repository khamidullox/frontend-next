import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { getLogisticsSettings, setLogisticsSettings, LogisticsSettings } from '@/lib/settings';

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
    const fuelRateClean = cleanRateMap(body.fuel_rate_by_type);
    if (fuelRateClean) patch.fuel_rate_by_type = fuelRateClean;
    if (Object.keys(patch).length) await setLogisticsSettings(patch);
    return Response.json({ ok: true });
  });
}
