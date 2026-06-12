import { getProductCatalog } from '@/lib/products';
import { getCachedList } from '@/lib/listCache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Каталог читается из Firestore-кэша (быстро). В фоне обновляется из Smartup.
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000; // 6 часов

export async function GET() {
  try {
    const data = await getCachedList('products', getProductCatalog, CATALOG_TTL_MS);
    return Response.json({ data });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
