import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Временный: дамп сырых полей доставок по имени/номеру машины водителя — для
// разбора расхождения «точки»/«км» в отчётах. Удалить после использования.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const envSecret = process.env.CRON_SECRET;
  if (envSecret && sp.get('secret') !== envSecret) return Response.json({ error: 'forbidden' }, { status: 403 });
  const q = (sp.get('q') || '').toLowerCase();

  const snap = await getDb().collection('deliveries').orderBy('created_at', 'desc').limit(500).get();
  const rows = snap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .filter((d) => {
      const hay = `${d.driver_name || ''} ${d.driver_username || ''} ${d.car_number || ''}`.toLowerCase();
      return !q || hay.includes(q);
    })
    .map((d) => ({
      id: d.id, doc_number: d.doc_number, kind: d.kind,
      driver_username: d.driver_username, driver_name: d.driver_name, car_number: d.car_number,
      route_id: d.route_id, shop_id: d.shop_id, to_name: d.to_name, from_name: d.from_name,
      client_name: d.client_name, address: d.address, km: d.km, km_auto: d.km_auto,
      status: d.status, external: d.external, created_at: d.created_at, updated_at: d.updated_at,
    }));
  return Response.json({ count: rows.length, rows });
}
