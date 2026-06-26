import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = request.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  return request.nextUrl.searchParams.get('secret') === secret;
}

interface DailyRow { s: string; p: string; o: number; r: number; d: number }
const COLLECTION = 'shop_sales_daily';

// Разовый бэкфилл истории продаж из выгрузок «Архив заказов» (XML), которые Smartup
// не отдаёт через API глубже ~16 дней. Тело запроса — уже агрегированные по дням
// данные (парсинг XML и группировку делает локальный скрипт, см.
// scripts/import-order-archive.mjs), сюда приходит готовый { days: { "YYYY-MM-DD":
// DailyRow[] } }. Каждый день ПЕРЕЗАПИСЫВАЕТСЯ целиком (не складывается с тем, что уже
// есть) — так повторный запуск с более полным набором XML идемпотентен.
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: { days?: Record<string, DailyRow[]> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const days = body.days || {};
  const dates = Object.keys(days);
  if (!dates.length) {
    return Response.json({ error: 'Нет данных (days пуст)' }, { status: 400 });
  }

  const db = getDb();
  const out: Record<string, number> = {};
  // Пишем пачками (Firestore batch лимит 500 операций) — на бэкфилл за месяц должно
  // хватить одной-двух пачек.
  for (let i = 0; i < dates.length; i += 400) {
    const batch = db.batch();
    for (const date of dates.slice(i, i + 400)) {
      const rows = days[date];
      batch.set(db.collection(COLLECTION).doc(date), { date, rows, updated_at: new Date().toISOString() });
      out[date] = rows.length;
    }
    await batch.commit();
  }

  return Response.json({ ok: true, days_written: dates.length, rows_by_day: out });
}
