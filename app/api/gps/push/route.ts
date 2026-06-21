import { saveGpsLocations, GpsLocation } from '@/lib/gps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Gps-Push-Secret',
};

// Принимает данные от userscript-релея, работающего в браузере на gps16888.com.
// Авторизация — общий секрет в заголовке (сессии тут нет, источник не наш фронтенд).
export async function POST(request: Request) {
  const secret = request.headers.get('x-gps-push-secret');
  if (!secret || secret !== process.env.GPS_PUSH_SECRET) {
    return Response.json({ error: 'forbidden' }, { status: 403, headers: CORS_HEADERS });
  }

  const body = await request.json().catch(() => null);
  const locations = Array.isArray(body?.locations) ? (body.locations as GpsLocation[]) : null;
  if (!locations) {
    return Response.json({ error: 'bad_request' }, { status: 400, headers: CORS_HEADERS });
  }

  await saveGpsLocations(locations);
  return Response.json({ ok: true, count: locations.length }, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
