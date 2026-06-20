import { getProductCatalog } from '@/lib/products';
import { getCachedList } from '@/lib/listCache';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Каталог читается из Firestore-кэша (быстро). В фоне обновляется из Smartup.
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000; // 6 часов

export async function GET() {
  return withRole('worker', async () => {
    try {
      const full = await getCachedList('catalog_v4', getProductCatalog, CATALOG_TTL_MS);
      // Отдаём клиенту только то, что нужно для UI — без серверных полей.
      const data = full.map(({ code, name, producer, group, barcodes, price }) => ({
        code, name, producer, group, barcodes, price,
      }));
      return Response.json({ data }, {
        headers: { 'Cache-Control': 'private, max-age=300' },
      });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
