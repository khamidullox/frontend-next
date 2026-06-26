import { withRole } from '@/lib/auth';
import { smartupRequest } from '@/lib/smartup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

// Проверяем глубину и лимит order$export по begin_deal_date/end_deal_date:
// 1) достаёт ли он старые заказы (одиночный день 25 дней назад),
// 2) сколько отдаёт за 30/60 дней и какой реальный разброс deal_time (есть ли обрезка),
// 3) реагирует ли на limit/page (на случай server-side cap и нужды в пагинации).

interface RawOrder { deal_id?: string; deal_time?: string }

const dd = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
function back(days: number): Date { const d = new Date(); d.setDate(d.getDate() - days); return d; }

async function probe(label: string, body: Record<string, unknown>) {
  const data = await smartupRequest<{ order?: RawOrder[] }>('/b/trade/txs/tdeal/order$export', body, 1, 'trade');
  const orders = data.order || [];
  // deal_time = "DD.MM.YYYY HH:mm:ss" — для min/max разбираем в сортируемый вид.
  const keyed = orders.map((o) => {
    const t = o.deal_time || '';
    const m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]} ${t.slice(11)}` : '';
  }).filter(Boolean).sort();
  return { label, body, count: orders.length, deal_time_min: keyed[0] || null, deal_time_max: keyed[keyed.length - 1] || null };
}

export async function GET() {
  return withRole('manager', async () => {
    const results = [];
    // 1) одиночный старый день (25 дней назад)
    const old = back(25);
    results.push(await probe('single_old_day', { begin_deal_date: dd(old), end_deal_date: dd(old) }));
    // 2) 30 и 60 дней
    results.push(await probe('range_30d', { begin_deal_date: dd(back(29)), end_deal_date: dd(back(0)) }));
    results.push(await probe('range_60d', { begin_deal_date: dd(back(59)), end_deal_date: dd(back(0)) }));
    // 3) тот же 60д + возможные параметры лимита/пагинации (если cap — увидим иное число)
    results.push(await probe('range_60d_limit', { begin_deal_date: dd(back(59)), end_deal_date: dd(back(0)), limit: 100000 }));
    results.push(await probe('range_60d_page2', { begin_deal_date: dd(back(59)), end_deal_date: dd(back(0)), page: 2 }));

    return Response.json({ today: dd(back(0)), results });
  });
}
