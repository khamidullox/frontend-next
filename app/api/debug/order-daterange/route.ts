import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { smartupRequest } from '@/lib/smartup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Разовый отладочный эндпоинт: проверяем, какие имена параметров дат реально
// фильтруют order$export. Дёргаем несколько вариантов для УЗКОГО окна (по умолчанию
// 1 день) и сравниваем число заказов + разброс deal_time. Если параметр работает —
// заказов будет заметно меньше, чем без фильтра, и deal_time уложится в окно.

interface RawOrder { deal_id?: string; deal_time?: string; delivery_date?: string }

async function probe(label: string, body: Record<string, unknown>) {
  const data = await smartupRequest<{ order?: RawOrder[] }>(
    '/b/trade/txs/tdeal/order$export', body, 1, 'trade',
  );
  const orders = data.order || [];
  const times = orders.map((o) => o.deal_time || '').filter(Boolean).sort();
  return {
    label,
    body,
    count: orders.length,
    deal_time_min: times[0] || null,
    deal_time_max: times[times.length - 1] || null,
  };
}

export async function GET(request: NextRequest) {
  return withRole('manager', async () => {
    // Окно: один день, на 10 дней назад — чтобы отличие от «без фильтра» было явным.
    const ref = new Date();
    ref.setDate(ref.getDate() - 10);
    const dd = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    const from = request.nextUrl.searchParams.get('from') || dd(ref);
    const to = request.nextUrl.searchParams.get('to') || dd(ref);

    const results = [];
    results.push(await probe('no_filter', {}));
    results.push(await probe('order_date', { begin_order_date: from, end_order_date: to }));
    results.push(await probe('deal_date', { begin_deal_date: from, end_deal_date: to }));
    results.push(await probe('delivery_date', { begin_delivery_date: from, end_delivery_date: to }));
    results.push(await probe('modified_date', { begin_modified_date: from, end_modified_date: to }));
    results.push(await probe('booked_date', { begin_booked_date: from, end_booked_date: to }));

    return Response.json({ window: { from, to }, results });
  });
}
