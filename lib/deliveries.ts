import crypto from 'crypto';
import { getDb } from './firebase';
import { resolveDocument } from './resolve';
import { getUserRaw, listDrivers } from './users';
import { getSession as getCheckSession } from './sessions';
import { getWarehouseCodeMap, getCachedCatalog } from './products';
import { DocType } from './document';
import { listShops, Shop } from './shops';

const COLLECTION = 'deliveries';

// ─── Расчёт километража по координатам точек ──────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normPointName(s: string): string {
  return String(s || '').replace(/\s*\d{6,}\s*$/, '').trim().toLowerCase();
}

function shopCoordsByName(name: string | null, shops: Shop[]): [number, number] | null {
  if (!name) return null;
  const n = normPointName(name);
  if (!n) return null;
  const sh = shops.find((s) => normPointName(s.name) === n)
    || shops.find((s) => normPointName(s.name).includes(n) || n.includes(normPointName(s.name)));
  return sh && sh.lat && sh.lng ? [sh.lat, sh.lng] : null;
}

// Км доставки по координатам: откуда (склад/магазин-источник) → куда (точка/адрес).
export function computeDeliveryKm(d: Delivery, shops: Shop[]): number | null {
  let dest: [number, number] | null = (d.lat != null && d.lng != null) ? [d.lat, d.lng] : null;
  if (!dest && d.shop_id) {
    const sh = shops.find((s) => s.id === d.shop_id);
    if (sh?.lat && sh?.lng) dest = [sh.lat, sh.lng];
  }
  if (!dest) dest = shopCoordsByName(d.to_name, shops);
  let src = shopCoordsByName(d.from_name, shops);
  if (!src && d.shop_id) {
    const sh = shops.find((s) => s.id === d.shop_id);
    if (sh?.lat && sh?.lng) src = [sh.lat, sh.lng];
  }
  if (!src || !dest) return null;
  return Math.round(haversineKm(src[0], src[1], dest[0], dest[1]));
}

// Статусы доставки. «new» — только что создана (водитель ещё не назначен или
// просто не приступил). Дальше по жизненному циклу.
export type DeliveryStatus = 'new' | 'assigned' | 'on_way' | 'delivered' | 'returned';

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  new: 'Новый',
  assigned: 'Назначен',
  on_way: 'В пути',
  delivered: 'Доставлено',
  returned: 'Возврат',
};

export type DeliverySource = 'document' | 'session' | 'manual';

// warehouse_dispatch — раздел 1 (склад → магазин/клиент, из накладной/заказа).
// shop_to_client — раздел 2: заявка магазина на доставку своему покупателю.
export type DeliveryKind = 'warehouse_dispatch' | 'shop_to_client';

interface StatusEvent {
  at: string;
  status: DeliveryStatus;
  by: string;
}

export interface Delivery {
  id: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  source: DeliverySource;
  kind: DeliveryKind;

  // Привязка к документу-первоисточнику (если есть).
  doc_type: DocType | null;
  doc_id: string | null;
  doc_number: string | null;

  // Кому/куда везём.
  client_name: string;
  address: string;
  note: string;

  // Маршрут склад → склад (для накладных/перемещений; у заказов — пусто).
  from_name: string | null;
  to_name: string | null;

  // Заявка магазина (kind = shop_to_client): кто создал.
  shop_id: string | null;
  shop_name: string | null;

  // Точка на карте, указанная вручную при создании заявки (если адрес не геокодируется).
  lat: number | null;
  lng: number | null;

  // Назначенный водитель (снимок данных на момент назначения).
  driver_username: string | null;
  driver_name: string | null;
  car_number: string | null;
  transport: string | null;

  // Габариты груза (из позиций документа × вес/объём товара из Smartup).
  total_weight: number;   // кг
  total_volume_l: number; // л
  total_qty: number;      // суммарное количество позиций

  // Маршрутизация.
  direction: string;      // Север / Юг / Восток / Запад / Центр
  km: number;             // расстояние до точки (км, в одну сторону)

