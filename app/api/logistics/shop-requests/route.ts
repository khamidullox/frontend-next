import { NextRequest } from 'next/server';
import { getSession, ROLE_RANK } from '@/lib/auth';
import { createDelivery, listShopRequests, listShopRequestsForShop } from '@/lib/deliveries';
import { getShop } from '@/lib/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Раздел 2: заявки магазинов на доставку «магазин → клиент».
// worker видит только свои заявки; менеджер/админ — все (для присоединения к маршрутам).
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });

  if (s.role === 'worker') {
    if (!s.shop_id) return Response.json({ data: [] });
    return Response.json({ data: await listShopRequestsForShop(s.shop_id) });
  }
  if (ROLE_RANK[s.role] < ROLE_RANK['manager']) {
    return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  }
  return Response.json({ data: await listShopRequests() });
}

// Магазин создаёт заявку. direction/km наследуются от точки магазина — сам
// воркер их не указывает (машина едет в направлении этого магазина).
export async function POST(request: NextRequest) {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });
  if (s.role !== 'worker') return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!s.shop_id) {
    return Response.json({ error: 'Ваш аккаунт не привязан к магазину — обратитесь к администратору' }, { status: 403 });
  }

  const shop = await getShop(s.shop_id);
  if (!shop) return Response.json({ error: 'Магазин не найден' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const res = await createDelivery({
    kind: 'shop_to_client',
    shop_id: shop.id,
    shop_name: shop.name,
    client_name: body.client_name,
    address: body.address,
    note: body.note,
    direction: shop.direction,
    km: shop.km,
    created_by: s.name || s.username,
  });
  if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
  return Response.json({ data: res.delivery });
}
