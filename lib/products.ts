import { getDb } from './firebase';

const PRODUCTS_COLLECTION = 'products';
const META_DOC = 'meta/products_sync';
const INVENTORY_EXPORT_ENDPOINT = '/b/anor/mxsx/mr/inventory$export';
const CATALOG_TTL_MS = 30 * 60 * 1000;

import { smartupRequest } from './smartup';
import { cached } from './cache';
import { getCachedList, getCachedSnapshot, refreshCachedList, getCachedListUpdatedMs } from './listCache';

// Остатки: снимок в Firestore обновляется фоном, если старше 10 минут
// (1 тяжёлый запрос на всех 25 магазинов, а не на каждого).
const STOCK_FRESH_MS = 10 * 60 * 1000;
// Баланс ~24k строк {w,p,q} — пишем крупными кусками, чтобы экономить записи Firestore.
const BALANCE_CHUNK = 8000;
// Справочники (склады, каталог: названия/бренд/вид/цена/новые товары) — каждые 30 минут.
const REF_TTL_MS = 30 * 60 * 1000;

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
  product_id: string; // внутренний ID Smartup (для получения фото через inventory_view:model)
  name: string;
  producer: string;   // бренд (producer_code; названия за стеной прав Smartup)
  group: string;      // продуктовая группа (первый group_code, без префикса PRDGR:)
  barcodes: string[];
  price: number;      // оптовая цена продажи
  weight: number;     // вес единицы (брутто/нетто), кг — для логистики
  volume_l: number;   // объём (литраж), л — для логистики
}

const PRODUCT_GROUP_EXPORT_ENDPOINT = '/b/anor/mxsx/mr/product_group$export';

// Справочник групп: product_type_id → название.
// Бренд товара — тип группы PRDGR:5 (торговая марка), вид — PRDGR:3.
async function fetchTypeNameMap(): Promise<Map<string, string>> {
  const data = await smartupRequest<{
    product_group?: { code?: string; product_group_types?: { product_type_id?: string; name?: string }[] }[];
  }>(PRODUCT_GROUP_EXPORT_ENDPOINT, {});
  const map = new Map<string, string>();
  for (const g of data.product_group || []) {
    for (const t of g.product_group_types || []) {
      if (t.product_type_id) map.set(String(t.product_type_id), String(t.name ?? ''));
    }
  }
  return map;
}

// Название по коду группы (PRDGR:5 — бренд, PRDGR:3 — вид) для конкретного товара.
function groupTypeName(
  inv: Record<string, unknown>,
  groupCode: string,
  typeName: Map<string, string>
): string {
  const groups = inv.groups;
  if (!Array.isArray(groups)) return '';
  const entry = groups.find(
    (x) => (x as Record<string, unknown>).group_code === groupCode
  ) as Record<string, unknown> | undefined;
  if (!entry) return '';
  return typeName.get(String(entry.type_id ?? '')) || '';
}

