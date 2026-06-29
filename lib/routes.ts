import crypto from 'crypto';
import { getDb } from './firebase';
import { getUserRaw } from './users';
import { Delivery, listDeliveriesForDriver, getDeliveriesByIds, attachDeliveriesToRoute, recomputeRouteKm } from './deliveries';

const COLLECTION = 'routes';

export type RouteStatus = 'active' | 'finished';

// Заход водителя за один раз: список доставок (раздел 1 + присоединённые
// заявки магазинов раздела 2), начинается явной кнопкой «Начать маршрут».
export interface Route {
  id: string;
  driver_username: string;
  driver_name: string;
  car_number: string | null;
  status: RouteStatus;
  started_at: string;
  finished_at: string | null;
  delivery_ids: string[];
  total_km: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function str(v: unknown): string {
  return String(v ?? '').trim();
}

export async function getActiveRouteForDriver(username: string): Promise<Route | null> {
  const snap = await getDb()
    .collection(COLLECTION)
    .where('driver_username', '==', str(username))
    .where('status', '==', 'active')
    .limit(1)
    .get();
  return snap.empty ? null : (snap.docs[0].data() as Route);
}

export async function getRoute(id: string): Promise<Route | null> {
  const snap = await getDb().collection(COLLECTION).doc(str(id)).get();
  return snap.exists ? (snap.data() as Route) : null;
}

export async function listRoutes(limit = 200): Promise<Route[]> {
  const snap = await getDb()
    .collection(COLLECTION)
    .orderBy('started_at', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => d.data() as Route);
}

// Без orderBy — сортируем в памяти, чтобы не требовать составной индекс Firestore.
export async function listRoutesForDriver(username: string): Promise<Route[]> {
  const snap = await getDb()
    .collection(COLLECTION)
    .where('driver_username', '==', str(username))
    .get();
  return snap.docs
    .map((d) => d.data() as Route)
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
}

// Начинает заход: подхватывает все назначенные, но ещё не привязанные к
// маршруту доставки этого водителя (раздела 1 и раздела 2). Если у водителя
// уже есть активный маршрут — возвращает его (идемпотентно).
export async function createRoute(
  driverUsername: string,
  by: string
): Promise<{ route: Route } | { error: string }> {
  const username = str(driverUsername);
  if (!username) return { error: 'Не указан водитель' };

  const existing = await getActiveRouteForDriver(username);
  if (existing) return { route: existing };

  const driver = await getUserRaw(username);
  if (!driver || driver.role !== 'driver') return { error: 'Водитель не найден' };

  const myDeliveries = await listDeliveriesForDriver(username);
  // Берём ВСЕ активные доставки водителя (не только assigned, но и new/on_way),
  // у которых ещё нет маршрута — заход формируется как один с внутренними доставками.
  const pending = myDeliveries.filter(
    (d) => !d.route_id && ['new', 'assigned', 'on_way'].includes(d.status)
  );

  const now = new Date().toISOString();
  const route: Route = {
    id: crypto.randomUUID(),
    driver_username: username,
    driver_name: driver.name,
    car_number: driver.car_number || null,
    status: 'active',
    started_at: now,
    finished_at: null,
    delivery_ids: pending.map((d) => d.id),
    total_km: 0,
    created_by: str(by),
    created_at: now,
    updated_at: now,
  };

  await getDb().collection(COLLECTION).doc(route.id).set(route);
  if (pending.length) await attachDeliveriesToRoute(pending.map((d) => d.id), route.id);
  return { route };
}

// Удалить маршрут (отвязав от него доставки). Используется для чистки пустых
// тестовых заходов в отчёте.
export async function deleteRoute(id: string): Promise<{ ok: true } | { error: string }> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(str(id));
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Маршрут не найден' };
  const route = snap.data() as Route;
  // Отвязываем доставки (если были привязаны), чтобы они не висели с битым route_id.
  for (const did of route.delivery_ids || []) {
    await db.collection('deliveries').doc(str(did)).set({ route_id: null }, { merge: true }).catch(() => {});
  }
  await ref.delete();
  return { ok: true };
}

// Присоединить доставки к уже идущему маршруту (например логист назначил
// заявку магазина водителю, который уже в пути).
export async function addDeliveriesToRoute(
  routeId: string,
  deliveryIds: string[]
): Promise<{ route: Route } | { error: string }> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(str(routeId));
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Маршрут не найден' };

  const route = snap.data() as Route;
  const ids = [...new Set([...route.delivery_ids, ...deliveryIds])];
  route.delivery_ids = ids;
  route.updated_at = new Date().toISOString();
  await ref.set(route);
  await attachDeliveriesToRoute(deliveryIds, route.id);
  return { route };
}

// Завершает маршрут и фиксирует пробег = сумма km входящих доставок.
export async function finishRoute(
  routeId: string
): Promise<{ route: Route } | { error: string }> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(str(routeId));
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Маршрут не найден' };

  const route = snap.data() as Route;
  if (route.status === 'finished') return { route };

  // Пересчитываем км по всему маршруту (с дедупликацией одинаковых точек и цепочкой
  // остановок) и фиксируем итог.
  await recomputeRouteKm(routeId).catch(() => {});
  const deliveries: Delivery[] = await getDeliveriesByIds(route.delivery_ids);
  const totalKm = deliveries.reduce((s, d) => s + (d.km || 0), 0);

  const now = new Date().toISOString();
  route.status = 'finished';
  route.finished_at = now;
  route.updated_at = now;
  route.total_km = totalKm;
  await ref.set(route);
  return { route };
}

// Принудительно завершает ВСЕ активные маршруты (ночной cron в 22:00, см.
// app/api/cron/finish-routes). Если водитель забыл нажать «Закончить маршрут»,
// его заход тянулся бы во вчерашнем виде до утра — и было бы непонятно, выехал
// он уже сегодня или это хвост вчерашнего. Закрывая всё в 22:00, к утру список
// активных маршрутов гарантированно пуст — кто «в заходе» днём, точно вышел сегодня.
export async function finishAllActiveRoutes(): Promise<{ finished: number }> {
  const snap = await getDb().collection(COLLECTION).where('status', '==', 'active').get();
  let finished = 0;
  for (const doc of snap.docs) {
    const res = await finishRoute(doc.id);
    if ('route' in res) finished++;
  }
  return { finished };
}
