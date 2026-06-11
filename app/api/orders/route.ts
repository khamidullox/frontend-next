import { listOrders } from '@/lib/orders';
import { getCachedList } from '@/lib/listCache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIST_TTL_MS = 3 * 60 * 1000;

export async function GET() {
  try {
    const orders = await getCachedList('orders', listOrders, LIST_TTL_MS);
    return Response.json({ data: orders });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