  // Привязка к маршруту водителя (заход за один раз, см. lib/routes.ts).
  route_id: string | null;

  status: DeliveryStatus;
  history: StatusEvent[];
}

// Старые документы Firestore созданы до появления kind/shop_id/route_id — дефолтим их.
function normalizeDelivery(d: Delivery): Delivery {
  return {
    ...d,
    kind: d.kind ?? 'warehouse_dispatch',
    shop_id: d.shop_id ?? null,
    shop_name: d.shop_name ?? null,
    route_id: d.route_id ?? null,
    lat: d.lat ?? null,
    lng: d.lng ?? null,
  };
}

function str(v: unknown): string {
  return String(v ?? '').trim();
}

// Считает вес/объём/количество груза по позициям документа и каталогу Smartup.
async function computeDims(
  items: { product_code: string; quantity: number | string }[]
): Promise<{ weight: number; volume_l: number; qty: number }> {
  let weight = 0, volume_l = 0, qty = 0;
  if (items.length) {
    const catalog = await getCachedCatalog();
    const m = new Map(catalog.map((c) => [c.code, c]));
    for (const it of items) {
      const q = Number(it.quantity) || 0;
      qty += q;
      const c = m.get(str(it.product_code));
      if (c) { weight += q * c.weight; volume_l += q * c.volume_l; }
    }
  }
  return { weight: Math.round(weight * 100) / 100, volume_l: Math.round(volume_l * 100) / 100, qty };
}

// ─── Создание ────────────────────────────────────────────────────────────────

interface CreateInput {
  source?: DeliverySource;
  kind?: DeliveryKind;    // по умолчанию warehouse_dispatch
  query?: string;        // ID накладной/заказа — подтянем данные из Smartup (авто-тип)
  movement_id?: string;  // явная накладная
  deal_id?: string;      // явный заказ
  transfer_id?: string;  // явное перемещение
  receipt_id?: string;   // явная приёмка
  session_id?: string;   // ID проверки — подтянем данные из неё
  client_name?: string;
  address?: string;
  note?: string;
  shop_id?: string;       // заявка магазина (kind = shop_to_client)
  shop_name?: string;
  lat?: number;
  lng?: number;
  driver_username?: string;      // штатный водитель (есть аккаунт)
  external_driver?: string;      // внешний водитель «со стороны» — имя
  external_car?: string;         // его машина
  direction?: string;
  km?: number;
  weight_kg?: number;   // ручной ввод кг (переопределяет авто-расчёт)
  volume_m3?: number;   // ручной ввод м³ (переопределяет авто-расчёт)
  created_by?: string;
}

