import { getStockUpdatedMs } from '@/lib/products';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Когда снимок остатков в Firestore последний раз обновлялся.
export async function GET() {
  try {
    const updated_ms = await getStockUpdatedMs();
    return Response.json({ updated_ms });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
