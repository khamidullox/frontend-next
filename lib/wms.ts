import { getDb } from './firebase';
import { getProductInfos, findProductCodeByBarcode, getStockByWarehouseCode } from './products';

// ─── WMS: адресное хранение, выбор склада ────────────────────────────────────
// В Smartup нет WMS — ведём свой слой в Firestore. Работает по ВЫБРАННОМУ складу
// (раньше был зашит 001). Остаток склада из Smartup — источник истины, ячейки его
// распределяют; приход/уход сверяется (приход → в раннюю ячейку, уход → FIFO).
// Данные разделены по складу: id ячейки = `${wh}__${code}`, id остатка =
// `${wh}__${location}__${product}` + поле warehouse для выборок.

const LOC = 'wms_locations';
const STOCK = 'wms_stock';

// Склады, доступные для WMS (сейчас — базы). Можно расширить.
export const WMS_WAREHOUSES = ['001', '002', '003', '004', '005', '006', '007', '008', '16'];

function str(v: unknown): string { return String(v ?? '').trim(); }
function normCode(s: string): string { return str(s).toUpperCase(); }
function normWh(s: string): string { const w = str(s); return WMS_WAREHOUSES.includes(w) ? w : '001'; }

export interface WmsLocation {
  code: string; label: string; zone: string; warehouse: string; created_at: string;
}
export interface WmsStockRow {
  id: string; warehouse: string; location: string; product_code: string; product_name: string;
  card_number: string; qty: number; created_at: string; updated_at: string; updated_by: string;
}

// ─── Ячейки ──────────────────────────────────────────────────────────────────
export async function listLocations(warehouse: string): Promise<WmsLocation[]> {
  const wh = normWh(warehouse);
  const snap = await getDb().collection(LOC).where('warehouse', '==', wh).get();
  return snap.docs.map((d) => d.data() as WmsLocation)
    .sort((a, b) => (a.zone || '').localeCompare(b.zone || '', 'ru') || a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export async function createLocation(warehouse: string, input: { code: string; label?: string; zone?: string }): Promise<{ ok: true } | { error: string }> {
  const wh = normWh(warehouse);
  const code = normCode(input.code);
  if (!code) return { error: 'Код ячейки обязателен' };
  if (!/^[A-Z0-9._-]{1,20}$/.test(code)) return { error: 'Код: латиница/цифры/-_. , до 20 символов' };
  const ref = getDb().collection(LOC).doc(`${wh}__${code}`);
  if ((await ref.get()).exists) return { error: 'Такая ячейка уже есть на этом складе' };
  await ref.set({ code, label: str(input.label) || code, zone: str(input.zone), warehouse: wh, created_at: new Date().toISOString() } satisfies WmsLocation);
  return { ok: true };
}

export async function deleteLocation(warehouse: string, code: string): Promise<{ ok: true } | { error: string }> {
  const wh = normWh(warehouse);
  const c = normCode(code);
  const snap = await getDb().collection(STOCK).where('warehouse', '==', wh).where('location', '==', c).where('qty', '>', 0).limit(1).get();
  if (!snap.empty) return { error: 'В ячейке есть товар — сначала уберите/переместите' };
  await getDb().collection(LOC).doc(`${wh}__${c}`).delete();
  return { ok: true };
}

// ─── Размещение / движение ───────────────────────────────────────────────────
async function ensureLocation(wh: string, code: string): Promise<boolean> {
  return (await getDb().collection(LOC).doc(`${wh}__${normCode(code)}`).get()).exists;
}

async function resolveProduct(input: string): Promise<{ code: string; name: string } | null> {
  const code = await findProductCodeByBarcode(str(input));
  if (!code) return null;
  const infos = await getProductInfos([code]);
  const info = infos.get(code);
  return { code, name: info?.name || info?.short_name || code };
}

async function applyDelta(wh: string, location: string, productCode: string, productName: string, delta: number, by: string, card_number?: string): Promise<number> {
  const db = getDb();
  const loc = normCode(location);
  const id = `${wh}__${loc}__${productCode}`;
  const ref = db.collection(STOCK).doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? (snap.data() as WmsStockRow) : null;
    const qty = Math.max(0, (cur?.qty || 0) + delta);
    const now = new Date().toISOString();
    const row: WmsStockRow = {
      id, warehouse: wh, location: loc, product_code: productCode,
      product_name: productName || cur?.product_name || productCode,
      card_number: card_number !== undefined ? str(card_number) : (cur?.card_number || ''),
      qty, created_at: cur?.created_at || now, updated_at: now, updated_by: str(by),
    };
    tx.set(ref, row);
    return qty;
  });
}

