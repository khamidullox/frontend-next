import { getDb } from './firebase';
import { getProductInfos, findProductCodeByBarcode, getStockByWarehouseCode } from './products';

// ─── WMS: адресное хранение для склада 001 (этап 1) ──────────────────────────
// В Smartup нет WMS — ведём свой слой в Firestore. Ячейки (зоны/колонны ангара)
// со штрихкодами + привязка товара к ячейке с количеством. «Номер карточки»
// (из закупа Smartup, неизменяемый там) храним как поле — стартовое значение
// можно потом править у себя. Пока склад зашит как 001 — единственный с WMS.

const LOC = 'wms_locations';
const STOCK = 'wms_stock';
export const WMS_WAREHOUSE = '001';

function str(v: unknown): string { return String(v ?? '').trim(); }
function normCode(s: string): string { return str(s).toUpperCase(); }

export interface WmsLocation {
  code: string;       // адрес ячейки/зоны, он же штрихкод (напр. «A1», «KOL-3», «STENA-2»)
  label: string;      // человекочитаемое название
  zone: string;       // группа (ряд/секция ангара) — для сортировки/печати
  warehouse: string;
  created_at: string;
}

export interface WmsStockRow {
  id: string;          // `${location}__${product_code}`
  location: string;
  product_code: string;
  product_name: string;
  card_number: string; // номер карточки (затравка из закупа, правится у нас)
  qty: number;
  created_at: string;  // когда товар впервые положили в эту ячейку (порядок FIFO при списании)
  updated_at: string;
  updated_by: string;
}

// ─── Ячейки ──────────────────────────────────────────────────────────────────
export async function listLocations(): Promise<WmsLocation[]> {
  const snap = await getDb().collection(LOC).where('warehouse', '==', WMS_WAREHOUSE).get();
  return snap.docs.map((d) => d.data() as WmsLocation)
    .sort((a, b) => (a.zone || '').localeCompare(b.zone || '', 'ru') || a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export async function createLocation(input: { code: string; label?: string; zone?: string }): Promise<{ ok: true } | { error: string }> {
  const code = normCode(input.code);
  if (!code) return { error: 'Код ячейки обязателен' };
  if (!/^[A-Z0-9._-]{1,20}$/.test(code)) return { error: 'Код: латиница/цифры/-_. , до 20 символов' };
  const ref = getDb().collection(LOC).doc(code);
  if ((await ref.get()).exists) return { error: 'Такая ячейка уже есть' };
  const loc: WmsLocation = {
    code, label: str(input.label) || code, zone: str(input.zone),
    warehouse: WMS_WAREHOUSE, created_at: new Date().toISOString(),
  };
  await ref.set(loc);
  return { ok: true };
}

export async function deleteLocation(code: string): Promise<{ ok: true } | { error: string }> {
  const c = normCode(code);
  const snap = await getDb().collection(STOCK).where('location', '==', c).where('qty', '>', 0).limit(1).get();
  if (!snap.empty) return { error: 'В ячейке есть товар — сначала уберите/переместите' };
  await getDb().collection(LOC).doc(c).delete();
  return { ok: true };
}

// ─── Размещение / движение ───────────────────────────────────────────────────
async function ensureLocation(code: string): Promise<boolean> {
  return (await getDb().collection(LOC).doc(normCode(code)).get()).exists;
}

// Разрешает товар по вводу: сначала как штрихкод, иначе как код товара.
async function resolveProduct(input: string): Promise<{ code: string; name: string } | null> {
  const code = await findProductCodeByBarcode(str(input));
  if (!code) return null;
  const infos = await getProductInfos([code]);
  const info = infos.get(code);
  return { code, name: info?.name || info?.short_name || code };
}

// Изменить остаток в ячейке на delta (может быть отрицательным). card_number — опционально.
async function applyDelta(location: string, productCode: string, productName: string, delta: number, by: string, card_number?: string): Promise<number> {
  const db = getDb();
  const loc = normCode(location);
  const id = `${loc}__${productCode}`;
  const ref = db.collection(STOCK).doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? (snap.data() as WmsStockRow) : null;
    const qty = Math.max(0, (cur?.qty || 0) + delta);
    const now = new Date().toISOString();
    const row: WmsStockRow = {
      id, location: loc, product_code: productCode,
      product_name: productName || cur?.product_name || productCode,
      card_number: card_number !== undefined ? str(card_number) : (cur?.card_number || ''),
      qty, created_at: cur?.created_at || now, updated_at: now, updated_by: str(by),
    };
    tx.set(ref, row);
    return qty;
  });
}

