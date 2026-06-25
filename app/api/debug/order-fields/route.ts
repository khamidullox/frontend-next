import { withRole } from '@/lib/auth';
import { smartupRequest } from '@/lib/smartup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function formatSmartupDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

// Разовый отладочный эндпоинт: смотрим ВСЕ поля, которые реально присылает Smartup
// в order$export — ищем адрес/координаты клиента, которые наш RawOrder не объявляет
// (TS-интерфейс не фильтрует поля в JSON, просто их не видит lib/orders.ts).
export async function GET() {
  return withRole('manager', async () => {
    const end = new Date();
    const begin = new Date(end);
    begin.setDate(begin.getDate() - 2);

    const data = await smartupRequest<{ order?: Record<string, unknown>[] }>(
      '/b/trade/txs/tdeal/order$export',
      { begin_order_date: formatSmartupDate(begin), end_order_date: formatSmartupDate(end) },
      2,
      'trade'
    );
    const orders = data.order || [];

    const addressLike = /addr|geo|lat|lng|coord|location|gps|map/i;
    const allKeys = new Set<string>();
    const addressKeys = new Set<string>();
    for (const o of orders) {
      for (const k of Object.keys(o)) {
        allKeys.add(k);
        if (addressLike.test(k)) addressKeys.add(k);
      }
    }

    const sample = orders.slice(0, 3);

    return Response.json({
      total_orders: orders.length,
      all_keys: [...allKeys].sort(),
      address_like_keys: [...addressKeys].sort(),
      sample,
    });
  });
}
