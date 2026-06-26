import { NextRequest } from 'next/server';
import { earliestStoredDate } from '@/lib/shopSalesHistory';
import { getDb } from '@/lib/firebase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.nextUrl.searchParams.get('secret') === secret;
}

// Разовая проверка: с какой даты в нашей базе реально есть накопленная история
// продаж — без нужды логиниться сессией (используем CRON_SECRET). ?cleanup=1 удаляет
// дни с пустыми rows (заглушки от первого неудачного бэкфилла, до фикса на широкий
// запрос) — они мешают earliestStoredDate показывать правду.
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const deleted: string[] = [];
  if (request.nextUrl.searchParams.get('cleanup') === '1') {
    const db = getDb();
    const snap = await db.collection('shop_sales_daily').get();
    const batch = db.batch();
    for (const doc of snap.docs) {
      const rows = (doc.data().rows || []) as unknown[];
      if (rows.length === 0) { batch.delete(doc.ref); deleted.push(doc.id); }
    }
    if (deleted.length) await batch.commit();
  }
  const earliest = await earliestStoredDate();
  return Response.json({ earliest_stored_date: earliest, deleted_empty_days: deleted });
}
