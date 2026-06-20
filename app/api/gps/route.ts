import { fetchAllGpsLocations, fetchGpsRaw } from '@/lib/gps';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return withRole('driver', async () => {
    const debug = new URL(request.url).searchParams.get('debug') === '1';
    if (debug) {
      const raw = await fetchGpsRaw();
      return Response.json({ raw: raw.slice(0, 2000) });
    }
    const locations = await fetchAllGpsLocations();
    return Response.json({ ok: true, locations });
  });
}
