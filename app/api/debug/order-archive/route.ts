import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { smartupRequest } from '@/lib/smartup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

// Старые заказы по умолчанию не приходят (modified_on > 30 дней назад). Гипотеза:
// завершённые уходят в архив (status A) и исключаются. Пробуем достать старый период
// (по умолчанию май) с явными статусами, включая архивные.
interface RawOrder { deal_id?: string; deal_time?: string; status?: string }

async function probe(label: string, body: Record<string, unknown>) {
  const data = await smartupRequest<{ order?: RawOrder[] }>('/b/trade/txs/tdeal/order$export', body, 1, 'trade');
  const orders = data.order || [];
  const keyed = orders.map((o) => {
    const t = o.deal_time || '';
    const m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  }).filter(Boolean).sort();
  const statuses: Record<string, number> = {};
  for (const o of orders) statuses[String(o.status || '')] = (statuses[String(o.status || '')] || 0) + 1;
  return { label, body, count: orders.length, deal_date_min: keyed[0] || null, deal_date_max: keyed[keyed.length - 1] || null, statuses };
}

const ALL = ['D', 'B#N', 'B#E', 'B#W', 'B#S', 'B#V', 'A', 'C'];

export async function GET(request: NextRequest) {
  return withRole('manager', async () => {
    const from = request.nextUrl.searchParams.get('from') || '01.05.2026';
    const to = request.nextUrl.searchParams.get('to') || '20.05.2026';
    const range = { begin_deal_date: from, end_deal_date: to };
    const results = [];
    results.push(await probe('old_range_no_status', { ...range }));
    results.push(await probe('old_range_archived', { ...range, statuses: ['A'] }));
    results.push(await probe('old_range_all_statuses', { ...range, statuses: ALL }));
    results.push(await probe('archived_no_daterange', { statuses: ['A'] }));
    return Response.json({ range: { from, to }, results });
  });
}
