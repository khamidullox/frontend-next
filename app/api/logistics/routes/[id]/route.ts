import { NextRequest } from 'next/server';
import { getSession, ROLE_RANK, Session } from '@/lib/auth';
import { getRoute, addDeliveriesToRoute, finishRoute, Route } from '@/lib/routes';
import { getDeliveriesByIds } from '@/lib/deliveries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authorize(id: string): Promise<{ session: Session; route: Route } | { error: Response }> {
  const s = await getSession();
  if (!s) return { error: Response.json({ error: 'Не авторизован' }, { status: 401 }) };
  const route = await getRoute(id);
  if (!route) return { error: Response.json({ error: 'Маршрут не найден' }, { status: 404 }) };
  const isOwner = s.role === 'driver' && route.driver_username === s.username;
  const isManager = ROLE_RANK[s.role] >= ROLE_RANK['manager'];
  if (!isOwner && !isManager) return { error: Response.json({ error: 'Недостаточно прав' }, { status: 403 }) };
  return { session: s, route };
}

// Детали маршрута с развёрнутыми доставками (для истории/страницы водителя).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if ('error' in auth) return auth.error;
  const deliveries = await getDeliveriesByIds(auth.route.delivery_ids);
  return Response.json({ data: { ...auth.route, deliveries } });
}

// Присоединить доставки (add_delivery_ids) и/или завершить маршрут (status:'finished').
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(id);
  if ('error' in auth) return auth.error;

  const body = await request.json().catch(() => ({}));

  if (Array.isArray(body.add_delivery_ids) && body.add_delivery_ids.length) {
    const res = await addDeliveriesToRoute(id, body.add_delivery_ids.map(String));
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
  }
  if (body.status === 'finished') {
    const res = await finishRoute(id);
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
  }

  const updated = await getRoute(id);
  if (!updated) return Response.json({ error: 'Маршрут не найден' }, { status: 404 });
  const deliveries = await getDeliveriesByIds(updated.delivery_ids);
  return Response.json({ data: { ...updated, deliveries } });
}
