import { getDb } from './firebase';

const PRODUCTS_COLLECTION = 'products';
const META_DOC = 'meta/products_sync';
const INVENTORY_EXPORT_ENDPOINT = '/b/anor/mxsx/mr/inventory$export';
const CATALOG_TTL_MS = 30 * 60 * 1000;

import { smartupRequest } from './smartup';
import { cached } from './cache';

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

// ─── Справочник ТМЦ (для всех, открыто) ──────────────────────────────────────

export interface CatalogItem {
  code: string;
  name: string;
  producer: string;
  barcodes: string[];
}

// Каталог товаров из Smartup (inventory$export), кэш на 30 мин.
// Только активные (state=A). Для страницы «Справочник».
export async function getProductCatalog(): Promise<CatalogItem[]> {
  return cached('product:catalog', CATALOG_TTL_MS, async () => {
    const data = await smartupRequest<{ inventory?: Record<string, unknown>[] }>(
      INVENTORY_EXPORT_ENDPOINT,
      {}
    );
    return (data.inventory || [])
      .filter((i) => normalizeCode(i.state) === 'A')
      .map((i) => ({
        code: normalizeCode(i.code),
        name: String(i.name ?? ''),
        producer: String(i.producer_code ?? ''),
        barcodes: buildBarcodes(i),
      }))
      .filter((i) => i.code)
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

// ─── Остатки товара по складам ───────────────────────────────────────────────

const BALANCE_EXPORT_ENDPOINT = '/b/anor/mxsx/mkw/balance$export';
const WAREHOUSE_EXPORT_ENDPOINT = '/b/anor/mxsx/mkw/warehouse$export';

function todaySmartup(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

// Карта склад_id → название (warehouse$export), кэш на 30 мин.
function getWarehouseMap(): Promise<Map<string, string>> {
  return cached('warehouse:map', CATALOG_TTL_MS, async () => {
    const data = await smartupRequest<{ warehouse?: Record<string, unknown>[] }>(
      WAREHOUSE_EXPORT_ENDPOINT,
      {}
    );
    const map = new Map<string, string>();
    for (const w of data.warehouse || []) {
      map.set(normalizeCode(w.warehouse_id), String(w.name ?? ''));
    }
    return map;
  });
}

interface RawBalance {
  warehouse_id: string;
  product_code: string;
  quantity: string | number;
  input_price?: string | number;
}

// Весь баланс из Smartup (тяжёлый), кэш на 15 мин.
function getAllBalance(): Promise<RawBalance[]> {
  return cached('balance:all', 15 * 60 * 1000, async () => {
    const t = todaySmartup();
    const data = await smartupRequest<{ balance?: RawBalance[] }>(BALANCE_EXPORT_ENDPOINT, {
      begin_date: t,
      end_date: t,
    });
    return data.balance || [];
  });
}

export interface StockRow {
  warehouse_name: string;
  quantity: number;
}

export interface ProductStock {
  rows: StockRow[];
  total: number;
  input_price: number;
}

// Остатки конкретного товара: на каких складах и сколько.
export async function getProductStock(code: string): Promise<ProductStock> {
  const needle = normalizeCode(code);
  const [balance, whMap] = await Promise.all([getAllBalance(), getWarehouseMap()]);

  const byWh = new Map<string, number>();
  let inputPrice = 0;

  for (const b of balance) {
    if (normalizeCode(b.product_code) !== needle) continue;
    const whId = normalizeCode(b.warehouse_id);
    byWh.set(whId, (byWh.get(whId) || 0) + (Number(b.quantity) || 0));
    if (!inputPrice && b.input_price) inputPrice = Number(b.input_price) || 0;
  }

  const rows: StockRow[] = [...byWh.entries()]
    .filter(([, qty]) => qty !== 0)
    .map(([whId, qty]) => ({
      warehouse_name: whMap.get(whId) || `склад ${whId}`,
      quantity: qty,
    }))
    .sort((a, b) => b.quantity - a.quantity);

  return {
    rows,
    total: rows.reduce((s, r) => s + r.quantity, 0),
    input_price: inputPrice,
  };
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
  archived: number;
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
  let archived = 0;

  // Firestore: батч до 500 операций.
  let batch = db.batch();
  let ops = 0;

  const flush = async () => {
    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };

  for (const item of inventory) {
    const code = normalizeCode(item.code);
    if (!code) continue;

    const ref = db.collection(PRODUCTS_COLLECTION).doc(code);

    // Архивные (state !== 'A') в справочник не берём. А если товар перевели
    // в архив — удаляем его из Firestore, чтобы он перестал находиться.
    if (normalizeCode(item.state) !== 'A') {
      batch.delete(ref);
      archived += 1;
      ops += 1;
      await flush();
      continue;
    }

    const doc: ProductDoc = {
      code,
      name: String(item.name ?? ''),
      short_name: String(item.short_name ?? ''),
      barcodes: buildBarcodes(item),
    };

    batch.set(ref, doc, { merge: true });
    ops += 1;
    written += 1;
    await flush();
  }

  if (ops > 0) {
    await batch.commit();
  }

  await metaRef.set({ last_sync_ms: Date.now() }, { merge: true });

  return { fetched: inventory.length, written, archived, mode };
}
