import { listWarehouseStock } from '@/lib/products';
import { getCachedList } from '@/lib/listCache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Список складов с агрегатами. Кэшируем в Firestore (как каталог) — быстро.
const TTL_MS = 30 * 60 * 1000; // 30 мин

export async function GET() {
  try {
    const data = await getCachedList('warehouses', listWarehouseStock, TTL_MS);
    return Response.json({ data });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
