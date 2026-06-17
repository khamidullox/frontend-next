import { NextRequest } from 'next/server';
import { listUsers, createUser } from '@/lib/users';
import { withRole, Role } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withRole('admin', async () => {
    return Response.json({ data: await listUsers() });
  });
}

export async function POST(request: NextRequest) {
  return withRole('admin', async () => {
    const { username, name, role, password, warehouses, car_number, transport } =
      await request.json().catch(() => ({}));
    const res = await createUser({
      username: String(username || ''),
      name: String(name || ''),
      role: role as Role,
      password: String(password || ''),
      warehouses,
      car_number: car_number === undefined ? undefined : String(car_number),
      transport: transport === undefined ? undefined : String(transport),
    });
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    return Response.json({ ok: true });
  });
}
