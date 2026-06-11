import { getDb } from './firebase';

const PRODUCTS_COLLECTION = 'products';
const META_DOC = 'meta/products_sync';
const INVENTORY_EXPORT_ENDPOINT = '/b/anor/mxsx/mr/inventory$export';

import { smartupRequest } from './smartup';

export interface ProductDoc {
  code: string;
  name: string;
  short_name: string;
  barcodes: string[];
}

function normalizeCode(value: unknown): string {
  return String(value ?? '').trim();
}

// Smartup отдаёт ШК одной строкой через "|" или "," (бывает несколько),
// а также через ";" / пробел.
function splitBarcodes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(splitBarcodes);
  }
  return String(value ?? '')
    .split(/[|,\s;]+/)
    .map(normalizeCode)
    .filter(Boolean);
}

// Некоторые товары имеют штрихкод прямо в названии. Берём только длинные
// последовательности цифр (от 8 знаков — EAN-8/UPC/EAN-13), чтобы не
// зацепить модельные номера и габариты ("356L", "1400RPM", "200x64x60").
function extractBarcodesFromText(text: unknown): string[] {
  const matches = String(text ?? '').match(/\d{8,}/g) || [];
  return matches.map(normalizeCode).filter(Boolean);
}

function buildBarcodes(item: Record<string, unknown>): string[] {
  const all = [
    ...splitBarcodes(item.barcodes),
    ...extractBarcodesFromText(item.name),
    ...extractBarcodesFromText(item.short_name),
  ];
  return [...new Set(all)];
}

// ─── Чтение справочника ──────────────────────────────────────────────────────

// Пакетное чтение нескольких товаров (для позиций накладной) — один запрос.
export async function getProductInfos(
  codes: string[]
): Promise<Map<string, ProductDoc>> {
  const db = getDb();
  const unique = [...new Set(codes.map(normalizeCode).filter(Boolean))];
  const result = new Map<string, ProductDoc>();

  if (unique.length === 0) return result;

  const refs = unique.map((code) => db.collection(PRODUCTS_COLLECTION).doc(code));
  const snaps = await db.getAll(...refs);

  for (const snap of snaps) {
    if (snap.exists) {
      const data = snap.data() as ProductDoc;
      result.set(snap.id, data);
    }
  }

  return result;
}

// Поиск кода товара по штрихкоду. Если не найден — возвращаем сам ввод
// (кладовщик мог отсканировать код товара напрямую).
export async function findProductCodeByBarcode(barcode: string): Promise<string> {
  const normalized = normalizeCode(barcode);
  if (!normalized) return normalized;

  const db = getDb();
  const snap = await db
    .collection(PRODUCTS_COLLECTION)
    .where('barcodes', 'array-contains', normalized)
    .limit(1)
    .get();

  if (!snap.empty) {
    return snap.docs[0].id;
  }

  return normalized;
}

// ─── Синхронизация справочника из Smartup ────────────────────────────────────

function formatSmartupDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

interface SyncResult {
  fetched: number;
  written: number;
  mode: 'full' | 'incremental';
}

/**
 * Синхронизирует справочник товаров.
 * - full=true  — заливает ВСЕ товары (первый запуск, разово).
 * - full=false — только изменённые с прошлого синка (begin_modified_on),
 *   это десятки/сотни записей в день. Новые товары тоже подхватываются.
 */
export async function syncProducts({ full = false } = {}): Promise<SyncResult> {
  const db = getDb();
  const metaRef = db.doc(META_DOC);

  const body: Record<string, unknown> = {};
  let mode: 'full' | 'incremental' = 'full';

  if (!full) {
    const metaSnap = await metaRef.get();
    const lastSync = metaSnap.exists
      ? (metaSnap.data() as { last_sync_ms?: number }).last_sync_ms
      : undefined;

    if (lastSync) {
      // Берём с запасом в 1 день, чтобы не упустить пограничные изменения.
      const begin = new Date(lastSync - 24 * 60 * 60 * 1000);
      body.begin_modified_on = formatSmartupDate(begin);
      body.end_modified_on = formatSmartupDate(new Date());
      mode = 'incremental';
    }
    // Если синка ещё не было — делаем полную заливку.
  }

  const data = await smartupRequest<{ inventory?: Record<string, unknown>[] }>(
    INVENTORY_EXPORT_ENDPOINT,
    body
  );

  const inventory = data.inventory || [];
  let written = 0;

  // Firestore: батч до 500 операций.
  let batch = db.batch();
  let ops = 0;

  for (const item of inventory) {
    const code = normalizeCode(item.code);
    if (!code) continue;

    const doc: ProductDoc = {
      code,
      name: String(item.name ?? ''),
      short_name: String(item.short_name ?? ''),
      barcodes: buildBarcodes(item),
    };

    batch.set(db.collection(PRODUCTS_COLLECTION).doc(code), doc, { merge: true });
    ops += 1;
    written += 1;

    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) {
    await batch.commit();
  }

  await metaRef.set({ last_sync_ms: Date.now() }, { merge: true });

  return { fetched: inventory.length, written, mode };
}
