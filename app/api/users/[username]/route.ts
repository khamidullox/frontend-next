import { NextRequest } from 'next/server';
import { deleteUser, setPassword, setUserWarehouses, setDriverProfile, setWorkerShop, setWorkerHomeWarehouse, renameUser } from '@/lib/users';
import { listDeliveriesForDriver } from '@/lib/deliveries';
import { withRole } from '@/lib/auth';

// Статистика водителя: суммарные км по доставленным заказам
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  return withRole('manager', async () => {
    const { username } = await params;
    const deliveries = await listDeliveriesForDriver(username);
    const delivered = deliveries.filter((d) => d.status === 'delivered');
    const totalKm   = delivered.reduce((s, d) => s + (d.km || 0), 0);
    return Response.json({ total_km: totalKm, delivery_count: delivered.length });
  });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Смена пароля и/или складов пользователя (только админ).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  return withRole('admin', async () => {
    const { username: paramUsername } = await params;
    const body = await request.json().catch(() => ({}));
    let username = paramUsername;
    if (typeof body.new_username === 'string' && body.new_username.trim()) {
      const res = await renameUser(username, body.new_username);
      if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
      username = body.new_username.trim().toLowerCase();
    }
    if (typeof body.password === 'string' && body.password) {
      const res = await setPassword(username, body.password);
      if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    }
    if (body.warehouses !== undefined) {
      const res = await setUserWarehouses(username, body.warehouses);
      if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    }
    if (body.name !== undefined || body.car_number !== undefined || body.transport !== undefined ||
        body.capacity_m3 !== undefined || body.capacity_kg !== undefined || body.direction !== undefined ||
        body.gps_user_id !== undefined) {
      const res = await setDriverProfile(username, {
        name: body.name,
        car_number: body.car_number,
        transport: body.transport,
        capacity_m3: body.capacity_m3,
        capacity_kg: body.capacity_kg,
        direction: body.direction,
        gps_user_id: body.gps_user_id,
      });
      if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    }
    if (body.shop_id !== undefined) {
      const res = await setWorkerShop(username, body.shop_id);
      if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    }
    if (body.home_warehouse !== undefined) {
      const res = await setWorkerHomeWarehouse(username, body.home_warehouse);
      if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    }
    return Response.json({ ok: true, username });
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  return withRole('admin', async (session) => {
    const { username } = await params;
    if (username.toLowerCase() === session.username.toLowerCase()) {
      return Response.json({ error: 'Нельзя удалить самого себя' }, { status: 400 });
    }
    await deleteUser(username);
    return Response.json({ ok: true });
  });
}
