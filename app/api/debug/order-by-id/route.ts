import { smartupRequest } from '@/lib/smartup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Временная проверка: order$export по конкретному deal_id (без диапазона дат) —
// проверяем, действует ли ограничение ~7 дней и на точечный запрос по ID, или
// только на широкие диапазоны дат.
export async function GET(request: Request) {
  const url = new URL(request.url);
  // Тот же шаблон, что и у рабочих cron-эндпоинтов: если CRON_SECRET не задан —
  // пропускаем (на Vercel этой переменной, похоже, нет, отсюда прежний 403).
  const envSecret = process.env.CRON_SECRET;
  if (envSecret && url.searchParams.get('secret') !== envSecret) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  const dealId = url.searchParams.get('deal_id') || '246545864';

  const data = await smartupRequest<{ order?: Record<string, unknown>[] }>(
    '/b/trade/txs/tdeal/order$export',
    { deal_id: dealId }
  );
  return Response.json({ found: (data.order || []).length, order: data.order || [] });
}