export async function placeStock(input: {
  warehouse: string; location: string; product: string; qty: number; card_number?: string; by?: string;
}): Promise<{ ok: true; qty: number; product_code: string; product_name: string } | { error: string }> {
  const wh = normWh(input.warehouse);
  const qty = Math.floor(Number(input.qty) || 0);
  if (qty <= 0) return { error: 'Количество должно быть больше 0' };
  if (!(await ensureLocation(wh, input.location))) return { error: 'Ячейка не найдена' };
  const p = await resolveProduct(input.product);
  if (!p) return { error: 'Товар не распознан' };
  const newQty = await applyDelta(wh, input.location, p.code, p.name, qty, str(input.by), input.card_number);
  return { ok: true, qty: newQty, product_code: p.code, product_name: p.name };
}

export async function setStock(input: {
  warehouse: string; location: string; product: string; qty: number; by?: string;
}): Promise<{ ok: true; qty: number } | { error: string }> {
  const wh = normWh(input.warehouse);
  const qty = Math.max(0, Math.floor(Number(input.qty) || 0));
  if (!(await ensureLocation(wh, input.location))) return { error: 'Ячейка не найдена' };
  const p = await resolveProduct(input.product);
  if (!p) return { error: 'Товар не распознан' };
  const id = `${wh}__${normCode(input.location)}__${p.code}`;
  const cur = (await getDb().collection(STOCK).doc(id).get()).data() as WmsStockRow | undefined;
  await applyDelta(wh, input.location, p.code, p.name, qty - (cur?.qty || 0), str(input.by));
  return { ok: true, qty };
}

export async function moveStock(input: {
  warehouse: string; from: string; to: string; product: string; qty: number; by?: string;
}): Promise<{ ok: true } | { error: string }> {
  const wh = normWh(input.warehouse);
  const qty = Math.floor(Number(input.qty) || 0);
  if (qty <= 0) return { error: 'Количество должно быть больше 0' };
  if (!(await ensureLocation(wh, input.to))) return { error: 'Ячейка-получатель не найдена' };
  const p = await resolveProduct(input.product);
  if (!p) return { error: 'Товар не распознан' };
  const fromId = `${wh}__${normCode(input.from)}__${p.code}`;
  const have = ((await getDb().collection(STOCK).doc(fromId).get()).data() as WmsStockRow | undefined)?.qty || 0;
  if (have < qty) return { error: `В ячейке ${normCode(input.from)} только ${have} шт` };
  await applyDelta(wh, input.from, p.code, p.name, -qty, str(input.by));
  await applyDelta(wh, input.to, p.code, p.name, qty, str(input.by));
  return { ok: true };
}

// ─── Поиск ───────────────────────────────────────────────────────────────────
export async function findByProduct(warehouse: string, productInput: string): Promise<{ product_code: string; product_name: string; rows: WmsStockRow[] } | { error: string }> {
  const wh = normWh(warehouse);
  const p = await resolveProduct(productInput);
  if (!p) return { error: 'Товар не распознан' };
  const snap = await getDb().collection(STOCK).where('warehouse', '==', wh).where('product_code', '==', p.code).get();
  const rows = snap.docs.map((d) => d.data() as WmsStockRow).filter((r) => r.qty > 0).sort((a, b) => b.qty - a.qty);
  return { product_code: p.code, product_name: p.name, rows };
}

