import { NextRequest } from 'next/server';
import { getSession, ROLE_RANK } from '@/lib/auth';
import { getDeliveryItemDims, splitDelivery, recomputeRouteKm } from '@/lib/deliveries';
import { notifyDriverAssigned } from '@/lib/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — состав доставки с весом/объёмом единицы (для подбора, что влезает в машину).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || ROLE_RANK[s.role] < ROLE_RANK['manager']) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  const { id } = await params;
  const res = await getDeliveryItemDims(id);
  if ('error' in res) return Response.json({ error: res.error }, { status: 404 });
  return Response.json({ data: res });
}

// POST { driver_username, take:[{code,qty}] } — назначить часть водителю, остаток оставить.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || ROLE_RANK[s.role] < ROLE_RANK['manager']) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const driver = String(body.driver_username || '');
  if (!driver) return Response.json({ error: 'Не указан водитель' }, { status: 400 });
  const take = Array.isArray(body.take) ? body.take : [];

  const res = await splitDelivery(id, take, driver, s.username);
  if ('error' in res) return Response.json({ error: res.error }, { status: 400 });

  notifyDriverAssigned(driver, res.delivery.client_name || res.delivery.address || 'новая доставка').catch(() => {});
  if (res.delivery.route_id) await recomputeRouteKm(res.delivery.route_id).catch(() => {});
  return Response.json({ data: res.delivery, split: res.split });
}
