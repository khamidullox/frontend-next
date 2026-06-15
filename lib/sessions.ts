import crypto from 'crypto';
import { getDb } from './firebase';
import { findProductCodeByBarcode } from './products';
import { resolveDocument, ResolveInput } from './resolve';
import { CheckDocument, DocType } from './document';

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

// Универсальная «шапка» документа — и для накладной, и для заказа.
export interface SessionDocument {
  doc_type: DocType;
  doc_id: string;
  doc_number: string;
  date: string;
  from_warehouse_code: string | null;
  to_warehouse_code: string | null;
  client_name: string | null;
  note: string | null;
}

export type SessionStatus = 'active' | 'finished';

interface StoredSession {
  id: string;
  created_at: string;
  finished_at?: string | null;
  status: SessionStatus;
  checker_name: string;
  document: SessionDocument;
  items: SessionItem[];
  scans: ScanRecord[];
}

export interface SessionListItem {
  id: string;
  created_at: string;
  finished_at?: string | null;
  status: SessionStatus;
  checker_name: string;
  doc_type: DocType;
  doc_id: string;
  doc_number: string;
  client_name: string | null;
  summary: ReturnType<typeof summarize>;
}

function normalizeCode(value: unknown): string {
  return String(value ?? '').trim();
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

// Совместимость со старыми сессиями (до появления заказов поле называлось
// `movement` и не имело doc_type/client_name).
function ensureDocument(session: StoredSession): StoredSession {
  if (session.document) return session;

  const legacy = (session as unknown as { movement?: Record<string, unknown> }).movement;
  return {
    ...session,
    document: {
      doc_type: 'movement',
      doc_id: String(legacy?.movement_id ?? ''),
      doc_number: String(legacy?.movement_number ?? ''),
      date: String(legacy?.from_movement_date ?? ''),
      from_warehouse_code: (legacy?.from_warehouse_code as string) ?? null,
      to_warehouse_code: (legacy?.to_warehouse_code as string) ?? null,
      client_name: null,
      note: (legacy?.note as string) ?? null,
    },
  };
}

function serialize(session: StoredSession) {
  const s = ensureDocument(session);
  return { ...s, summary: summarize(s.items) };
}

function pickDocument(doc: CheckDocument): SessionDocument {
  return {
    doc_type: doc.doc_type,
    doc_id: doc.doc_id,
    doc_number: doc.doc_number,
    date: doc.date,
    from_warehouse_code: doc.from_warehouse_code,
    to_warehouse_code: doc.to_warehouse_code,
    client_name: doc.client_name,
    note: doc.note,
  };
}

// ─── Операции ────────────────────────────────────────────────────────────────

export async function createSession(input: ResolveInput & { checker_name?: string }) {
  const doc = await resolveDocument(input);
  if (!doc) return null;

  const items: SessionItem[] = doc.items.map((item, index) => ({
    id: item.line_id || `${item.product_code}-${index}`,
    product_code: normalizeCode(item.product_code),
    product_name: item.product_name || '',
    quantity: Number(item.quantity || 0),
    scanned_quantity: 0,
    status: 'pending',
    barcodes: item.barcodes || [],
  }));

  const session: StoredSession = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    finished_at: null,
    status: 'active',
    checker_name: String(input.checker_name || '').trim(),
    document: pickDocument(doc),
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

export async function finishSession(sessionId: string) {
  const db = getDb();
  const ref = db.collection(SESSIONS_COLLECTION).doc(sessionId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const session = snap.data() as StoredSession;
    session.status = 'finished';
    session.finished_at = new Date().toISOString();

    tx.set(ref, session);
    return serialize(session);
  });
}

// Удаляет сессии старше `days` дней — чтобы Firestore не рос бесконечно
// (история проверок не нужна вечно, исходные документы есть в Smartup).
export async function purgeOldSessions(days = 60): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let deleted = 0;
  // created_at — ISO-строка, лексикографически сортируется по времени.
  for (;;) {
    const snap = await db
      .collection(SESSIONS_COLLECTION)
      .where('created_at', '<', cutoff)
      .limit(400)
      .get();

    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;

    if (snap.size < 400) break;
  }

  return deleted;
}

export async function listSessions(limit = 100): Promise<SessionListItem[]> {
  const snap = await getDb()
    .collection(SESSIONS_COLLECTION)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .get();

  return snap.docs.map((raw) => {
    const s = ensureDocument(raw.data() as StoredSession);
    return {
      id: s.id,
      created_at: s.created_at,
      finished_at: s.finished_at ?? null,
      status: s.status ?? 'active',
      checker_name: s.checker_name ?? '',
      doc_type: s.document.doc_type,
      doc_id: s.document.doc_id,
      doc_number: s.document.doc_number,
      client_name: s.document.client_name ?? null,
      summary: summarize(s.items || []),
    };
  });
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
