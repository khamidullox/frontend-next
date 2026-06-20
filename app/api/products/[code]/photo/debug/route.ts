import { NextRequest } from 'next/server';
import { getCachedCatalog } from '@/lib/products';
import { smartupRequest, getSmartupProject } from '@/lib/smartup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const catalog = await getCachedCatalog();
  const item = catalog.find((c) => c.code === code);
  const productId = item?.product_id || code;

  try {
    const proj = getSmartupProject();
    const view = await smartupRequest<unknown>(
      `/b/${proj}/mr/product/inventory_view:model`,
      { product_id: productId }
    );

    return Response.json({
      code,
      productId,
      itemFound: !!item,
      isArray: Array.isArray(view),
      length: Array.isArray(view) ? view.length : null,
      element2: Array.isArray(view) ? (view as unknown[])[2] : null,
      raw: view,
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
