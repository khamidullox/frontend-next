import { getShopProductSales } from './orders';
import { getStockByWarehouseCode, getCachedCatalog } from './products';
import { shopForWarehouseCode, SHOP_LIST } from './shopWarehouseMap';
import { getCachedList } from './listCache';
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

function periodRange(period: Period): { begin: Date; end: Date } {
  const end = new Date();
  const begin = new Date(end);
  begin.setDate(begin.getDate() - PERIOD_DAYS_BACK[period]);
  return { begin, end };
}

interface Acc { name: string; order: number; ret: number; sold: number; stock: number }

export async function getShopTurnover(period: Period): Promise<ShopTurnoverData> {
  const [wrapped] = await getCachedList<ShopTurnoverData>(
    `shop_turnover_${period}`,
    async () => {
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
      const summaries: ShopTurnoverSummary[] = [];
      for (const shop of SHOP_LIST) {
        const products = byShop.get(shop.code);
        let count = 0;
        let sold = 0;
        if (products) {
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
            count++;
            sold += a.sold;
          }
        }
        summaries.push({ code: shop.code, name: shop.name, products: count, sold });
      }

      return [{ period, updated_ms: Date.now(), shops: summaries, rows }];
    },
    PERIOD_TTL_MS[period],
  );
  return wrapped;
}