export async function createDelivery(
  input: CreateInput
): Promise<{ delivery: Delivery } | { error: string }> {
  const base: Partial<Delivery> = {
    doc_type: null,
    doc_id: null,
    doc_number: null,
    client_name: str(input.client_name),
    address: str(input.address),
    note: str(input.note),
  };
  let source: DeliverySource = input.source || 'manual';
  let fromCode: string | null = null;
  let toCode: string | null = null;
  let docItems: { product_code: string; quantity: number | string }[] = [];

  // Из проверки (сессии сканирования).
  if (input.session_id) {
    const s = await getCheckSession(str(input.session_id));
    if (!s) return { error: 'Проверка не найдена' };
    source = 'session';
    base.doc_type = s.document.doc_type;
    base.doc_id = s.document.doc_id;
    base.doc_number = s.document.doc_number;
    base.client_name = base.client_name || str(s.document.client_name);
    base.note = base.note || str(s.document.note);
    fromCode = s.document.from_warehouse_code;
    toCode = s.document.to_warehouse_code;
    docItems = s.items.map((it) => ({ product_code: it.product_code, quantity: it.quantity }));
  } else if (input.query || input.movement_id || input.deal_id || input.transfer_id || input.receipt_id) {
    // Из документа Smartup (накладная/заказ/перемещение/приёмка).
    const doc = await resolveDocument({
      query: input.query ? str(input.query) : undefined,
      movement_id: input.movement_id,
      deal_id: input.deal_id,
      transfer_id: input.transfer_id,
      receipt_id: input.receipt_id,
    });
    if (!doc) return { error: 'Документ не найден в Smartup' };
    source = 'document';
    base.doc_type = doc.doc_type;
    base.doc_id = doc.doc_id;
    base.doc_number = doc.doc_number;
    base.client_name = base.client_name || str(doc.client_name);
    base.note = base.note || str(doc.note);
    fromCode = doc.from_warehouse_code;
    toCode = doc.to_warehouse_code;
    docItems = doc.items.map((it) => ({ product_code: it.product_code, quantity: it.quantity }));
  }

  const dims = await computeDims(docItems);

  // Названия складов «откуда → куда» (если документ — накладная/перемещение).
  let from_name: string | null = null;
  let to_name: string | null = null;
  if (fromCode || toCode) {
    const whMap = await getWarehouseCodeMap();
    from_name = fromCode ? whMap.get(fromCode) || fromCode : null;
    to_name = toCode ? whMap.get(toCode) || toCode : null;
  }

  const now = new Date().toISOString();
  const delivery: Delivery = {
    id: crypto.randomUUID(),
    created_at: now,
    updated_at: now,
    created_by: str(input.created_by),
    source,
    kind: input.kind || 'warehouse_dispatch',
    doc_type: base.doc_type ?? null,
    doc_id: base.doc_id ?? null,
    doc_number: base.doc_number ?? null,
    client_name: base.client_name ?? '',
    address: base.address ?? '',
    note: base.note ?? '',
    from_name,
    to_name,
    shop_id: input.shop_id ? str(input.shop_id) : null,
    shop_name: input.shop_name ? str(input.shop_name) : null,
    lat: input.lat != null ? Number(input.lat) : null,
    lng: input.lng != null ? Number(input.lng) : null,
    total_weight: input.weight_kg != null ? input.weight_kg : dims.weight,
    total_volume_l: input.volume_m3 != null ? input.volume_m3 * 1000 : dims.volume_l,
    total_qty: dims.qty,
    direction: str(input.direction),
    km: Math.max(0, Number(input.km) || 0),
    driver_username: null,
    driver_name: null,
    car_number: null,
    transport: null,
    route_id: null,
    status: 'new',
    history: [{ at: now, status: 'new', by: str(input.created_by) }],
  };

  // Если водителя указали сразу — назначаем.
  if (input.driver_username) {
    await applyDriver(delivery, str(input.driver_username));
  } else if (str(input.external_driver)) {
    // Внешний водитель «со стороны» — без аккаунта, только имя/машина.
    delivery.driver_username = null;
    delivery.driver_name = str(input.external_driver);
    delivery.car_number = str(input.external_car) || null;
    delivery.transport = null;
    delivery.status = 'assigned';
  }

  await getDb().collection(COLLECTION).doc(delivery.id).set(delivery);
  return { delivery };
}

// Заполняет поля водителя из справочника пользователей (снимок данных).
async function applyDriver(delivery: Delivery, username: string): Promise<void> {
  const u = await getUserRaw(username);
  if (!u || u.role !== 'driver') return;
  delivery.driver_username = u.username;
  delivery.driver_name = u.name;
  delivery.car_number = u.car_number ?? null;
  delivery.transport = u.transport ?? null;
  if (delivery.status === 'new') delivery.status = 'assigned';
}

// ─── Чтение ────────────────────────────────────────────────────────────────

export async function listDeliveries(limit = 200): Promise<Delivery[]> {
  const snap = await getDb()
    .collection(COLLECTION)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => normalizeDelivery(d.data() as Delivery));
}

