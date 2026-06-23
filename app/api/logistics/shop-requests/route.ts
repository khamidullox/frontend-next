import { NextRequest } from 'next/server';
import { getSession, ROLE_RANK } from '@/lib/auth';
import { createDelivery, listShopRequests, listShopRequestsForShop, assignDriver, getDeliveriesByIds, resolveDestPoint, Delivery } from '@/lib/deliveries';
import { getShop, listShops, Shop } from '@/lib/shops';
import { listRoutes, addDeliveriesToRoute, Route } from '@/lib/routes';
import { notifyDriverAssigned, sendPushToUser } from '@/lib/push';
import { haversineKm } from '@/lib/geo';
import { getCachedGpsLocations } from '@/lib/gps';
import { listDrivers } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Водитель «по пути» считается подходящим, если его маршрут проходит не дальше
// этого расстояния от точки выдачи (магазина) — он заберёт товар по дороге.
const NEARBY_KM = 10;
// Радиус рассылки заказа свободным водителям по их текущей позиции GPS.
const OFFER_RADIUS_KM = 6;

// Если авто-назначение никого не нашло — рассылаем заказ водителям, чья текущая
// позиция GPS не дальше OFFER_RADIUS_KM от точки выдачи. Первый, кто нажмёт «Взять»
// на своей странице, заберёт заказ (см. /api/logistics/shop-requests/claim).
async function broadcastOfferToNearbyDrivers(delivery: Delivery, pickup: [number, number] | null) {
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

// Подбор водителя «по пути» для заявки магазина, по приоритету:
//   1) у кого в активном маршруте уже есть остановка ровно в этом магазине;
//   2) чей маршрут проходит ближе всего к магазину (≤ NEARBY_KM) — по координатам;
//   3) у кого есть остановка в том же городе/направлении (грубый фолбэк без координат).
// Если ничего не подошло — заявка остаётся без водителя, менеджер назначит вручную.
async function autoAssignOnTheWay(delivery: Delivery, shop: Shop): Promise<Delivery> {
  const [routes, shops] = await Promise.all([listRoutes(), listShops()]);
  const activeRoutes = routes.filter((r) => r.status === 'active' && r.delivery_ids?.length);
  if (!activeRoutes.length) return delivery;

  // Точка выдачи (где водитель забирает товар) — координаты магазина-источника.
  const pickup: [number, number] | null =
    shop.lat != null && shop.lng != null ? [shop.lat, shop.lng]
    : delivery.lat != null && delivery.lng != null ? [delivery.lat, delivery.lng]
    : null;

  let exactRoute: Route | null = null;
  let directionRoute: Route | null = null;
  let nearestRoute: Route | null = null;
  let nearestKm = Infinity;

  for (const route of activeRoutes) {
    const ds = await getDeliveriesByIds(route.delivery_ids);
    if (ds.some((d) => d.shop_id === shop.id)) { exactRoute = route; break; }
    if (pickup) {
      for (const d of ds) {
        const p = resolveDestPoint(d, shops);
        if (!p) continue;
        const km = haversineKm(pickup[0], pickup[1], p[0], p[1]);
        if (km < nearestKm) { nearestKm = km; nearestRoute = route; }
      }
    }
    if (!directionRoute && shop.direction && ds.some((d) => d.direction === shop.direction)) {
      directionRoute = route;
    }
  }

  const match = exactRoute
    || (nearestKm <= NEARBY_KM ? nearestRoute : null)
    || directionRoute;
  if (!match) {
    // Никто не «по пути» — рассылаем заказ свободным водителям рядом, пусть берут сами.
    await broadcastOfferToNearbyDrivers(delivery, pickup).catch(() => {});
    return delivery;
  }

  const assigned = await assignDriver(delivery.id, match.driver_username);
  if ('error' in assigned) return delivery;
  await addDeliveriesToRoute(match.id, [delivery.id]).catch(() => {});
  notifyDriverAssigned(
    match.driver_username,
    assigned.delivery.client_name || assigned.delivery.address || 'новая доставка'
  ).catch(() => {});
  return assigned.delivery;
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
  const finalDelivery = await autoAssignOnTheWay(res.delivery, shop).catch(() => res.delivery);
  return Response.json({ data: finalDelivery });
}
