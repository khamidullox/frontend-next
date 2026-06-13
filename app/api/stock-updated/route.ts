import { getStockUpdatedMs } from '@/lib/products';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Когда снимок остатков в Firestore последний раз обновлялся.
export async function GET() {
  return withRole('worker', async () => {
    try {
      const updated_ms = await getStockUpdatedMs();
      return Response.json({ updated_ms });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