// Положить товар в ячейку (скан товара + ячейки + кол-во).
export async function placeStock(input: {
  location: string; product: string; qty: number; card_number?: string; by?: string;
}): Promise<{ ok: true; qty: number; product_code: string; product_name: string } | { error: string }> {
  const qty = Math.floor(Number(input.qty) || 0);
  if (qty <= 0) return { error: 'Количество должно быть больше 0' };
  if (!(await ensureLocation(input.location))) return { error: 'Ячейка не найдена' };
  const p = await resolveProduct(input.product);
  if (!p) return { error: 'Товар не распознан' };
  const newQty = await applyDelta(input.location, p.code, p.name, qty, str(input.by), input.card_number);
  return { ok: true, qty: newQty, product_code: p.code, product_name: p.name };
}

// Установить точный остаток (инвентаризация/коррекция).
export async function setStock(input: {
  location: string; product: string; qty: number; by?: string;
}): Promise<{ ok: true; qty: number } | { error: string }> {
  const qty = Math.max(0, Math.floor(Number(input.qty) || 0));
  if (!(await ensureLocation(input.location))) return { error: 'Ячейка не найдена' };
  const p = await resolveProduct(input.product);
  if (!p) return { error: 'Товар не распознан' };
  const id = `${normCode(input.location)}__${p.code}`;
  const ref = getDb().collection(STOCK).doc(id);
  const cur = (await ref.get()).data() as WmsStockRow | undefined;
  await applyDelta(input.location, p.code, p.name, qty - (cur?.qty || 0), str(input.by));
  return { ok: true, qty };
}

// Переместить между ячейками.
export async function moveStock(input: {
  from: string; to: string; product: string; qty: number; by?: string;
}): Promise<{ ok: true } | { error: string }> {
  const qty = Math.floor(Number(input.qty) || 0);
  if (qty <= 0) return { error: 'Количество должно быть больше 0' };
  if (!(await ensureLocation(input.to))) return { error: 'Ячейка-получатель не найдена' };
  const p = await resolveProduct(input.product);
  if (!p) return { error: 'Товар не распознан' };
  const fromId = `${normCode(input.from)}__${p.code}`;
  const have = ((await getDb().collection(STOCK).doc(fromId).get()).data() as WmsStockRow | undefined)?.qty || 0;
  if (have < qty) return { error: `В ячейке ${normCode(input.from)} только ${have} шт` };
  await applyDelta(input.from, p.code, p.name, -qty, str(input.by));
  await applyDelta(input.to, p.code, p.name, qty, str(input.by));
  return { ok: true };
}

// ─── Поиск ───────────────────────────────────────────────────────────────────
// Где лежит товар (по штрихкоду или коду) — список ячеек с количеством.
export async function findByProduct(productInput: string): Promise<{ product_code: string; product_name: string; rows: WmsStockRow[] } | { error: string }> {
  const p = await resolveProduct(productInput);
  if (!p) return { error: 'Товар не распознан' };
  const snap = await getDb().collection(STOCK).where('product_code', '==', p.code).get();
  const rows = snap.docs.map((d) => d.data() as WmsStockRow).filter((r) => r.qty > 0)
    .sort((a, b) => b.qty - a.qty);
  return { product_code: p.code, product_name: p.name, rows };
}

// Что лежит в ячейке.
export async function listByLocation(location: string): Promise<WmsStockRow[]> {
  const snap = await getDb().collection(STOCK).where('location', '==', normCode(location)).get();
  return snap.docs.map((d) => d.data() as WmsStockRow).filter((r) => r.qty > 0)
    .sort((a, b) => a.product_name.localeCompare(b.product_name, 'ru'));
}

// ─── Сверка с остатком Smartup (склад 001) ───────────────────────────────────
// Остаток 001 из Smartup — источник истины. Ячейки распределяют его. Сверка
// приводит сумму по ячейкам каждого РАЗМЕЩЁННОГО товара к остатку Smartup:
//  • стало больше (приход того же товара) → добавляем в самую раннюю ячейку;
//  • стало меньше (уход/продажа) → списываем по очереди (FIFO, с самой ранней).
// Товары без единой ячейки сюда не трогаем — они попадают в «Нужно разместить».

