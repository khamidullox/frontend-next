import { listUsers } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Gps-Push-Secret',
};

// Список меняется редко (только когда админ привязывает GPS ID водителю) —
// кэшируем на 5 минут, чтобы релей, опрашивающий каждые 30 сек, не читал всех
// пользователей при каждом запросе (это съедало дневную квоту Firestore).
const CACHE_TTL_MS = 5 * 60_000;
let cache: { ids: string[]; at: number } | null = null;

// Отдаёт userscript-релею список gps_user_id водителей, чтобы он знал кого опрашивать.
export async function GET(request: Request) {
  const secret = request.headers.get('x-gps-push-secret');
  if (!secret || secret !== process.env.GPS_PUSH_SECRET) {
    return Response.json({ error: 'forbidden' }, { status: 403, headers: CORS_HEADERS });
  }

  if (!cache || Date.now() - cache.at > CACHE_TTL_MS) {
    const users = await listUsers();
    const ids = users
      .filter((u) => u.role === 'driver' && u.gps_user_id)
      .map((u) => u.gps_user_id as string);
    cache = { ids, at: Date.now() };
  }

  return Response.json({ ids: cache.ids }, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