// Доставки конкретного водителя (без orderBy — сортируем в памяти, чтобы не
// требовать составной индекс Firestore).
export async function listDeliveriesForDriver(username: string): Promise<Delivery[]> {
  const snap = await getDb()
    .collection(COLLECTION)
    .where('driver_username', '==', str(username))
    .get();
  return snap.docs
    .map((d) => normalizeDelivery(d.data() as Delivery))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getDelivery(id: string): Promise<Delivery | null> {
  const snap = await getDb().collection(COLLECTION).doc(str(id)).get();
  return snap.exists ? normalizeDelivery(snap.data() as Delivery) : null;
}

// Несколько доставок по id (для разворачивания маршрута в истории/деталях).
export async function getDeliveriesByIds(ids: string[]): Promise<Delivery[]> {
  if (!ids.length) return [];
  const db = getDb();
  const snaps = await Promise.all(ids.map((id) => db.collection(COLLECTION).doc(id).get()));
  return snaps.filter((s) => s.exists).map((s) => normalizeDelivery(s.data() as Delivery));
}

// Заявки магазина (раздел 2), которые ещё не привязаны ни к одному маршруту.
export async function listShopRequestsForShop(shopId: string): Promise<Delivery[]> {
  const snap = await getDb()
    .collection(COLLECTION)
    .where('shop_id', '==', str(shopId))
    .get();
  return snap.docs
    .map((d) => normalizeDelivery(d.data() as Delivery))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function listShopRequests(): Promise<Delivery[]> {
  const snap = await getDb()
    .collection(COLLECTION)
    .where('kind', '==', 'shop_to_client')
    .get();
  return snap.docs
    .map((d) => normalizeDelivery(d.data() as Delivery))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// Привязка/отвязка доставок к маршруту (вызывается из lib/routes.ts).
export async function attachDeliveriesToRoute(ids: string[], routeId: string | null): Promise<void> {
  if (!ids.length) return;
  const db = getDb();
  const batch = db.batch();
  for (const id of ids) batch.update(db.collection(COLLECTION).doc(id), { route_id: routeId });
  await batch.commit();
}

// ─── Изменение ────────────────────────────────────────────────────────────────

// Назначить/сменить водителя. Пустой username — снять водителя.
export async function assignDriver(
  id: string,
  username: string | null
): Promise<{ delivery: Delivery } | { error: string }> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(str(id));
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Доставка не найдена' };

  const delivery = normalizeDelivery(snap.data() as Delivery);
  if (username) {
    await applyDriver(delivery, str(username));
  } else {
    delivery.driver_username = null;
    delivery.driver_name = null;
    delivery.car_number = null;
    delivery.transport = null;
    if (delivery.status === 'assigned') delivery.status = 'new';
  }
  delivery.updated_at = new Date().toISOString();
  await ref.set(delivery);
  return { delivery };
}

export async function setDeliveryStatus(
  id: string,
  status: DeliveryStatus,
  by: string
): Promise<{ delivery: Delivery } | { error: string }> {
  if (!DELIVERY_STATUS_LABEL[status]) return { error: 'Неверный статус' };
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(str(id));
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Доставка не найдена' };

  const delivery = normalizeDelivery(snap.data() as Delivery);
  const now = new Date().toISOString();
  delivery.status = status;
  delivery.updated_at = now;
  delivery.history = [...(delivery.history || []), { at: now, status, by: str(by) }].slice(-50);

  // Считаем км по координатам при выезде/доставке, если ещё не заполнен.
  if ((status === 'on_way' || status === 'delivered') && (!delivery.km || delivery.km <= 0)) {
    try {
      const shops = await listShops();
      const km = computeDeliveryKm(delivery, shops);
      if (km && km > 0) delivery.km = km;
    } catch { /* ignore */ }
  }

  await ref.set(delivery);
  return { delivery };
}

// Правка текстовых полей (адрес/клиент/примечание) — для менеджера.
export async function updateDeliveryFields(
  id: string,
  fields: { client_name?: string; address?: string; note?: string; direction?: string; km?: number; total_weight?: number }
): Promise<{ delivery: Delivery } | { error: string }> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(str(id));
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Доставка не найдена' };

  const delivery = normalizeDelivery(snap.data() as Delivery);
  if (fields.client_name !== undefined) delivery.client_name = str(fields.client_name);
  if (fields.address !== undefined) delivery.address = str(fields.address);
  if (fields.note !== undefined) delivery.note = str(fields.note);
  if (fields.direction !== undefined) delivery.direction = str(fields.direction);
  if (fields.km !== undefined) delivery.km = Math.max(0, Number(fields.km) || 0);
  if (fields.total_weight !== undefined) delivery.total_weight = Math.max(0, Number(fields.total_weight) || 0);
  delivery.updated_at = new Date().toISOString();
  await ref.set(delivery);
  return { delivery };
}

export async function deleteDelivery(id: string): Promise<boolean> {
  const ref = getDb().collection(COLLECTION).doc(str(id));
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

// ─── Автораспределение ───────────────────────────────────────────────────────
// Назначает нераспределённые доставки (direction задан) водителям по направлению.
// Учитывает вместимость: не превышает capacity_kg/m3 более чем на 10%.
export async function autoAssignDeliveries(
  by: string
): Promise<{ assigned: number; skipped: number }> {
  const db = getDb();
  const col = db.collection(COLLECTION);

  const [snap, drivers] = await Promise.all([col.get(), listDrivers()]);
  const all = snap.docs.map((d) => normalizeDelivery(d.data() as Delivery));

  // Нераспределённые с указанным направлением (раздел 1 — заявки магазинов
  // подхватываются отдельно, через присоединение к маршруту того же водителя).
  const queue = all.filter((d) => !d.driver_username && d.direction && d.status === 'new' && d.kind !== 'shop_to_client');
  if (!queue.length) return { assigned: 0, skipped: 0 };

  const activeDrivers = drivers.filter((dr) => dr.direction);
  if (!activeDrivers.length) return { assigned: 0, skipped: queue.length };

  // Текущая нагрузка каждого водителя (активные доставки).
  const loadMap = new Map<string, { weight: number; vol_l: number }>();
  for (const d of all) {
    if (d.driver_username && !['delivered', 'returned'].includes(d.status)) {
      const cur = loadMap.get(d.driver_username) || { weight: 0, vol_l: 0 };
      cur.weight += d.total_weight || 0;
      cur.vol_l += d.total_volume_l || 0;
      loadMap.set(d.driver_username, cur);
    }
  }

  const now = new Date().toISOString();
  const batch = db.batch();
  let assigned = 0, skipped = 0;

  for (const delivery of queue) {
    const candidates = activeDrivers.filter((dr) => dr.direction === delivery.direction);
    if (!candidates.length) { skipped++; continue; }

    // Выбираем водителя с наибольшим остатком вместимости (или первого, если ёмкость не задана).
    let best: typeof candidates[0] | null = null;
    let bestScore = -Infinity;

    for (const dr of candidates) {
      const cur = loadMap.get(dr.username) || { weight: 0, vol_l: 0 };
      const capKg = dr.capacity_kg;
      const capM3 = dr.capacity_m3;
      const dw = delivery.total_weight || 0;
      const dv = delivery.total_volume_l || 0;

      // Жёсткий предел: не больше 110% от ёмкости.
      if (capKg > 0 && cur.weight + dw > capKg * 1.1) continue;
      if (capM3 > 0 && cur.vol_l + dv > capM3 * 1000 * 1.1) continue;

      const score = capKg > 0 ? capKg - cur.weight : 99999 - cur.weight * 0.001;
      if (score > bestScore) { bestScore = score; best = dr; }
    }

    if (!best) { skipped++; continue; }

    const updated: Delivery = {
      ...delivery,
      driver_username: best.username,
      driver_name: best.name,
      car_number: best.car_number || null,
      transport: best.transport || null,
      status: 'assigned',
      updated_at: now,
      history: [...(delivery.history || []), { at: now, status: 'assigned', by }],
    };
    batch.set(col.doc(delivery.id), updated);

    const cur = loadMap.get(best.username) || { weight: 0, vol_l: 0 };
    cur.weight += delivery.total_weight || 0;
    cur.vol_l += delivery.total_volume_l || 0;
    loadMap.set(best.username, cur);
    assigned++;
  }

  if (assigned > 0) await batch.commit();
  return { assigned, skipped };
}
