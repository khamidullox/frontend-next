import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { listDeliveriesRange } from '@/lib/deliveries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// История заявок: доставки за указанный период с детектированием дублей.
// ?days=N (default 7) — сколько дней назад смотреть.
export async function GET(request: NextRequest) {
  return withRole('manager', async () => {
    const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get('days') || '7')));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const deliveries = await listDeliveriesRange(since, 1000);

    // Детектируем дубли по doc_number (одна и та же накладная/заказ добавлены дважды).
    const docCount = new Map<string, number>();
    for (const d of deliveries) {
      if (d.doc_number) docCount.set(d.doc_number, (docCount.get(d.doc_number) || 0) + 1);
    }

    const data = deliveries.map((d) => ({
      id: d.id,
      created_at: d.created_at,
      updated_at: d.updated_at,
      created_by: d.created_by,
      doc_type: d.doc_type,
      doc_number: d.doc_number,
      doc_id: d.doc_id,
      client_name: d.client_name,
      from_name: d.from_name,
      to_name: d.to_name,
      status: d.status,
      driver_name: d.driver_name,
      driver_username: d.driver_username,
      car_number: d.car_number,
      external: d.external ?? false,
      route_id: d.route_id,
      history: d.history,
      is_duplicate: d.doc_number ? (docCount.get(d.doc_number) || 0) > 1 : false,
    }));

    return Response.json({ data, since, days });
  });
}
