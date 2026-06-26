import { NextRequest } from 'next/server';
import { refreshStockCache } from '@/lib/products';
import { recordRecentDays } from '@/lib/shopSalesHistory';

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
    // Заодно копим историю продаж по магазинам: Smartup отдаёт только ~16 дней, поэтому
    // ежедневно дописываем последние 3 завершённых дня (повтор ловит поздние возвраты).
    // Не должно ломать прогрев остатков, поэтому в своём try/catch.
    let sales_days: Record<string, number> | null = null;
    try { sales_days = await recordRecentDays(3); } catch { sales_days = null; }
    return Response.json({ ok: true, ...result, sales_days });
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
