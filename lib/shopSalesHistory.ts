import { getDb } from './firebase';
import { getShopProductSales } from './orders';
import { shopForWarehouseCode } from './shopWarehouseMap';

// Накопление истории продаж по дням в нашей базе — потому что Smartup order$export
// отдаёт только последние ~16 дней (см. memory: smartup-order-export-date-filter).
// Один день = один документ Firestore, компактные ключи s/p/o/r/d, чтобы влезть в
// лимит 1 МБ (несколько тысяч строк (магазин×товар) в день ≈ сотни КБ).
const COLLECTION = 'shop_sales_daily';

interface DailyRow { s: string; p: string; o: number; r: number; d: number } // shop, product, order, return, sold
interface DailyDoc { date: string; rows: DailyRow[]; updated_at: string }

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseISO(s: string): Date {
  const [y, m, dd] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, dd || 1);
}

// Агрегирует продажи за один день по (магазин, товар) и перезаписывает документ дня.
export async function recordDailySales(dateISO: string): Promise<{ rows: number }> {
  const day = parseISO(dateISO);
  const sales = await getShopProductSales(day, day);
  const map = new Map<string, DailyRow>();
  for (const r of sales) {
    const shop = shopForWarehouseCode(r.warehouse_code);
    if (!shop) continue;
    const key = `${shop.code}|${r.product_code}`;
    const cur = map.get(key) || { s: shop.code, p: r.product_code, o: 0, r: 0, d: 0 };
    cur.o += r.order_qty; cur.r += r.return_qty; cur.d += r.sold_qty;
    map.set(key, cur);
  }
  const rows = [...map.values()];
  await getDb().collection(COLLECTION).doc(dateISO).set({ date: dateISO, rows, updated_at: new Date().toISOString() } satisfies DailyDoc);
  return { rows: rows.length };
}

// Записать последние N завершённых дней (день 1 = вчера). Идём по одному дню — узкий
// deal_date даёт маленький ответ Smartup, не упираемся в лимиты. Бэкфилл при старте
// (Smartup ещё отдаёт ~16 дней) — вызвать с n=16.
export async function recordRecentDays(n: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 1; i <= n; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const iso = isoDate(d);
    try { out[iso] = (await recordDailySales(iso)).rows; } catch { out[iso] = -1; }
  }
  return out;
}

export interface CombinedSalesRow { shop_code: string; product_code: string; name?: string; order: number; ret: number; sold: number }

function datesInRange(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const end = parseISO(toISO);
  for (const d = parseISO(fromISO); d <= end; d.setDate(d.getDate() + 1)) out.push(isoDate(d));
  return out;
}

// Продажи за диапазон по (магазин, товар): накопленная история за дни строго до
// сегодня + живой Smartup за сегодня (его ещё нет в истории). Дни диапазона, которых
// в истории пока нет (накопление ещё не дошло), просто отсутствуют.
export async function getCombinedSales(fromISO: string, toISO: string): Promise<Map<string, CombinedSalesRow>> {
  const today = isoDate(new Date());
  const map = new Map<string, CombinedSalesRow>();
  const add = (shop_code: string, product_code: string, o: number, r: number, d: number, name?: string) => {
    const key = `${shop_code}|${product_code}`;
    const cur = map.get(key) || { shop_code, product_code, order: 0, ret: 0, sold: 0, name };
    cur.order += o; cur.ret += r; cur.sold += d;
    if (name && !cur.name) cur.name = name;
    map.set(key, cur);
  };

  const histDates = datesInRange(fromISO, toISO).filter((d) => d < today);
  if (histDates.length) {
    const db = getDb();
    const refs = histDates.map((d) => db.collection(COLLECTION).doc(d));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (!s.exists) continue;
      const doc = s.data() as DailyDoc;
      for (const row of doc.rows || []) add(row.s, row.p, row.o, row.r, row.d);
    }
  }

  if (toISO >= today && fromISO <= today) {
    const now = new Date();
    const sales = await getShopProductSales(now, now);
    for (const r of sales) {
      const shop = shopForWarehouseCode(r.warehouse_code);
      if (!shop) continue;
      add(shop.code, r.product_code, r.order_qty, r.return_qty, r.sold_qty, r.product_name);
    }
  }

  return map;
}

// Какие дни уже накоплены (для подписи «история с …»). Возвращает самую раннюю дату
// с документом, перебирая назад до limit дней.
export async function earliestStoredDate(limitDays = 400): Promise<string | null> {
  const db = getDb();
  const dates: string[] = [];
  for (let i = 1; i <= limitDays; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    dates.push(isoDate(d));
  }
  // Читаем пачками по 300 (лимит getAll щадящий) от старых к новым — первая существующая.
  for (let off = dates.length - 1; off >= 0; off -= 300) {
    const slice = dates.slice(Math.max(0, off - 299), off + 1);
    const snaps = await db.getAll(...slice.map((d) => db.collection(COLLECTION).doc(d)));
    const existing = snaps.filter((s) => s.exists).map((s) => (s.data() as DailyDoc).date).sort();
    if (existing.length) return existing[0];
  }
  return null;
}
