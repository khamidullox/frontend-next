import { getDb } from './firebase';
import { getShopProductSales, getShopProductSalesByDay } from './orders';
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

// Накапливает историю за окно [сегодня−n .. вчера] ОДНИМ широким запросом Smartup:
// раскладываем заказы по их дате (deal_time) и перезаписываем документ каждого дня,
// который реально пришёл в выгрузке. Дни, которых в ответе нет (выпали из ~16-дневного
// окна Smartup), НЕ трогаем — уже накопленная история за них сохраняется. Сегодня не
// пишем (оно всегда берётся живьём в getCombinedSales, иначе двойной счёт).
export async function recordRecentDays(n: number): Promise<Record<string, number>> {
  const today = isoDate(new Date());
  const begin = new Date(); begin.setDate(begin.getDate() - n);
  const end = new Date();
  const dated = await getShopProductSalesByDay(begin, end);

  const byDate = new Map<string, Map<string, DailyRow>>();
  for (const r of dated) {
    if (r.date >= today) continue; // сегодня — живьём, в историю не пишем
    const shop = shopForWarehouseCode(r.warehouse_code);
    if (!shop) continue;
    let m = byDate.get(r.date);
    if (!m) { m = new Map(); byDate.set(r.date, m); }
    const key = `${shop.code}|${r.product_code}`;
    const cur = m.get(key) || { s: shop.code, p: r.product_code, o: 0, r: 0, d: 0 };
    cur.o += r.order_qty; cur.r += r.return_qty; cur.d += r.sold_qty;
    m.set(key, cur);
  }

  const db = getDb();
  const out: Record<string, number> = {};
  for (const [date, m] of byDate) {
    const rows = [...m.values()];
    await db.collection(COLLECTION).doc(date).set({ date, rows, updated_at: new Date().toISOString() } satisfies DailyDoc);
    out[date] = rows.length;
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
