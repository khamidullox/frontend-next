import { getShopProductSales } from './orders';
import { getStockByWarehouseCode, getCachedCatalog } from './products';
import { shopForWarehouseCode, SHOP_LIST } from './shopWarehouseMap';
import { getCachedSnapshot, getCachedListUpdatedMs } from './listCache';
import { Period } from './analytics';

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
}

export interface ShopTurnoverSummary {
  code: string;
  name: string;
  products: number;     // позиций с активностью (остаток или продажи)
  sold: number;         // суммарно продано, шт
}

export interface ShopTurnoverData {
  period: Period;
  updated_ms: number;
  shops: ShopTurnoverSummary[];
  rows: ShopTurnoverRow[];   // по всем магазинам; API отдаёт только выбранный
}

const PERIOD_DAYS_BACK: Record<Period, number> = { today: 0, '7d': 6, '15d': 14, '30d': 29 };
const PERIOD_TTL_MS: Record<Period, number> = {
  today: 15 * 60_000, '7d': 30 * 60_000, '15d': 60 * 60_000, '30d': 2 * 60 * 60_000,
};
// Кэшируем плоским массивом строк (товар×магазин), порезанным на чанки — один документ
// Firestore ограничен 1 МБ, а весь датасет по 24 магазинам это несколько МБ, поэтому
// НЕЛЬЗЯ хранить его одним элементом. 400 строк на чанк с запасом влезают в лимит.
const ROW_CHUNK = 400;
const CACHE_KEY = (period: Period) => `shop_turnover_v2_${period}`;

function periodRange(period: Period): { begin: Date; end: Date } {
  const end = new Date();
  const begin = new Date(end);
  begin.setDate(begin.getDate() - PERIOD_DAYS_BACK[period]);
  return { begin, end };
}

interface Acc { name: string; order: number; ret: number; sold: number; stock: number }

// Собирает плоский массив строк по ВСЕМ магазинам (тяжёлый запрос к Smartup) —
// кэшируется в Firestore, поэтому order$export выполняется один раз на период.
async function buildRows(period: Period): Promise<ShopTurnoverRow[]> {
  const { begin, end } = periodRange(period);
  const [sales, stockByCode, catalog] = await Promise.all([
    getShopProductSales(begin, end),
    getStockByWarehouseCode(),
    getCachedCatalog(),
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

  for (const r of sales) {
    const shop = shopForWarehouseCode(r.warehouse_code);
    if (!shop) continue;
    const a = ensure(shop.code, r.product_code, r.product_name);
    a.order += r.order_qty;
    a.ret += r.return_qty;
    a.sold += r.sold_qty;
    if (r.product_name) a.name = r.product_name;
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
      });
    }
  }
  return rows;
}

export async function getShopTurnover(period: Period): Promise<ShopTurnoverData> {
  const key = CACHE_KEY(period);
  const rows = await getCachedSnapshot<ShopTurnoverRow>(key, () => buildRows(period), PERIOD_TTL_MS[period], ROW_CHUNK);
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

  return { period, updated_ms, shops, rows };
}
