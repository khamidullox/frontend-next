import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { smartupRequest } from '@/lib/smartup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

// Ищем API за UI-страницей «Архив заказов» (trade/tdeal/order/order_history_list) —
// у обычного order$export история обрезана ~16 днями, а в архиве 181k заказов. Пробуем
// несколько кандидатов-эндпоинтов и параметров за СТАРЫЙ период (май), чтобы найти тот,
// что реально отдаёт историю.
interface RawOrder { deal_time?: string }

async function probe(label: string, endpoint: string, body: Record<string, unknown>) {
  try {
    const data = await smartupRequest<{ order?: RawOrder[] }>(endpoint, body, 1, 'trade');
    const orders = data.order || [];
    const keyed = orders.map((o) => {
      const m = (o.deal_time || '').match(/^(\d{2})\.(\d{2})\.(\d{4})/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
    }).filter(Boolean).sort();
    return { label, endpoint, ok: true, count: orders.length, deal_date_min: keyed[0] || null, deal_date_max: keyed[keyed.length - 1] || null };
  } catch (e) {
    return { label, endpoint, ok: false, error: String((e as Error).message).slice(0, 200) };
  }
}

export async function GET(request: NextRequest) {
  return withRole('manager', async () => {
    const from = request.nextUrl.searchParams.get('from') || '01.05.2026';
    const to = request.nextUrl.searchParams.get('to') || '20.05.2026';
    const range = { begin_deal_date: from, end_deal_date: to };
    const results = [];
    results.push(await probe('order_history$export', '/b/trade/txs/tdeal/order_history$export', { ...range }));
    results.push(await probe('order$history_export', '/b/trade/txs/tdeal/order$history_export', { ...range }));
    results.push(await probe('order_history$list', '/b/trade/txs/tdeal/order_history$list', { ...range }));
    results.push(await probe('order$export+history=Y', '/b/trade/txs/tdeal/order$export', { ...range, history: 'Y' }));
    results.push(await probe('order$export+archive=Y', '/b/trade/txs/tdeal/order$export', { ...range, archive: 'Y' }));
    return Response.json({ range: { from, to }, results });
  });
}
