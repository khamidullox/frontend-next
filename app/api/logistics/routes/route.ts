import { NextRequest } from 'next/server';
import { getSession, ROLE_RANK } from '@/lib/auth';
import { createRoute, listRoutes, listRoutesForDriver } from '@/lib/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Водитель видит только свои маршруты; менеджер/админ — все (для истории).
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });

  if (s.role === 'driver') {
    return Response.json({ data: await listRoutesForDriver(s.username) });
  }
  if (ROLE_RANK[s.role] < ROLE_RANK['manager']) {
    return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  }
  return Response.json({ data: await listRoutes() });
}

// Начать маршрут. Водитель начинает свой; менеджер+ может начать «за» водителя.
export async function POST(request: NextRequest) {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  let driverUsername = s.username;
  if (s.role !== 'driver') {
    if (ROLE_RANK[s.role] < ROLE_RANK['manager']) {
      return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
    }
    driverUsername = String(body.driver_username || '');
    if (!driverUsername) return Response.json({ error: 'Укажите водителя' }, { status: 400 });
  }

  const res = await createRoute(driverUsername, s.name || s.username);
  if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
  return Response.json({ data: res.route });
}
