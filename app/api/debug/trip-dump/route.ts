import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase';
import { normalizeName } from '@/lib/normalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Временный: для разбора «за точку не платит» — по route_id или по номеру документа
// (doc_number, НЕ PII) выводит только технические поля, влияющие на destKey (сам ключ
// точки — уже вычисленный, а не сырые ФИО/телефон/адрес клиента).
function destKey(kind: unknown, shopId: unknown, toName: unknown, clientName: unknown, address: unknown, lat: unknown, lng: unknown, phone: unknown): string {
  if (kind === 'shop_to_client') {
    if (typeof lat === 'number' && typeof lng === 'number') return `${lat.toFixed(4)},${lng.toFixed(4)}`;
    return normalizeName(phone || clientName || address || '') || 'no-dest';
  }
  return (shopId as string) || normalizeName(toName || clientName || address || '') || 'no-dest';
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const envSecret = process.env.CRON_SECRET;
  if (envSecret && sp.get('secret') !== envSecret) return Response.json({ error: 'forbidden' }, { status: 403 });
  const routeId = sp.get('route');
  const doc = sp.get('doc'); // поиск только по номеру документа (не PII)

  let docs;
  if (routeId) {
    docs = (await getDb().collection('deliveries').where('route_id', '==', routeId).get()).docs;
  } else if (doc) {
    docs = (await getDb().collection('deliveries').where('doc_number', '==', doc).get()).docs;
  } else {
    return Response.json({ error: 'Укажите route или doc' }, { status: 400 });
  }
  const rows = docs.map((d) => {
    const v = d.data() as Record<string, unknown>;
    return {
      id: v.id, doc_number: v.doc_number, kind: v.kind, status: v.status,
      route_id: v.route_id, shop_id: v.shop_id,
      dest_key: destKey(v.kind, v.shop_id, v.to_name, v.client_name, v.address, v.lat, v.lng, v.client_phone),
      km: v.km, created_at: v.created_at,
    };
  });
  return Response.json({ count: rows.length, rows });
}
