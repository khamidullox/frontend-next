import { listOrders } from '@/lib/orders';
import { getCachedList } from '@/lib/listCache';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIST_TTL_MS = 10 * 60 * 1000;

export async function GET() {
  return withRole('manager', async () => {
    try {
      const orders = await getCachedList('orders', listOrders, LIST_TTL_MS);
      return Response.json({ data: orders });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
