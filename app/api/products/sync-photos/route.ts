import { NextRequest } from 'next/server';
import { getCachedCatalog } from '@/lib/products';
import { smartupRequest, getSmartupProject } from '@/lib/smartup';
import { getDb } from '@/lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel max function duration (Pro plan = 300s, Hobby = 60s)
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Простая защита: только внутренние вызовы или через ?secret=
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== (process.env.SYNC_SECRET || 'sync123')) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : 100;

  const db = getDb();
  const catalog = await getCachedCatalog();
  const proj = getSmartupProject();

  // Получаем уже закешированные
  const existing = new Set<string>();
  const snap = await db.collection('product_photos').select().get();
  snap.forEach(d => existing.add(d.id));

  // Берём только те, у которых нет SHA в Firestore
  const todo = catalog.filter(p => !existing.has(p.code)).slice(0, limit);

  let done = 0;
  let skipped = 0;
  let errors = 0;

  // Обрабатываем по 5 параллельно чтобы не перегрузить Smartup
  const CONCURRENCY = 5;
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (item) => {
      try {
        const productId = item.product_id || item.code;
        const view = await smartupRequest<unknown>(
          `/b/${proj}/mr/product/inventory_view:model`,
          { product_id: productId }
        );
        const card = Array.isArray(view) ? (view as unknown[])[2] : null;
        const photos = (card as Record<string, unknown> | null)?.photos;
        const sha = Array.isArray(photos) && photos.length > 0 && Array.isArray(photos[0])
          ? String((photos[0] as unknown[])[0] || '')
          : null;

        await db.collection('product_photos').doc(item.code).set({
          sha: sha || null,
          product_id: productId,
          updated_at: FieldValue.serverTimestamp(),
        });
        done++;
      } catch {
        errors++;
      }
    }));
  }

  skipped = existing.size;

  return Response.json({
    total: catalog.length,
    already_cached: skipped,
    processed: done,
    errors,
    remaining: catalog.length - skipped - done,
  });
}
