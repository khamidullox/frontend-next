import { listWarehouseStock } from '@/lib/products';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Список складов считается прямо из снимка остатков (агрегаты дешёвые).
export async function GET() {
  return withRole('worker', async () => {
    try {
      const data = await listWarehouseStock();
      return Response.json({ data });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
