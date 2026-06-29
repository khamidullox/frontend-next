import { getDb } from './firebase';
import { getProductInfos, findProductCodeByBarcode } from './products';

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
    const row: WmsStockRow = {
      id, location: loc, product_code: productCode,
      product_name: productName || cur?.product_name || productCode,
      card_number: card_number !== undefined ? str(card_number) : (cur?.card_number || ''),
      qty, updated_at: new Date().toISOString(), updated_by: str(by),
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
