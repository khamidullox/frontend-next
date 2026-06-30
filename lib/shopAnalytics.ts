import { getStockByWarehouseCode, getCachedCatalog } from './products';
import { shopForWarehouseCode, SHOP_LIST } from './shopWarehouseMap';
import { getCachedSnapshot, getCachedListUpdatedMs } from './listCache';
import { getCombinedSales, earliestStoredDate } from './shopSalesHistory';
import { getShopArrivalDates } from './movement';

// Одна строка анализа: товар × магазин за период. Категория (Активно/Пассивно/…) тут
// НЕ хранится — она зависит от настраиваемых порогов и считается на клиенте по turnover,
// чтобы менять пороги без повторного запроса к Smartup.
export interface ShopTurnoverRow {
  shop_code: string;
  product_code: string;
  product_name: string;
  brand: string;
  group: string;
  order_qty: number;
  return_qty: number;
  sold_qty: number;     // продажи
  stock: number;        // текущий доступный остаток
  base: number;         // ЛЁГКАЯ версия базы: остаток + продано (≈ сколько было в обороте)
  turnover: number;     // продажи / база
  arrival_date: string | null; // последняя дата прихода в магазин (внутр. перемещения), YYYY-MM-DD
}

export interface ShopTurnoverSummary {
  code: string;
  name: string;
  products: number;     // позиций с активностью (остаток или продажи)
  sold: number;         // суммарно продано, шт
}

export interface ShopTurnoverData {
  from: string;             // YYYY-MM-DD
  to: string;               // YYYY-MM-DD
  updated_ms: number;
  history_from: string | null; // самая ранняя накопленная дата (раньше — данных нет)
  shops: ShopTurnoverSummary[];
  rows: ShopTurnoverRow[];   // по всем магазинам; API отдаёт только выбранный
}

// Кэшируем плоским массивом строк (товар×магазин), порезанным на чанки — один документ
// Firestore ограничен 1 МБ, а весь датасет по 24 магазинам это несколько МБ, поэтому
// НЕЛЬЗЯ хранить его одним элементом. 400 строк на чанк с запасом влезают в лимит.
const ROW_CHUNK = 400;
// v5 — продажи теперь из накопленной истории (за дни до сегодня) + живой Smartup за
// сегодня; v4 держал только живой ~16-дневный срез order$export.
const CACHE_KEY = (from: string, to: string) => `shop_turnover_v6_${from}_${to}`;

// Диапазон, заканчивающийся сегодня, ещё «живой» (данные за сегодня дополняются) —
// держим кэш недолго. Полностью прошлый диапазон не меняется — кэшируем надолго.
function ttlFor(toISO: string): number {
  const today = new Date().toISOString().slice(0, 10);
  return toISO >= today ? 30 * 60_000 : 6 * 60 * 60_000;
}

interface Acc { name: string; order: number; ret: number; sold: number; stock: number }

// Собирает плоский массив строк по ВСЕМ магазинам — кэшируется в Firestore. Продажи
// берутся из накопленной истории (за дни до сегодня) + живой Smartup за сегодня, так
// что диапазон не ограничен ~16-дневным окном order$export, как только история накопится.
async function buildRows(fromISO: string, toISO: string): Promise<ShopTurnoverRow[]> {
  const [combined, stockByCode, catalog, arrivals] = await Promise.all([
    getCombinedSales(fromISO, toISO),
    getStockByWarehouseCode(),
    getCachedCatalog(),
    getShopArrivalDates().catch(() => new Map<string, string>()),
  ]);
  const catByCode = new Map(catalog.map((c) => [c.code, c]));

  // shop_code → product_code → аккумулятор
  const byShop = new Map<string, Map<string, Acc>>();
  const ensure = (shopCode: string, productCode: string, name: string): Acc => {
    let m = byShop.get(shopCode);
    if (!m) { m = new Map(); byShop.set(shopCode, m); }
    let a = m.get(productCode);
    if (!a) { a = { name, order: 0, ret: 0, sold: 0, stock: 0 }; m.set(productCode, a); }
    return a;
  };

  for (const r of combined.values()) {
    const a = ensure(r.shop_code, r.product_code, r.name || '');
    a.order += r.order;
    a.ret += r.ret;
    a.sold += r.sold;
    if (r.name) a.name = r.name;
  }

  for (const [whCode, products] of stockByCode) {
    const shop = shopForWarehouseCode(whCode);
    if (!shop) continue;
    for (const [productCode, qty] of products) {
      const a = ensure(shop.code, productCode, '');
      a.stock += qty;
    }
  }

  const rows: ShopTurnoverRow[] = [];
  for (const shop of SHOP_LIST) {
    const products = byShop.get(shop.code);
    if (!products) continue;
    for (const [code, a] of products) {
      if (a.sold <= 0 && a.stock <= 0 && a.order <= 0 && a.ret <= 0) continue;
      const cat = catByCode.get(code);
      const base = a.stock + a.sold;
      rows.push({
        shop_code: shop.code,
        product_code: code,
        product_name: a.name || cat?.name || code,
        brand: cat?.producer || '',
        group: cat?.group || '',
        order_qty: a.order,
        return_qty: a.ret,
        sold_qty: a.sold,
        stock: a.stock,
        base,
        turnover: base > 0 ? a.sold / base : 0,
        arrival_date: arrivals.get(`${shop.code}|${code}`) || null,
      });
    }
  }
  return rows;
}

