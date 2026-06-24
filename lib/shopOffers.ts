import { Delivery, listShopRequests, markNotified } from './deliveries';
import { listShops, Shop } from './shops';
import { sendPushToUser } from './push';
import { haversineKm } from './geo';
import { getCachedGpsLocations } from './gps';
import { listDrivers } from './users';

// Радиус рассылки заказа свободным водителям по их текущей позиции GPS.
const OFFER_RADIUS_KM = 6;
// Если за это время никто не взял заказ — повторяем рассылку (вдруг водители, что были
// рядом в первый раз, уже уехали, а другие подъехали). Не чаще, иначе будет спам.
const REBROADCAST_AFTER_MS = 90 * 60_000;
// Не сканировать Firestore на каждый опрос страницы — достаточно раз в несколько минут
// (сбрасывается при каждом холодном старте инстанса, что не страшно — просто лишний скан).
const CHECK_INTERVAL_MS = 5 * 60_000;
let lastCheckAt = 0;

// Авто-назначения для заявок магазина нет вообще — только уведомление. Заявка всегда
// остаётся новой/без водителя; рядом стоящим водителям (≤ OFFER_RADIUS_KM от точки
// выдачи по их текущему GPS) приходит push, и первый, кто нажмёт «Взять» на своей
// странице, забирает её (см. /api/logistics/shop-requests/claim). Если точки на карте
// нет — рассылать некому, заявка просто ждёт ручного назначения логистом (см. highlight
// «никто не взял» в админке — app/logistics/shop-requests/page.tsx).
export async function notifyNearbyDrivers(delivery: Delivery, shop: Shop): Promise<void> {
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
  await markNotified(delivery.id).catch(() => {});
}

// Повторная рассылка заявок, которые никто не взял за REBROADCAST_AFTER_MS. Вызывается
// «по случаю» из GET-эндпоинтов (когда логист или водитель открыл/обновил страницу) —
// настоящего фонового cron нет, так что сработает только когда кто-то реально зайдёт.
// Throttled через CHECK_INTERVAL_MS, чтобы не сканировать все заявки на каждый poll.
export async function rebroadcastStaleOffers(): Promise<void> {
  const now = Date.now();
  if (now - lastCheckAt < CHECK_INTERVAL_MS) return;
  lastCheckAt = now;

  const all = await listShopRequests();
  const stale = all.filter((d) => {
    if (d.driver_username || d.status !== 'new') return false;
    const last = d.last_notified_at ? new Date(d.last_notified_at).getTime() : new Date(d.created_at).getTime();
    return now - last >= REBROADCAST_AFTER_MS;
  });
  if (!stale.length) return;

  const shops = await listShops();
  for (const d of stale) {
    const shop = d.shop_id ? shops.find((s) => s.id === d.shop_id) : null;
    if (!shop) continue;
    await notifyNearbyDrivers(d, shop).catch(() => {});
  }
}
