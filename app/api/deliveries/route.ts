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
      query: body.query,
      movement_id: body.movement_id,
      deal_id: body.deal_id,
      transfer_id: body.transfer_id,
      receipt_id: body.receipt_id,
      session_id: body.session_id,
      client_name: body.client_name,
      address: body.address,
      note: body.note,
      driver_username: body.driver_username,
      created_by: session.name || session.username,
    });
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    return Response.json({ data: res.delivery });
  });
}
