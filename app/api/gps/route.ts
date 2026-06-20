import { fetchAllGpsLocations, fetchGpsRaw, fetchGpsRawUid } from '@/lib/gps';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return withRole('driver', async () => {
    const url = new URL(request.url);
    const debug = url.searchParams.get('debug') === '1';
    const testUid = url.searchParams.get('uid'); // тест: конкретный user_id без сессии
    if (debug) {
      const raw = testUid ? await fetchGpsRawUid(testUid) : await fetchGpsRaw();
      return Response.json({ raw: raw.slice(0, 2000) });
    }
    const locations = await fetchAllGpsLocations();
    return Response.json({ ok: true, locations });
  });
}
