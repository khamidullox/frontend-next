import { NextRequest } from 'next/server';
import { getDb } from '@/lib/firebase';
import { getOrderDocument } from '@/lib/orders';
import { getWarehouseCodeMap } from '@/lib/products';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.nextUrl.searchParams.get('secret') === secret;
}

// Одноразовая миграция: заполняет from_name у order-доставок где он null.
// Параметры:
//   ?secret=...   авторизация
//   ?limit=N      макс. доставок за один запуск (по умолчанию 50)
//   ?dry=1        только считает, не обновляет
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = request.nextUrl;
  const limit = Math.min(Number(url.searchParams.get('limit') || '50'), 200);
  const dry = url.searchParams.get('dry') === '1';

  const db = getDb();

  // Ищем order-доставки без from_name
  const snap = await db.collection('deliveries')
    .where('doc_type', '==', 'order')
    .where('from_name', '==', null)
    .limit(limit)
    .get();

  if (snap.empty) {
    return Response.json({ updated: 0, message: 'Нет доставок для обновления' });
  }

  const whMap = await getWarehouseCodeMap();
  const results: { id: string; doc_id: string; from_name: string | null; to_name?: string | null; ok: boolean }[] = [];

  for (const docSnap of snap.docs) {
    const d = docSnap.data();
    const dealId = d.doc_id as string | null;
    if (!dealId) {
      results.push({ id: docSnap.id, doc_id: '', from_name: null, ok: false });
      continue;
    }

    try {
      const order = await getOrderDocument(dealId);
      const fromCode = order?.from_warehouse_code ?? null;
      const fromName = fromCode ? (whMap.get(fromCode) || fromCode) : null;

      if (!fromName) {
        results.push({ id: docSnap.id, doc_id: dealId, from_name: null, ok: false });
        continue;
      }

      // Точка назначения заказа — клиент (person), а не рабочая зона (room_name/505).
      const clientName = (d.client_name as string) || null;
      const patch: Record<string, unknown> = { from_name: fromName };
      if (clientName && d.to_name !== clientName) patch.to_name = clientName;

      if (!dry) {
        await docSnap.ref.update(patch);
      }
      results.push({ id: docSnap.id, doc_id: dealId, from_name: fromName, to_name: patch.to_name as string ?? d.to_name, ok: true });
    } catch {
      results.push({ id: docSnap.id, doc_id: dealId, from_name: null, ok: false });
    }
  }

  const updated = results.filter((r) => r.ok).length;
  return Response.json({
    dry,
    total: snap.size,
    updated,
    skipped: snap.size - updated,
    results,
  });
}
