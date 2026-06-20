import { NextRequest } from 'next/server';
import { getCachedCatalog } from '@/lib/products';
import { smartupRequest, smartupGetFile, getSmartupProject } from '@/lib/smartup';
import { getDb } from '@/lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Процесс-уровня кеш: быстрый доступ внутри одного serverless-инстанса.
const memCache = new Map<string, string | null>();

// Firestore TTL: 7 дней — фото меняются редко.
const PHOTO_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function getShaFromFirestore(code: string): Promise<string | null | undefined> {
  try {
    const db = getDb();
    const doc = await db.collection('product_photos').doc(code).get();
    if (!doc.exists) return undefined;
    const data = doc.data()!;
    const updatedAt: number = data.updated_at?.toMillis?.() ?? 0;
    if (Date.now() - updatedAt > PHOTO_TTL_MS) return undefined; // устарело
    return data.sha as string | null;
  } catch {
    return undefined;
  }
}

async function saveShaToFirestore(code: string, sha: string | null) {
  try {
    const db = getDb();
    await db.collection('product_photos').doc(code).set({
      sha,
      updated_at: FieldValue.serverTimestamp(),
    });
  } catch {
    // не критично — просто не кешируем
  }
}

async function fetchShaFromSmartup(code: string): Promise<string | null> {
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
    return sha || null;
  } catch {
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  // 1. Процессный кеш (мгновенно)
  let sha = memCache.get(code);

  if (sha === undefined) {
    // 2. Firestore (персистентный кеш между деплоями и инстансами)
    const cached = await getShaFromFirestore(code);

    if (cached !== undefined) {
      sha = cached;
    } else {
      // 3. Smartup (первый раз или устарело)
      sha = await fetchShaFromSmartup(code);
      await saveShaToFirestore(code, sha);
    }

    memCache.set(code, sha);
  }

  if (!sha) {
    return new Response(null, { status: 404 });
  }

  let imgRes: Response;
  try {
    imgRes = await smartupGetFile(
      `/b/biruni/m:load_image_v2?sha=${encodeURIComponent(sha)}`
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
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=600',
    },
  });
}
