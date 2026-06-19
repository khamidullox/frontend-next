import crypto from 'crypto';
import { getDb } from './firebase';
import { resolveDocument } from './resolve';
import { getUserRaw } from './users';
import { getSession as getCheckSession } from './sessions';
import { getWarehouseCodeMap, getCachedCatalog } from './products';
import { DocType } from './document';

const COLLECTION = 'deliveries';

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

  // Назначенный водитель (снимок данных на момент назначения).
  driver_username: string | null;
  driver_name: string | null;
  car_number: string | null;
  transport: string | null;

  // Габариты груза (из позиций документа × вес/объём товара из Smartup).
  total_weight: number;   // кг
  total_volume_l: number; // л
  total_qty: number;      // суммарное количество позиций

  status: DeliveryStatus;
  history: StatusEvent[];
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
  query?: string;        // ID накладной/заказа — подтянем данные из Smartup (авто-тип)
  movement_id?: string;  // явная накладная
  deal_id?: string;      // явный заказ
  transfer_id?: string;  // явное перемещение
  receipt_id?: string;   // явная приёмка
  session_id?: string;   // ID проверки — подтянем данные из неё
  client_name?: string;
  address?: string;
  note?: string;
  driver_username?: string;      // штатный водитель (есть аккаунт)
  external_driver?: string;      // внешний водитель «со стороны» — имя
  external_car?: string;         // его машина
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
    doc_type: base.doc_type ?? null,
    doc_id: base.doc_id ?? null,
    doc_number: base.doc_number ?? null,
    client_name: base.client_name ?? '',
    address: base.address ?? '',
    note: base.note ?? '',
    from_name,
    to_name,
    total_weight: dims.weight,
    total_volume_l: dims.volume_l,
    total_qty: dims.qty,
    driver_username: null,
    driver_name: null,
    car_number: null,
    transport: null,
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
  return snap.docs.map((d) => d.data() as Delivery);
}

// Доставки конкретного водителя (без orderBy — сортируем в памяти, чтобы не
// требовать составной индекс Firestore).
export async function listDeliveriesForDriver(username: string): Promise<Delivery[]> {
  const snap = await getDb()
    .collection(COLLECTION)
    .where('driver_username', '==', str(username))
    .get();
  return snap.docs
    .map((d) => d.data() as Delivery)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getDelivery(id: string): Promise<Delivery | null> {
  const snap = await getDb().collection(COLLECTION).doc(str(id)).get();
  return snap.exists ? (snap.data() as Delivery) : null;
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

  const delivery = snap.data() as Delivery;
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

  const delivery = snap.data() as Delivery;
  const now = new Date().toISOString();
  delivery.status = status;
  delivery.updated_at = now;
  delivery.history = [...(delivery.history || []), { at: now, status, by: str(by) }].slice(-50);
  await ref.set(delivery);
  return { delivery };
}

// Правка текстовых полей (адрес/клиент/примечание) — для менеджера.
export async function updateDeliveryFields(
  id: string,
  fields: { client_name?: string; address?: string; note?: string }
): Promise<{ delivery: Delivery } | { error: string }> {
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(str(id));
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Доставка не найдена' };

  const delivery = snap.data() as Delivery;
  if (fields.client_name !== undefined) delivery.client_name = str(fields.client_name);
  if (fields.address !== undefined) delivery.address = str(fields.address);
  if (fields.note !== undefined) delivery.note = str(fields.note);
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
