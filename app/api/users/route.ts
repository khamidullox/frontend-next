import { NextRequest } from 'next/server';
import { listUsers, createUser } from '@/lib/users';
import { withRole, Role } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withRole('admin', async () => {
    try {
      return Response.json({ data: await listUsers() });
    } catch (e) {
      // Временно отдаём текст ошибки, чтобы понять причину 500.
      return Response.json({ error: 'listUsers: ' + (e as Error).message }, { status: 500 });
    }
  });
}

export async function POST(request: NextRequest) {
  return withRole('admin', async () => {
    const { username, name, role, password, warehouses, car_number, transport, shop_id, home_warehouse } =
      await request.json().catch(() => ({}));
    const res = await createUser({
      username: String(username || ''),
      name: String(name || ''),
      role: role as Role,
      password: String(password || ''),
      warehouses,
      car_number: car_number === undefined ? undefined : String(car_number),
      transport: transport === undefined ? undefined : String(transport),
      shop_id: shop_id === undefined ? undefined : String(shop_id),
      home_warehouse: home_warehouse === undefined ? undefined : String(home_warehouse),
    });
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    return Response.json({ ok: true });
  });
}