// Каталог товаров из Smartup (inventory$export + product_group$export), кэш 30 мин.
// Только активные (state=A). Бренд и вид — настоящими названиями.
export async function getProductCatalog(): Promise<CatalogItem[]> {
  return cached('product:catalog', CATALOG_TTL_MS, async () => {
    const [data, typeName, priceMap] = await Promise.all([
      smartupRequest<{ inventory?: Record<string, unknown>[] }>(INVENTORY_EXPORT_ENDPOINT, {}),
      fetchTypeNameMap(),
      getWholesalePriceMap(),
    ]);
    return (data.inventory || [])
      .filter((i) => normalizeCode(i.state) === 'A')
      .map((i) => {
        const code = normalizeCode(i.code);
        return {
          code,
          product_id: normalizeCode(i.product_id) || code,
          name: String(i.name ?? ''),
          producer: groupTypeName(i, 'PRDGR:5', typeName), // бренд / торговая марка
          group: groupTypeName(i, 'PRDGR:3', typeName),    // вид
          barcodes: buildBarcodes(i),
          price: priceMap.get(code) || 0,
          // Для логистики: вес (брутто, иначе нетто) и объём из Smartup.
          // Поле `litr` в Smartup подписано «Литр/Дециметр куб», но фактически хранит
          // объём в КУБОМЕТРАХ (напр. стиралка = 0.25 = 0.25 м³, а не 0.25 л), поэтому
          // переводим в литры ×1000, как ожидает остальной код (capacity в л, /1000 для м³).
          weight: Number(i.weight_brutto) || Number(i.weight_netto) || 0,
          volume_l: (Number(i.litr) || 0) * 1000,
        };
      })
      .filter((i) => i.code)
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

// Сырые поля товара из Smartup inventory$export (для отладки расхождений объёма/веса).
export async function getRawInventoryFields(code: string): Promise<Record<string, unknown> | null> {
  const data = await smartupRequest<{ inventory?: Record<string, unknown>[] }>(INVENTORY_EXPORT_ENDPOINT, {});
  const item = (data.inventory || []).find((i) => normalizeCode(i.code) === normalizeCode(code));
  if (!item) return null;
  return {
    code: item.code, name: item.name, product_id: item.product_id,
    litr: item.litr, weight_brutto: item.weight_brutto, weight_netto: item.weight_netto,
  };
}

// ─── Остатки товара по складам ───────────────────────────────────────────────

const BALANCE_EXPORT_ENDPOINT = '/b/anor/mxsx/mkw/balance$export';
const WAREHOUSE_EXPORT_ENDPOINT = '/b/anor/mxsx/mkw/warehouse$export';
const PRICE_EXPORT_ENDPOINT = '/b/anor/api/v2/mkf/product_price$export';
// Код типа цены «Оптовая цена Arzonchi (UZS)» (проставлен админом = id).
const WHOLESALE_PRICE_TYPE = '117893';

interface PriceRow { code: string; price: number }

async function fetchWholesalePrices(): Promise<PriceRow[]> {
  const data = await smartupRequest<{
    inventory?: { inventory_code?: string; price_type?: { price_type_code?: string; price?: string | number }[] }[];
  }>(PRICE_EXPORT_ENDPOINT, {});
  const out: PriceRow[] = [];
  for (const it of data.inventory || []) {
    const code = normalizeCode(it.inventory_code);
    if (!code) continue;
    const p = (it.price_type || []).find((x) => String(x.price_type_code) === WHOLESALE_PRICE_TYPE);
    if (p && p.price != null && p.price !== '') out.push({ code, price: Number(p.price) || 0 });
  }
  return out;
}

// Оптовая цена код→сумма, Firestore-кэш на 2 часа (как и остальной «паспорт»).
async function getWholesalePriceMap(): Promise<Map<string, number>> {
  const arr = await getCachedList('prices_v1', fetchWholesalePrices, REF_TTL_MS);
  return new Map(arr.map((x) => [x.code, x.price]));
}

// Основные склады (по настоящему коду склада). Брак/осн.средства имеют другие
// коды (003B, 5505-2…), поэтому сюда не попадают.
const MAIN_WAREHOUSE_CODES = new Set(['001', '002', '003', '005', '006', '008', '7776']);

function todaySmartup(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

interface RawBalance {
  warehouse_id: string;
  product_code: string;
  quantity: string | number;
}

// Облегчённая строка остатка — только нужное, чтобы влезть в Firestore-чанки.
interface SlimBalance {
  w: string; // warehouse_id
  p: string; // product_code
  q: number; // quantity
}

async function fetchSlimBalance(): Promise<SlimBalance[]> {
  const t = todaySmartup();
  // product_conditions: ["F"] — доступный (free) остаток, без брони и транзита.
  const data = await smartupRequest<{ balance?: RawBalance[] }>(BALANCE_EXPORT_ENDPOINT, {
    begin_date: t,
    end_date: t,
    product_conditions: ['F'],
  });
  return (data.balance || []).map((b) => ({
    w: normalizeCode(b.warehouse_id),
    p: normalizeCode(b.product_code),
    q: Number(b.quantity) || 0,
  }));
}

// Снимок ДОСТУПНЫХ остатков в Firestore (chunked). Ключ _free — после перехода
// на доступный остаток (старый кэш хранил общий).
function getCachedBalance(): Promise<SlimBalance[]> {
  return getCachedSnapshot('balance_free', fetchSlimBalance, STOCK_FRESH_MS, BALANCE_CHUNK);
}

interface WhRef {
  id: string;
  name: string;
  code: string;
}

async function fetchWarehouseRef(): Promise<WhRef[]> {
  const data = await smartupRequest<{ warehouse?: Record<string, unknown>[] }>(
    WAREHOUSE_EXPORT_ENDPOINT,
    {}
  );
  return (data.warehouse || []).map((w) => ({
    id: normalizeCode(w.warehouse_id),
    name: String(w.name ?? ''),
    code: normalizeCode(w.code),
  }));
}

// Справочник складов id→название (Firestore-кэш 12ч). v2 — добавили code.
async function getWarehouseMap(): Promise<Map<string, string>> {
  const refs = await getCachedList('warehouse_ref_v2', fetchWarehouseRef, REF_TTL_MS);
  return new Map(refs.map((r) => [r.id, r.name]));
}

// Справочник складов код→название (для «откуда → куда» в накладных).
export async function getWarehouseCodeMap(): Promise<Map<string, string>> {
  const refs = await getCachedList('warehouse_ref_v2', fetchWarehouseRef, REF_TTL_MS);
  const map = new Map<string, string>();
  for (const r of refs) if (r.code) map.set(r.code, r.name);
  return map;
}

// Карта склад_id → настоящий код склада (различает брак/осн.средства: 003 vs 003B).
async function getWarehouseIdCodeMap(): Promise<Map<string, string>> {
  const refs = await getCachedList('warehouse_ref_v2', fetchWarehouseRef, REF_TTL_MS);
  const map = new Map<string, string>();
  for (const r of refs) map.set(r.id, r.code);
  return map;
}

// Каталог из Firestore-кэша (тот же, что у /api/products), без живого Smartup.
// Ключ v3 — после добавления цены продажи в каталог.
export function getCachedCatalog(): Promise<CatalogItem[]> {
  return getCachedList('catalog_v4', getProductCatalog, REF_TTL_MS);
}

// Когда снимок остатков последний раз обновлялся (для подписи «обновлено …»).
export function getStockUpdatedMs(): Promise<number | null> {
  return getCachedListUpdatedMs('balance_free');
}

// Принудительно обновить снимки остатков/складов/каталога в Firestore.
// Вызывается из cron — чтобы первый пользователь после интервала не ждал Smartup.
export async function refreshStockCache(): Promise<{ balance: number; warehouses: number }> {
  const [balance, warehouses] = await Promise.all([
    refreshCachedList('balance_free', fetchSlimBalance, BALANCE_CHUNK),
    refreshCachedList('warehouse_ref_v2', fetchWarehouseRef),
    refreshCachedList('catalog_v4', getProductCatalog),
  ]);
  return { balance, warehouses };
}

export interface StockRow {
  warehouse_name: string;
  quantity: number;
}

export interface ProductStock {
  rows: StockRow[];
  total: number;
  input_price: number;
  wholesale_price: number;
}

// Остатки конкретного товара: на каких складах и сколько.
export async function getProductStock(code: string): Promise<ProductStock> {
  const needle = normalizeCode(code);
  const [balance, whMap, priceMap] = await Promise.all([
    getCachedBalance(),
    getWarehouseMap(),
    getWholesalePriceMap(),
  ]);

  const byWh = new Map<string, number>();
  for (const b of balance) {
    if (b.p !== needle) continue;
    byWh.set(b.w, (byWh.get(b.w) || 0) + b.q);
  }

  // В карточке товара показываем ВСЕ склады (не только основные).
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
    input_price: 0,
    wholesale_price: priceMap.get(needle) ?? 0,
  };
}

// ─── Остатки в разрезе складов (склад → товары) ──────────────────────────────

export interface WarehouseSummary {
  warehouse_id: string;
  warehouse_name: string;
  products_count: number;   // сколько разных товаров
  total_quantity: number;   // суммарно штук
}

// Список складов с агрегатами (для страницы выбора склада).
// allowed — коды складов пользователя; если задан, показываем именно их
// (7 основных + свой). Если пусто — по умолчанию основные склады.
export async function listWarehouseStock(
  allowed?: string[],
  opts?: { all?: boolean; excludeMain?: boolean }
): Promise<WarehouseSummary[]> {
  const [balance, whMap, idCode] = await Promise.all([
    getCachedBalance(),
    getWarehouseMap(),
    getWarehouseIdCodeMap(),
  ]);

  const agg = new Map<string, { products: Set<string>; qty: number }>();
  for (const b of balance) {
    if (!agg.has(b.w)) agg.set(b.w, { products: new Set(), qty: 0 });
    const a = agg.get(b.w)!;
    a.products.add(b.p);
    a.qty += b.q;
  }

  // Фильтр по НАСТОЯЩЕМУ коду склада (различает брак/осн.средства).
  // all — все склады (для менеджера/админа); иначе свои/основные.
  const allow = allowed && allowed.length
    ? new Set(allowed.map((c) => String(c).trim()))
    : new Set(MAIN_WAREHOUSE_CODES);

  return [...agg.entries()]
    .map(([whId, a]) => ({
      warehouse_id: whId,
      warehouse_name: whMap.get(whId) || `склад ${whId}`,
      products_count: a.products.size,
      total_quantity: a.qty,
    }))
    .filter((w) => w.total_quantity !== 0)
    .filter((w) => {
      const code = idCode.get(w.warehouse_id) || '';
      if (opts?.excludeMain && MAIN_WAREHOUSE_CODES.has(code)) return false;
      if (opts?.all) return true;
      return allow.has(code);
    })
    .sort((a, b) => a.warehouse_name.localeCompare(b.warehouse_name, 'ru'));
}

export interface WarehouseProduct {
  product_code: string;
  product_name: string;
  producer: string;   // бренд
  group: string;      // группа
  quantity: number;
  price: number;      // оптовая цена
}

export interface WarehouseStock {
  warehouse_id: string;
  warehouse_name: string;
  rows: WarehouseProduct[];
  total: number;
}

// Все товары конкретного склада с количеством.
export async function getWarehouseStock(warehouseId: string): Promise<WarehouseStock> {
  const needle = normalizeCode(warehouseId);
  const [balance, whMap, catalog, priceMap] = await Promise.all([
    getCachedBalance(),
    getWarehouseMap(),
    getCachedCatalog(),
    getWholesalePriceMap(),
  ]);

  const infoByCode = new Map(catalog.map((c) => [normalizeCode(c.code), c]));

  const byCode = new Map<string, number>();
  for (const b of balance) {
    if (b.w !== needle) continue;
    byCode.set(b.p, (byCode.get(b.p) || 0) + b.q);
  }

  const rows: WarehouseProduct[] = [...byCode.entries()]
    .filter(([, qty]) => qty !== 0)
    .map(([code, qty]) => {
      const info = infoByCode.get(code);
      return {
        product_code: code,
        product_name: info?.name || '',
        producer: info?.producer || '',
        group: info?.group || '',
        quantity: qty,
        price: priceMap.get(code) ?? 0,
      };
    })
    .sort((a, b) => b.quantity - a.quantity);

  return {
    warehouse_id: needle,
    warehouse_name: whMap.get(needle) || `склад ${needle}`,
    rows,
    total: rows.reduce((s, r) => s + r.quantity, 0),
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
