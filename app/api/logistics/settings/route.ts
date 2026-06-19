import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { getLogisticsSettings, setLogisticsSettings } from '@/lib/settings';

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
    if (body.fuel_rate_per_km !== undefined) {
      await setLogisticsSettings({ fuel_rate_per_km: Math.max(0, Number(body.fuel_rate_per_km) || 0) });
    }
    return Response.json({ ok: true });
  });
}
