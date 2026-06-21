import { NextRequest } from 'next/server';
import { getSession, ROLE_RANK } from '@/lib/auth';
import {
  getDelivery,
  assignDriver,
  setDeliveryStatus,
  updateDeliveryFields,
  deleteDelivery,
  DeliveryStatus,
} from '@/lib/deliveries';
import { notifyDriverAssigned } from '@/lib/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PATCH: смена статуса / назначение водителя / правка полей.
// - Водитель может менять только статус СВОЕЙ доставки.
// - Менеджер+ может всё.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const isManager = ROLE_RANK[s.role] >= ROLE_RANK['manager'];

  // Водитель: только статус своей доставки.
  if (!isManager) {
    if (s.role !== 'driver') {
      return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
    }
    const d = await getDelivery(id);
    if (!d) return Response.json({ error: 'Доставка не найдена' }, { status: 404 });
    if (d.driver_username !== s.username) {
      return Response.json({ error: 'Это не ваша доставка' }, { status: 403 });
    }
    if (typeof body.status !== 'string') {
      return Response.json({ error: 'Можно изменить только статус' }, { status: 400 });
    }
    const res = await setDeliveryStatus(id, body.status as DeliveryStatus, s.name || s.username);
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    return Response.json({ data: res.delivery });
  }

  // Менеджер/админ.
  if (body.driver_username !== undefined) {
    const res = await assignDriver(id, body.driver_username || null);
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    if (body.driver_username) {
      notifyDriverAssigned(body.driver_username, res.delivery.client_name || res.delivery.address || 'новая доставка').catch(() => {});
    }
  }
  if (typeof body.status === 'string') {
    const res = await setDeliveryStatus(id, body.status as DeliveryStatus, s.name || s.username);
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
  }
  if (body.client_name !== undefined || body.address !== undefined || body.note !== undefined ||
      body.direction !== undefined || body.km !== undefined || body.total_weight !== undefined) {
    const res = await updateDeliveryFields(id, {
      client_name: body.client_name,
      address: body.address,
      note: body.note,
      direction: body.direction,
      km: body.km,
      total_weight: body.total_weight,
    });
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
  }

  const updated = await getDelivery(id);
  if (!updated) return Response.json({ error: 'Доставка не найдена' }, { status: 404 });
  return Response.json({ data: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const s = await getSession();
  if (!s || ROLE_RANK[s.role] < ROLE_RANK['manager']) {
    return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  }
  const { id } = await params;
  const ok = await deleteDelivery(id);
  if (!ok) return Response.json({ error: 'Доставка не найдена' }, { status: 404 });
  return Response.json({ ok: true });
}
