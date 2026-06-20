import { NextRequest } from 'next/server';
import { getCachedCatalog } from '@/lib/products';
import { smartupRequest, smartupGetFile, getSmartupProject } from '@/lib/smartup';

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

    const card = Array.isArray(view) ? (view as unknown[])[2] : null;
    const photos = (card as Record<string, unknown> | null)?.photos;
    const sha = Array.isArray(photos) && photos.length > 0 && Array.isArray(photos[0])
      ? String((photos[0] as unknown[])[0] || '')
      : null;

    let imgStatus: number | null = null;
    let imgContentType: string | null = null;

    if (sha) {
      try {
        const imgRes = await smartupGetFile(
          `/b/biruni/m:load_image_v2?sha=${encodeURIComponent(sha)}`
        );
        imgStatus = imgRes.status;
        imgContentType = imgRes.headers.get('Content-Type');
      } catch (e) {
        imgStatus = -1;
        imgContentType = String(e);
      }
    }

    return Response.json({
      code,
      productId,
      sha,
      imgStatus,
      imgContentType,
      photosRaw: photos,
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