export async function listByLocation(warehouse: string, location: string): Promise<WmsStockRow[]> {
  const wh = normWh(warehouse);
  const snap = await getDb().collection(STOCK).where('warehouse', '==', wh).where('location', '==', normCode(location)).get();
  return snap.docs.map((d) => d.data() as WmsStockRow).filter((r) => r.qty > 0).sort((a, b) => a.product_name.localeCompare(b.product_name, 'ru'));
}

// ─── Сверка с остатком Smartup ───────────────────────────────────────────────
async function getWhStock(wh: string): Promise<Map<string, number>> {
  const all = await getStockByWarehouseCode();
  return all.get(wh) || new Map<string, number>();
}

async function loadPlacementsByProduct(wh: string): Promise<Map<string, WmsStockRow[]>> {
  const snap = await getDb().collection(STOCK).where('warehouse', '==', wh).get();
  const m = new Map<string, WmsStockRow[]>();
  for (const d of snap.docs) {
    const r = d.data() as WmsStockRow;
    const arr = m.get(r.product_code) || [];
    arr.push(r);
    m.set(r.product_code, arr);
  }
  for (const arr of m.values()) arr.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  return m;
}

export async function reconcileFromStock(warehouse: string, by = 'sync'): Promise<{ adjusted: number }> {
  const wh = normWh(warehouse);
  const [stock, byProduct] = await Promise.all([getWhStock(wh), loadPlacementsByProduct(wh)]);
  const db = getDb();
  const now = new Date().toISOString();
  let batch = db.batch();
  let ops = 0, adjusted = 0;
  for (const [product, rows] of byProduct) {
    const total = stock.get(product) || 0;
    const placed = rows.reduce((s, r) => s + r.qty, 0);
    const delta = total - placed;
    if (delta === 0) continue;
    adjusted++;
    if (delta > 0) {
      const r = rows[0];
      batch.update(db.collection(STOCK).doc(r.id), { qty: r.qty + delta, updated_at: now, updated_by: by });
      ops++;
    } else {
      let need = -delta;
      for (const r of rows) {
        if (need <= 0) break;
        const take = Math.min(r.qty, need);
        if (take <= 0) continue;
        batch.update(db.collection(STOCK).doc(r.id), { qty: r.qty - take, updated_at: now, updated_by: by });
        ops++; need -= take;
      }
    }
    if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops > 0) await batch.commit();
  return { adjusted };
}

export interface WmsPlacedProduct {
  product_code: string; product_name: string; total: number; placed: number;
  cells: { location: string; qty: number; card_number: string }[];
}
export interface WmsUnplaced { product_code: string; product_name: string; qty: number }

export async function getOverview(warehouse: string): Promise<{ warehouse: string; placed: WmsPlacedProduct[]; unplaced: WmsUnplaced[]; total_unplaced_qty: number }> {
  const wh = normWh(warehouse);
  await reconcileFromStock(wh).catch(() => {});
  const [stock, byProduct] = await Promise.all([getWhStock(wh), loadPlacementsByProduct(wh)]);

  const placed: WmsPlacedProduct[] = [];
  for (const [product, rows] of byProduct) {
    const live = rows.filter((r) => r.qty > 0);
    if (!live.length) continue;
    placed.push({
      product_code: product, product_name: rows[0].product_name || product,
      total: stock.get(product) || 0, placed: live.reduce((s, r) => s + r.qty, 0),
      cells: live.map((r) => ({ location: r.location, qty: r.qty, card_number: r.card_number })),
    });
  }
  placed.sort((a, b) => a.product_name.localeCompare(b.product_name, 'ru'));

  const unplacedCodes = [...stock.entries()].filter(([code, q]) => q > 0 && !byProduct.has(code)).map(([code]) => code);
  const infos = await getProductInfos(unplacedCodes);
  const unplaced: WmsUnplaced[] = unplacedCodes.map((code) => ({
    product_code: code, product_name: infos.get(code)?.name || infos.get(code)?.short_name || code, qty: stock.get(code) || 0,
  })).sort((a, b) => b.qty - a.qty);

  return { warehouse: wh, placed, unplaced, total_unplaced_qty: unplaced.reduce((s, u) => s + u.qty, 0) };
}
