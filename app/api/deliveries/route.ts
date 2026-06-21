import { NextRequest } from 'next/server';
import { getSession, withRole, ROLE_RANK } from '@/lib/auth';
import { listDeliveries, listDeliveriesForDriver, createDelivery } from '@/lib/deliveries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Водитель видит только свои доставки; менеджер/админ — все.
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });

  if (s.role === 'driver') {
    return Response.json({ data: await listDeliveriesForDriver(s.username) });
  }
  if (ROLE_RANK[s.role] < ROLE_RANK['manager']) {
    return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  }
  return Response.json({ data: await listDeliveries() });
}

// Создание доставки (менеджер+): вручную, из документа (query) или из проверки (session_id).
export async function POST(request: NextRequest) {
  return withRole('manager', async (session) => {
    const body = await request.json().catch(() => ({}));
    const res = await createDelivery({
      source: body.source,
      kind: body.kind,
      shop_id: body.shop_id,
      shop_name: body.shop_name,
      query: body.query,
      movement_id: body.movement_id,
      deal_id: body.deal_id,
      transfer_id: body.transfer_id,
      receipt_id: body.receipt_id,
      session_id: body.session_id,
      client_name: body.client_name,
      address: body.address,
      note: body.note,
      direction: body.direction,
      km: body.km != null ? Number(body.km) : undefined,
      driver_username: body.driver_username,
      external_driver: body.external_driver,
      external_car: body.external_car,
      weight_kg: body.weight_kg != null ? Number(body.weight_kg) : undefined,
      volume_m3: body.volume_m3 != null ? Number(body.volume_m3) : undefined,
      lat: body.lat != null ? Number(body.lat) : undefined,
      lng: body.lng != null ? Number(body.lng) : undefined,
      created_by: session.name || session.username,
    });
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    return Response.json({ data: res.delivery });
  });
}
