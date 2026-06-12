import { NextRequest } from 'next/server';
import { refreshStockCache } from '@/lib/products';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = request.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  return request.nextUrl.searchParams.get('secret') === secret;
}

// Прогрев снимка остатков/складов/каталога в Firestore.
// Cron на Hobby — раз в сутки (большее запрещено). Внутри дня снимок
// обновляется лениво по TTL 4ч при первом обращении. Можно дёрнуть руками.
async function run(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await refreshStockCache();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