// Анализ за произвольный диапазон дат (YYYY-MM-DD, включительно). Кэшируется по
// (from,to), так что повторные открытия того же диапазона не дёргают Smartup.
export async function getShopTurnover(fromISO: string, toISO: string): Promise<ShopTurnoverData> {
  const key = CACHE_KEY(fromISO, toISO);
  const rows = await getCachedSnapshot<ShopTurnoverRow>(key, () => buildRows(fromISO, toISO), ttlFor(toISO), ROW_CHUNK);
  const updated_ms = (await getCachedListUpdatedMs(key)) ?? Date.now();

  // Сводка по магазинам — из строк, чтобы в списке выбора были все 24 точки (даже с 0
  // активности) с числом позиций и продано штук.
  const agg = new Map<string, { products: number; sold: number }>();
  for (const r of rows) {
    const a = agg.get(r.shop_code) || { products: 0, sold: 0 };
    a.products++;
    a.sold += r.sold_qty;
    agg.set(r.shop_code, a);
  }
  const shops: ShopTurnoverSummary[] = SHOP_LIST.map((s) => ({
    code: s.code, name: s.name,
    products: agg.get(s.code)?.products || 0,
    sold: agg.get(s.code)?.sold || 0,
  }));

  const history_from = await earliestStoredDate().catch(() => null);
  return { from: fromISO, to: toISO, updated_ms, history_from, shops, rows };
}

// ─── Сводная оборачиваемость по всем магазинам (один товар = одна строка) ─────
// Остаток делим на «магазины» (розничные склады из shopWarehouseMap) и «база»
// (всё остальное: центральные склады 001..008/16 и пр.). Продажи — суммарно по
// всем магазинам за период (накопленная история + сегодня живьём).
export interface OverallRow {
  product_code: string; product_name: string; brand: string; group: string;
  sold: number; stock_shops: number; stock_base: number; stock_total: number;
  base: number;      // в обороте = остаток + продано
  turnover: number;  // продажи / база
}

async function buildOverallRows(fromISO: string, toISO: string): Promise<OverallRow[]> {
  const [combined, stockByCode, catalog] = await Promise.all([
    getCombinedSales(fromISO, toISO),
    getStockByWarehouseCode(),
    getCachedCatalog(),
  ]);
  const catByCode = new Map(catalog.map((c) => [c.code, c]));

  interface A { sold: number; shops: number; base: number }
  const acc = new Map<string, A>();
  const ensure = (code: string): A => {
    let a = acc.get(code);
    if (!a) { a = { sold: 0, shops: 0, base: 0 }; acc.set(code, a); }
    return a;
  };

  for (const r of combined.values()) ensure(r.product_code).sold += r.sold;

  for (const [whCode, products] of stockByCode) {
    const isShop = !!shopForWarehouseCode(whCode); // розничный склад магазина?
    for (const [code, qty] of products) {
      const a = ensure(code);
      if (isShop) a.shops += qty; else a.base += qty;
    }
  }

  const rows: OverallRow[] = [];
  for (const [code, a] of acc) {
    const stock_total = a.shops + a.base;
    if (a.sold <= 0 && stock_total <= 0) continue;
    const c = catByCode.get(code);
    const base = stock_total + a.sold;
    rows.push({
      product_code: code,
      product_name: c?.name || code,
      brand: c?.producer || '',
      group: c?.group || '',
      sold: a.sold,
      stock_shops: a.shops,
      stock_base: a.base,
      stock_total,
      base,
      turnover: base > 0 ? a.sold / base : 0,
    });
  }
  return rows;
}

export interface OverallData { from: string; to: string; updated_ms: number; history_from: string | null; rows: OverallRow[] }

export async function getOverallTurnover(fromISO: string, toISO: string): Promise<OverallData> {
  const key = `overall_turnover_v1_${fromISO}_${toISO}`;
  const rows = await getCachedSnapshot<OverallRow>(key, () => buildOverallRows(fromISO, toISO), ttlFor(toISO), ROW_CHUNK);
  const updated_ms = (await getCachedListUpdatedMs(key)) ?? Date.now();
  const history_from = await earliestStoredDate().catch(() => null);
  return { from: fromISO, to: toISO, updated_ms, history_from, rows };
}