async function getWh001Stock(): Promise<Map<string, number>> {
  const all = await getStockByWarehouseCode();
  return all.get(WMS_WAREHOUSE) || new Map<string, number>();
}

async function loadPlacementsByProduct(): Promise<Map<string, WmsStockRow[]>> {
  const snap = await getDb().collection(STOCK).get();
  const m = new Map<string, WmsStockRow[]>();
  for (const d of snap.docs) {
    const r = d.data() as WmsStockRow;
    const arr = m.get(r.product_code) || [];
    arr.push(r);
    m.set(r.product_code, arr);
  }
  // Порядок FIFO — по created_at (ранние первыми).
  for (const arr of m.values()) arr.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  return m;
}

// Привести ячейки к остатку Smartup. Возвращает число изменённых товаров.
export async function reconcileFromStock(by = 'sync'): Promise<{ adjusted: number }> {
  const [stock, byProduct] = await Promise.all([getWh001Stock(), loadPlacementsByProduct()]);
  const db = getDb();
  const now = new Date().toISOString();
  let batch = db.batch();
  let ops = 0, adjusted = 0;

  for (const [product, rows] of byProduct) {
    const total = stock.get(product) || 0;
    const placed = rows.reduce((s, r) => s + r.qty, 0);
    let delta = total - placed;
    if (delta === 0) continue;
    adjusted++;

    if (delta > 0) {
      // приход того же товара — в самую раннюю ячейку
      const r = rows[0];
      batch.update(db.collection(STOCK).doc(r.id), { qty: r.qty + delta, updated_at: now, updated_by: by });
      ops++;
    } else {
      // уход — FIFO с самой ранней ячейки
      let need = -delta;
      for (const r of rows) {
        if (need <= 0) break;
        const take = Math.min(r.qty, need);
        if (take <= 0) continue;
        batch.update(db.collection(STOCK).doc(r.id), { qty: r.qty - take, updated_at: now, updated_by: by });
        ops++;
        need -= take;
      }
    }
    if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops > 0) await batch.commit();
  return { adjusted };
}

export interface WmsPlacedProduct {
  product_code: string; product_name: string;
  total: number; placed: number; // total = Smartup 001, placed = сумма ячеек (после сверки = total)
  cells: { location: string; qty: number; card_number: string }[];
}
export interface WmsUnplaced { product_code: string; product_name: string; qty: number }

// Полный обзор: сначала сверка, потом раскладка по товарам + список «нужно разместить».
export async function getOverview(): Promise<{ placed: WmsPlacedProduct[]; unplaced: WmsUnplaced[]; total_unplaced_qty: number }> {
  await reconcileFromStock().catch(() => {});
  const [stock, byProduct] = await Promise.all([getWh001Stock(), loadPlacementsByProduct()]);

  const placed: WmsPlacedProduct[] = [];
  for (const [product, rows] of byProduct) {
    const live = rows.filter((r) => r.qty > 0);
    if (!live.length) continue;
    placed.push({
      product_code: product,
      product_name: rows[0].product_name || product,
      total: stock.get(product) || 0,
      placed: live.reduce((s, r) => s + r.qty, 0),
      cells: live.map((r) => ({ location: r.location, qty: r.qty, card_number: r.card_number })),
    });
  }
  placed.sort((a, b) => a.product_name.localeCompare(b.product_name, 'ru'));

  // Нужно разместить: есть остаток в 001, но НЕТ ни одной ячейки (новый товар).
  const unplacedCodes = [...stock.entries()].filter(([code, q]) => q > 0 && !byProduct.has(code)).map(([code]) => code);
  const infos = await getProductInfos(unplacedCodes);
  const unplaced: WmsUnplaced[] = unplacedCodes.map((code) => ({
    product_code: code,
    product_name: infos.get(code)?.name || infos.get(code)?.short_name || code,
    qty: stock.get(code) || 0,
  })).sort((a, b) => b.qty - a.qty);

  return { placed, unplaced, total_unplaced_qty: unplaced.reduce((s, u) => s + u.qty, 0) };
}
