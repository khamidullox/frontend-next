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

export async function PATCH(request: NextRequest) {
  return withRole('manager', async () => {
    const body = await request.json().catch(() => ({}));
    const patch: Partial<LogisticsSettings> = {};
    if (body.fuel_rate_per_km !== undefined) {
      patch.fuel_rate_per_km = Math.max(0, Number(body.fuel_rate_per_km) || 0);
    }
    if (body.cap_by_type && typeof body.cap_by_type === 'object') {
      const clean: Record<string, { kg: number; m3: number }> = {};
      for (const [type, val] of Object.entries(body.cap_by_type as Record<string, { kg?: unknown; m3?: unknown }>)) {
        if (!type) continue;
        clean[type] = { kg: Math.max(0, Number(val?.kg) || 0), m3: Math.max(0, Number(val?.m3) || 0) };
      }
      patch.cap_by_type = clean;
    }
    if (body.rate_by_type && typeof body.rate_by_type === 'object') {
      const clean: Record<string, number> = {};
      for (const [type, val] of Object.entries(body.rate_by_type as Record<string, unknown>)) {
        if (!type) continue;
        clean[type] = Math.max(0, Number(val) || 0);
      }
      patch.rate_by_type = clean;
    }
    if (Object.keys(patch).length) await setLogisticsSettings(patch);
    return Response.json({ ok: true });
  });
}
