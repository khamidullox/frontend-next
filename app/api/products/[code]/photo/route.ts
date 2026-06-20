import { NextRequest } from 'next/server';
import { getCachedCatalog } from '@/lib/products';
import { smartupRequest, smartupGetFile, getSmartupProject } from '@/lib/smartup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SHA кэш в памяти сервера: code → sha (null = нет фото у товара).
// Обнуляется при перезапуске; для продакшна достаточно — фото меняются редко.
const shaCache = new Map<string, string | null>();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  let sha = shaCache.get(code);

  if (sha === undefined) {
    const catalog = await getCachedCatalog();
    const item = catalog.find((c) => c.code === code);
    // product_id может отличаться от code — используем его; иначе пробуем code.
    const productId = item?.product_id || code;

    try {
      const proj = getSmartupProject();
      const view = await smartupRequest<unknown>(
        `/b/${proj}/mr/product/inventory_view:model`,
        { product_id: productId }
      );
      // Ответ: ["(^_^)", {meta}, {card}]  — третий элемент содержит photos.
      const card = Array.isArray(view) ? (view as unknown[])[2] : null;
      const photos = (card as Record<string, unknown> | null)?.photos;
      sha = Array.isArray(photos) && photos.length > 0 && Array.isArray(photos[0])
        ? String(photos[0][0] || '')
        : null;
    } catch {
      sha = null;
    }
    shaCache.set(code, sha);
  }

  if (!sha) {
    return new Response(null, { status: 404 });
  }

  // Проксируем миниатюру из biruni (resize на стороне Smartup).
  let imgRes: Response;
  try {
    imgRes = await smartupGetFile(
      `/b/biruni/m:load_image_v2?sha=${encodeURIComponent(sha)}&type=S&height=400&width=400`
    );
  } catch {
    return new Response(null, { status: 502 });
  }

  if (!imgRes.ok) {
    return new Response(null, { status: 404 });
  }

  return new Response(imgRes.body, {
    headers: {
      'Content-Type': imgRes.headers.get('Content-Type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
    },
  });
}
