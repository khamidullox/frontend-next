import { fetchGpsLocationsByUserIds, fetchGpsRawUid } from '@/lib/gps';
import { listUsers } from '@/lib/users';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return withRole('driver', async () => {
    const url = new URL(request.url);

    // Диагностика: ?debug=1&uid=UUID
    if (url.searchParams.get('debug') === '1') {
      const uid = url.searchParams.get('uid') ?? '';
      const raw = uid ? await fetchGpsRawUid(uid) : '{"error":"pass uid= param"}';
      return Response.json({ raw: raw.slice(0, 2000) });
    }

    // Получаем gps_user_id всех водителей и запрашиваем их GPS
    const users = await listUsers();
    const gpsIds = users
      .filter((u) => u.role === 'driver' && u.gps_user_id)
      .map((u) => u.gps_user_id as string);

    const locations = await fetchGpsLocationsByUserIds(gpsIds);
    return Response.json({ ok: true, locations });
  });
}
