import { NextRequest } from 'next/server';
import { getSession, ROLE_RANK } from '@/lib/auth';
import { createDelivery, listShopRequests, listShopRequestsForShop, Delivery } from '@/lib/deliveries';
import { getShop, Shop } from '@/lib/shops';
import { sendPushToUser } from '@/lib/push';
import { haversineKm } from '@/lib/geo';
import { getCachedGpsLocations } from '@/lib/gps';
import { listDrivers } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Радиус рассылки заказа свободным водителям по их текущей позиции GPS.
const OFFER_RADIUS_KM = 6;

// Авто-назначения для заявок магазина сейчас нет вообще — только уведомление. Заявка
// всегда остаётся новой/без водителя; рядом стоящим водителям (≤ OFFER_RADIUS_KM от
// точки выдачи по их текущему GPS) приходит push, и первый, кто нажмёт «Взять» на своей
// странице, забирает её (см. /api/logistics/shop-requests/claim). Если точки на карте
// нет — рассылать некому, заявка просто ждёт ручного назначения логистом (см. highlight
// «никто не взял» в админке — app/logistics/shop-requests/page.tsx).
async function notifyNearbyDrivers(delivery: Delivery, shop: Shop): Promise<void> {
  const pickup: [number, number] | null =
    shop.lat != null && shop.lng != null ? [shop.lat, shop.lng]
    : delivery.lat != null && delivery.lng != null ? [delivery.lat, delivery.lng]
    : null;
  if (!pickup) return;

  const [gps, drivers] = await Promise.all([getCachedGpsLocations(), listDrivers()]);
  const label = delivery.shop_name
    ? `Забрать в «${delivery.shop_name}» → ${delivery.client_name || delivery.address || 'клиент'}`
    : delivery.client_name || delivery.address || 'новый заказ';
  const notified = new Set<string>();
  for (const loc of gps.locations) {
    if (typeof loc.lat !== 'number' || typeof loc.lng !== 'number') continue;
    const km = haversineKm(pickup[0], pickup[1], loc.lat, loc.lng);
    if (km > OFFER_RADIUS_KM) continue;
    const driver = loc.user_id.startsWith('phone:')
      ? drivers.find((d) => d.username === loc.user_id.slice('phone:'.length))
      : drivers.find((d) => d.gps_user_id === loc.user_id);
    if (!driver || notified.has(driver.username)) continue;
    notified.add(driver.username);
    sendPushToUser(driver.username, {
      title: '📢 Заказ рядом',
      body: `${label} · ~${Math.round(km)} км`,
      url: '/logistics/my',
    }).catch(() => {});
  }
}

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

// Магазин создаёт заявку (или менеджер/админ — от имени любого магазина).
// direction/km наследуются от точки магазина — сам воркер их не указывает
// (машина едет в направлении этого магазина).
export async function POST(request: NextRequest) {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await request.json().catch(() => ({}));

  let shopId: string;
  if (s.role === 'worker') {
    if (!s.shop_id) {
      return Response.json({ error: 'Ваш аккаунт не привязан к магазину — обратитесь к администратору' }, { status: 403 });
    }
    shopId = s.shop_id;
  } else if (ROLE_RANK[s.role] >= ROLE_RANK['manager']) {
    shopId = String(body.shop_id || '');
    if (!shopId) return Response.json({ error: 'Укажите магазин' }, { status: 400 });
  } else {
    return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  }

  const shop = await getShop(shopId);
  if (!shop) return Response.json({ error: 'Магазин не найден' }, { status: 400 });

  const items = Array.isArray(body.items)
    ? body.items
        .map((it: { code?: unknown; name?: unknown; qty?: unknown }) => ({
          code: String(it.code || ''), name: String(it.name || ''), qty: Math.max(0, Number(it.qty) || 0),
        }))
        .filter((it: { code: string; qty: number }) => it.code && it.qty > 0)
    : undefined;

  const res = await createDelivery({
    kind: 'shop_to_client',
    shop_id: shop.id,
    shop_name: shop.name,
    client_name: body.client_name,
    client_phone: body.client_phone,
    address: body.address,
    note: body.note,
    items,
    direction: shop.direction,
    km: shop.km,
    lat: body.lat != null ? Number(body.lat) : undefined,
    lng: body.lng != null ? Number(body.lng) : undefined,
    created_by: s.name || s.username,
  });
  if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
  await notifyNearbyDrivers(res.delivery, shop).catch(() => {});
  return Response.json({ data: res.delivery });
}
