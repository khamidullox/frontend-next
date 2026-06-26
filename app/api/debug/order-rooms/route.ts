import { withRole } from '@/lib/auth';
import { smartupRequest } from '@/lib/smartup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fmt(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}.${m}.${date.getFullYear()}`;
}

// Разовый отладочный эндпоинт: проверяем гипотезу, что «рабочая зона» (привязка
// магазина к складу из ручной таблицы) — это поле room_name/room_id в order$export.
// Дампим все различные рабочие зоны (room) за неделю с числом заказов и складами,
// откуда уходил товар (warehouse_code в позициях), чтобы сверить с 24 магазинами.
export async function GET() {
  return withRole('manager', async () => {
    const end = new Date();
    const begin = new Date(end);
    begin.setDate(begin.getDate() - 7);

    const data = await smartupRequest<{ order?: Record<string, unknown>[] }>(
      '/b/trade/txs/tdeal/order$export',
      { begin_order_date: fmt(begin), end_order_date: fmt(end) },
      2,
      'trade'
    );
    const orders = data.order || [];

    const rooms = new Map<string, { room_id: string; orders: number; warehouses: Set<string>; filials: Set<string> }>();
    for (const o of orders) {
      const name = String(o.room_name ?? '').trim() || '(пусто)';
      const cur = rooms.get(name) || { room_id: String(o.room_id ?? ''), orders: 0, warehouses: new Set<string>(), filials: new Set<string>() };
      cur.orders++;
      cur.filials.add(String(o.filial_code ?? ''));
      const items = (o.order_products as Record<string, unknown>[]) || [];
      for (const it of items) {
        const wh = String(it.warehouse_code ?? '').trim();
        if (wh) cur.warehouses.add(wh);
      }
      rooms.set(name, cur);
    }

    const list = [...rooms.entries()]
      .map(([room_name, v]) => ({
        room_name,
        room_id: v.room_id,
        orders: v.orders,
        warehouses: [...v.warehouses].sort(),
        filials: [...v.filials].sort(),
      }))
      .sort((a, b) => b.orders - a.orders);

    return Response.json({ total_orders: orders.length, distinct_rooms: list.length, rooms: list });
  });
}
