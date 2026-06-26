import { getSalesAggregate } from './orders';
import { getCachedCatalog, getTotalStockByProduct } from './products';
import { getCachedList } from './listCache';

export type Period = 'today' | '7d' | '15d' | '30d';

export const PERIOD_LABEL: Record<Period, string> = {
  today: 'Сегодня', '7d': '7 дней', '15d': '15 дней', '30d': '30 дней',
};

const PERIOD_DAYS_BACK: Record<Period, number> = { today: 0, '7d': 6, '15d': 14, '30d': 29 };
// Чем длиннее период, тем тяжелее запрос к Smartup (order$export — по комментарию в
// lib/orders.ts, ~12 МБ за 7 дней) — поэтому держим результат в Firestore дольше для
// длинных периодов, чтобы не пересчитывать его при каждом заходе на страницу.
const PERIOD_TTL_MS: Record<Period, number> = {
  today: 15 * 60_000, '7d': 30 * 60_000, '15d': 60 * 60_000, '30d': 2 * 60 * 60_000,
};

function periodRange(period: Period): { begin: Date; end: Date } {
  const end = new Date();
  const begin = new Date(end);
  begin.setDate(begin.getDate() - PERIOD_DAYS_BACK[period]);
  return { begin, end };
}

export interface AnalyticsSummary {
  period: Period;
  updated_ms: number;
  total_qty: number;
  total_orders: number;
  by_shop: { shop: string; qty: number; orders: number; products: number }[];
  // По торговым маркам (бренд из карточки товара, Smartup PRDGR:5) — товары без
  // указанного бренда попадают в «Без бренда».
  by_brand: { brand: string; qty: number; orders: number; products: number }[];
  // Топ продаж — с текущим остатком рядом, чтобы видно «продаётся, но скоро кончится».
  top_products: { code: string; name: string; qty: number; orders: number; stock: number }[];
  // Есть остаток, но за период не продано ни штуки — залежавшийся товар. Список обрезан
  // до 100 (самых «тяжёлых» по остатку), slow_products_total — настоящее общее число.
  slow_products: { code: string; name: string; group: string; stock: number }[];
  slow_products_total: number;
}

// Сводка по продажам за период — кэш в Firestore (как каталог/остатки), не дёргает
// Smartup на каждый заход на страницу. getCachedList ожидает массив — оборачиваем
// сводку в массив из одного элемента, это просто чтобы не писать отдельный кэш-хелпер.
export async function getAnalyticsSummary(period: Period): Promise<AnalyticsSummary> {
  const [wrapped] = await getCachedList<AnalyticsSummary>(
    `analytics_${period}`,
    async () => {
      const { begin, end } = periodRange(period);
      const [stock, catalog] = await Promise.all([
        getTotalStockByProduct(),
        getCachedCatalog(),
      ]);
      const brandByCode = new Map(catalog.map((c) => [c.code, c.producer || 'Без бренда']));
      const sales = await getSalesAggregate(begin, end, brandByCode);

      const soldCodes = new Set(sales.by_product.map((p) => p.code));

      const top_products = sales.by_product.slice(0, 50).map((p) => ({
        ...p,
        stock: stock.get(p.code) || 0,
      }));

      const slowAll = catalog
        .filter((c) => !soldCodes.has(c.code) && (stock.get(c.code) || 0) > 0)
        .map((c) => ({ code: c.code, name: c.name, group: c.group, stock: stock.get(c.code) || 0 }))
        .sort((a, b) => b.stock - a.stock);

      const summary: AnalyticsSummary = {
        period,
        updated_ms: Date.now(),
        total_qty: sales.total_qty,
        total_orders: sales.total_orders,
        by_shop: sales.by_shop,
        by_brand: sales.by_brand,
        top_products,
        slow_products: slowAll.slice(0, 100),
        slow_products_total: slowAll.length,
      };
      return [summary];
    },
    PERIOD_TTL_MS[period]
  );
  return wrapped;
}
