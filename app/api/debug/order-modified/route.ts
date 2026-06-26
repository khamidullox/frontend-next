import { withRole } from '@/lib/auth';
import { smartupRequest } from '@/lib/smartup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

// Проверяем гипотезу из доков: order$export ограничен ОКНОМ ИЗМЕНЕНИЯ (modified_on),
// по умолчанию последние 30 дней. Если сдвигать end_modified_on назад — приходят
// более старые заказы. Дёргаем с разными end_modified_on и смотрим разброс deal_time.
interface RawOrder { deal_id?: string; deal_time?: string }

const dd = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
function back(days: number): Date { const d = new Date(); d.setDate(d.getDate() - days); return d; }

async function probe(label: string, body: Record<string, unknown>) {
  const data = await smartupRequest<{ order?: RawOrder[] }>('/b/trade/txs/tdeal/order$export', body, 1, 'trade');
  const orders = data.order || [];
  const keyed = orders.map((o) => {
    const t = o.deal_time || '';
    const m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  }).filter(Boolean).sort();
  return { label, body, count: orders.length, deal_date_min: keyed[0] || null, deal_date_max: keyed[keyed.length - 1] || null };
}

export async function GET() {
  return withRole('manager', async () => {
    const results = [];
    results.push(await probe('default', {}));
    results.push(await probe('mod_end_today-30', { end_modified_on: dd(back(30)) }));
    results.push(await probe('mod_end_today-60', { end_modified_on: dd(back(60)) }));
    results.push(await probe('mod_end_today-90', { end_modified_on: dd(back(90)) }));
    return Response.json({ today: dd(back(0)), results });
  });
}
