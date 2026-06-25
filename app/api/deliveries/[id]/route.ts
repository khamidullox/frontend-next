import { NextRequest } from 'next/server';
import { getSession, ROLE_RANK } from '@/lib/auth';
import {
  getDelivery,
  assignDriver,
  setDeliveryStatus,
  setDeliveryPicked,
  updateDeliveryFields,
  deleteDelivery,
  recomputeRouteKm,
  requeueReturnedDelivery,
  Delivery,
  DeliveryStatus,
} from '@/lib/deliveries';
import { notifyDriverAssigned } from '@/lib/push';
import { getShop } from '@/lib/shops';
import { notifyNearbyDrivers } from '@/lib/shopOffers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// После «Возврат» у заявки магазина — создаём новую заявку (та же точка/состав) и
// сразу рассылаем её свободным водителям рядом, как при создании заявки впервые.
async function requeueIfReturned(delivery: Delivery) {
  if (delivery.status !== 'returned' || delivery.kind !== 'shop_to_client') return;
  const fresh = await requeueReturnedDelivery(delivery);
  if (!fresh) return;
  const shop = fresh.shop_id ? await getShop(fresh.shop_id) : null;
  if (shop) await notifyNearbyDrivers(fresh, shop).catch(() => {});
}

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

  // Воркер (склад/магазин): может отмечать «Собрано» — это не назначение и не статус.
  if (!isManager && s.role === 'worker' && typeof body.picked === 'boolean') {
    const res = await setDeliveryPicked(id, body.picked);
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    return Response.json({ data: res.delivery });
  }

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
    const res = await setDeliveryStatus(
      id, body.status as DeliveryStatus, s.name || s.username, s.role, body.return_note,
      typeof body.lat === 'number' ? body.lat : undefined,
      typeof body.lng === 'number' ? body.lng : undefined
    );
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    await requeueIfReturned(res.delivery).catch(() => {});
    if (res.delivery.route_id && ['on_way', 'delivered'].includes(body.status)) {
      await recomputeRouteKm(res.delivery.route_id).catch(() => {});
      const fresh = await getDelivery(id);
      if (fresh) return Response.json({ data: fresh });
    }
    return Response.json({ data: res.delivery });
  }

  // Менеджер/админ.
  if (typeof body.picked === 'boolean') {
    const res = await setDeliveryPicked(id, body.picked);
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
  }
  if (body.driver_username !== undefined) {
    const res = await assignDriver(id, body.driver_username || null);
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    if (body.driver_username) {
      notifyDriverAssigned(body.driver_username, res.delivery.client_name || res.delivery.address || 'новая доставка').catch(() => {});
    }
  }
  if (typeof body.status === 'string') {
    const res = await setDeliveryStatus(id, body.status as DeliveryStatus, s.name || s.username, s.role, body.return_note);
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    await requeueIfReturned(res.delivery).catch(() => {});
    if (res.delivery.route_id && ['on_way', 'delivered'].includes(body.status)) {
      await recomputeRouteKm(res.delivery.route_id).catch(() => {});
    }
  }
  if (body.client_name !== undefined || body.client_phone !== undefined || body.address !== undefined ||
      body.note !== undefined || body.direction !== undefined || body.km !== undefined ||
      body.total_weight !== undefined || body.items !== undefined || body.lat !== undefined || body.lng !== undefined ||
      body.defer_until !== undefined) {
    const items = Array.isArray(body.items)
      ? body.items.map((it: { code?: unknown; name?: unknown; qty?: unknown }) => ({
          code: String(it.code || ''), name: String(it.name || ''), qty: Math.max(0, Number(it.qty) || 0),
        })).filter((it: { code: string; qty: number }) => it.code && it.qty > 0)
      : undefined;
    const res = await updateDeliveryFields(id, {
      client_name: body.client_name,
      client_phone: body.client_phone,
      address: body.address,
      note: body.note,
      direction: body.direction,
      km: body.km,
      total_weight: body.total_weight,
      items,
      lat: body.lat != null ? Number(body.lat) : (body.lat === null ? null : undefined),
      lng: body.lng != null ? Number(body.lng) : (body.lng === null ? null : undefined),
      defer_until: body.defer_until !== undefined ? (body.defer_until || null) : undefined,
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
