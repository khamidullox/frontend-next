import { listOrders } from '@/lib/orders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const orders = await listOrders();
    return Response.json({ data: orders });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
