import { getSession } from '@/lib/auth';
import { claimDelivery } from '@/lib/deliveries';
import { getActiveRouteForDriver, addDeliveriesToRoute } from '@/lib/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Водитель берёт заказ из рассылки. Атомарно: получит только если заявка ещё ничья.
export async function POST(request: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });
  if (s.role !== 'driver') return Response.json({ error: 'Только водитель может взять заказ' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.delivery_id || '');
  if (!id) return Response.json({ error: 'Не указан заказ' }, { status: 400 });

  const res = await claimDelivery(id, s.username);
  if ('error' in res) return Response.json({ error: res.error }, { status: 409 });

  // Если водитель уже в активном заходе — сразу добавляем заказ в его маршрут.
  const route = await getActiveRouteForDriver(s.username).catch(() => null);
  if (route) await addDeliveriesToRoute(route.id, [id]).catch(() => {});

  return Response.json({ data: res.delivery });
}
