import crypto from 'crypto';
import { getDb } from './firebase';
import { getEnrichedMovement, MovementFilters, Movement } from './movement';
import { findProductCodeByBarcode } from './products';

const SESSIONS_COLLECTION = 'sessions';
const MAX_SCANS = 300;

export type ItemStatus = 'pending' | 'partial' | 'done';
export type ScanStatus = 'done' | 'partial' | 'over_scanned' | 'not_found' | 'manual';

export interface SessionItem {
  id: string;
  product_code: string;
  product_name: string;
  quantity: number;
  scanned_quantity: number;
  status: ItemStatus;
  barcodes: string[];
}

export interface ScanRecord {
  barcode: string | null;
  product_code: string;
  scanned_at: string;
  status: ScanStatus;
  message: string;
  item_id?: string;
  manual?: boolean;
}

export interface SessionMovement {
  filial_code: string;
  external_id: string | null;
  movement_id: string;
  movement_number: string;
  from_movement_date: string;
  to_movement_date: string;
  status: string;
  from_warehouse_code: string | null;
  to_warehouse_code: string | null;
  barcode: string;
  note: string | null;
}

interface StoredSession {
  id: string;
  created_at: string;
  movement: SessionMovement;
  items: SessionItem[];
  scans: ScanRecord[];
}

function normalizeCode(value: unknown): string {
  return String(value ?? '').trim();
}

function buildItemKey(item: Record<string, unknown>, index: number): string {
  return (
    normalizeCode(item.movement_item_id) ||
    normalizeCode(item.external_id) ||
    `${normalizeCode(item.product_code)}-${index}`
  );
}

function getStatus(item: SessionItem): ItemStatus {
  if (item.scanned_quantity <= 0) return 'pending';
  if (item.scanned_quantity < item.quantity) return 'partial';
  return 'done';
}

function summarize(items: SessionItem[]) {
  return items.reduce(
    (s, item) => {
      s.total += item.quantity;
      s.scanned += item.scanned_quantity;
      if (item.status === 'done') s.done_items += 1;
      return s;
    },
    { total: 0, scanned: 0, done_items: 0, total_items: items.length }
  );
}

function serialize(session: StoredSession) {
  return { ...session, summary: summarize(session.items) };
}

function pickMovement(movement: Movement): SessionMovement {
  return {
    filial_code: movement.filial_code,
    external_id: movement.external_id,
    movement_id: movement.movement_id,
    movement_number: movement.movement_number,
    from_movement_date: movement.from_movement_date,
    to_movement_date: movement.to_movement_date,
    status: movement.status,
    from_warehouse_code: movement.from_warehouse_code,
    to_warehouse_code: movement.to_warehouse_code,
    barcode: movement.barcode,
    note: movement.note,
  };
}

// ─── Операции ────────────────────────────────────────────────────────────────

export async function createSession(filters: MovementFilters) {
  const movement = await getEnrichedMovement(filters);
  if (!movement) return null;

  const items: SessionItem[] = (movement.movement_items || []).map((item, index) => ({
    id: buildItemKey(item, index),
    product_code: normalizeCode(item.product_code),
    product_name: item.product_name || '',
    quantity: Number(item.quantity || 0),
    scanned_quantity: 0,
    status: 'pending',
    barcodes: (item.barcodes as string[]) || [],
  }));

  const session: StoredSession = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    movement: pickMovement(movement),
    items,
    scans: [],
  };

  await getDb().collection(SESSIONS_COLLECTION).doc(session.id).set(session);

  return serialize(session);
}

export async function getSession(sessionId: string) {
  const snap = await getDb().collection(SESSIONS_COLLECTION).doc(sessionId).get();
  if (!snap.exists) return null;
  return serialize(snap.data() as StoredSession);
}

export async function scanBarcode(sessionId: string, barcode: string) {
  const normalizedBarcode = normalizeCode(barcode);
  const productCode = await findProductCodeByBarcode(normalizedBarcode);

  const db = getDb();
  const ref = db.collection(SESSIONS_COLLECTION).doc(sessionId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const session = snap.data() as StoredSession;
    const item = session.items.find((c) => c.product_code === productCode);

    const scan: ScanRecord = {
      barcode: normalizedBarcode,
      product_code: productCode,
      scanned_at: new Date().toISOString(),
      status: 'not_found',
      message: 'Товар не найден в накладной',
    };

    if (item) {
      if (item.scanned_quantity >= item.quantity) {
        scan.status = 'over_scanned';
        scan.message = 'Количество по этому товару уже собрано';
      } else {
        item.scanned_quantity += 1;
        item.status = getStatus(item);
        scan.status = item.status === 'done' ? 'done' : 'partial';
        scan.message = 'Скан принят';
        scan.item_id = item.id;
      }
    }

    session.scans.unshift(scan);
    session.scans = session.scans.slice(0, MAX_SCANS);

    tx.set(ref, session);

    return { scan, session: serialize(session) };
  });
}

export async function setItemQuantity(
  sessionId: string,
  itemId: string,
  quantity: number
) {
  const db = getDb();
  const ref = db.collection(SESSIONS_COLLECTION).doc(sessionId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const session = snap.data() as StoredSession;
    const item = session.items.find((c) => c.id === itemId);
    if (!item) return { error: 'Позиция не найдена в накладной' as const };

    const value = Number(quantity);
    if (!Number.isFinite(value) || value < 0) {
      return { error: 'Некорректное количество' as const };
    }

    const clamped = Math.min(Math.floor(value), item.quantity);
    item.scanned_quantity = clamped;
    item.status = getStatus(item);

    session.scans.unshift({
      barcode: null,
      product_code: item.product_code,
      scanned_at: new Date().toISOString(),
      status: 'manual',
      message: `Количество установлено вручную: ${clamped} из ${item.quantity}`,
      item_id: item.id,
      manual: true,
    });
    session.scans = session.scans.slice(0, MAX_SCANS);

    tx.set(ref, session);

    return { item_id: item.id, session: serialize(session) };
  });
}
