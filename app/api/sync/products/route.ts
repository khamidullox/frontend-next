import { NextRequest } from 'next/server';
import { syncProducts } from '@/lib/products';
import { purgeOldSessions } from '@/lib/sessions';

const SESSION_RETENTION_DAYS = 60;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // секунд — первичная заливка 11k товаров долгая

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // секрет не задан — не ограничиваем (например, локально)

  const auth = request.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;

  // Альтернатива: ?secret=... в URL (для ручного запуска)
  return request.nextUrl.searchParams.get('secret') === secret;
}

async function run(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const full = request.nextUrl.searchParams.get('full') === 'true';

  try {
    const result = await syncProducts({ full });
    // Заодно чистим старые сессии (чтобы Firestore не рос бесконечно).
    const purged = await purgeOldSessions(SESSION_RETENTION_DAYS);
    return Response.json({ ok: true, ...result, purged_sessions: purged });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

// Vercel Cron вызывает GET (инкрементальный синк).
export async function GET(request: NextRequest) {
  return run(request);
}

// Ручной запуск, в т.ч. первичная заливка ?full=true.
export async function POST(request: NextRequest) {
  return run(request);
}
