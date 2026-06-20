import { NextRequest } from 'next/server';
import { deleteUser, setPassword, setUserWarehouses, setDriverProfile, setWorkerShop } from '@/lib/users';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Смена пароля и/или складов пользователя (только админ).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  return withRole('admin', async () => {
    const { username } = await params;
    const body = await request.json().catch(() => ({}));
    if (typeof body.password === 'string' && body.password) {
      const res = await setPassword(username, body.password);
      if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    }
    if (body.warehouses !== undefined) {
      const res = await setUserWarehouses(username, body.warehouses);
      if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    }
    if (body.car_number !== undefined || body.transport !== undefined ||
        body.capacity_m3 !== undefined || body.capacity_kg !== undefined || body.direction !== undefined) {
      const res = await setDriverProfile(username, {
        car_number: body.car_number,
        transport: body.transport,
        capacity_m3: body.capacity_m3,
        capacity_kg: body.capacity_kg,
        direction: body.direction,
      });
      if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    }
    if (body.shop_id !== undefined) {
      const res = await setWorkerShop(username, body.shop_id);
      if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    }
    return Response.json({ ok: true });
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
