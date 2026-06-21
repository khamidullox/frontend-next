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
    const patch: Record<string, number> = {};
    for (const key of ['fuel_rate_per_km', 'cap_labo_kg', 'cap_labo_m3', 'cap_gazelle_kg', 'cap_gazelle_m3', 'cap_other_kg', 'cap_other_m3']) {
      if (body[key] !== undefined) patch[key] = Math.max(0, Number(body[key]) || 0);
    }
    if (Object.keys(patch).length) await setLogisticsSettings(patch);
    return Response.json({ ok: true });
  });
}
