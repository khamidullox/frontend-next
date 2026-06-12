import { after } from 'next/server';
import { getDb } from './firebase';

// Способ 3: списки накладных/заказов кэшируются в Firestore.
// Страница всегда читает из Firestore (быстро, ~0.5с), а если кэш устарел —
// обновление из Smartup запускается ФОНОМ после ответа (after()).
// Так список не зависит от «прогрева» инстанса Vercel.

const COLLECTION = 'list_cache';
const CHUNK = 1000; // Firestore: лимит документа 1 МБ, режем на части

interface Meta {
  updated_ms: number;
  chunks: number;
}

async function writeListCache(type: string, items: unknown[]) {
  const db = getDb();
  const col = db.collection(COLLECTION);
  const chunks = Math.ceil(items.length / CHUNK);

  const batch = db.batch();
  for (let i = 0; i < chunks; i++) {
    batch.set(col.doc(`${type}_${i}`), { items: items.slice(i * CHUNK, (i + 1) * CHUNK) });
  }
  // Подчищаем возможные «лишние» старые чанки (если список стал короче).
  for (let i = chunks; i < chunks + 20; i++) {
    batch.delete(col.doc(`${type}_${i}`));
  }
  batch.set(col.doc(type), { updated_ms: Date.now(), chunks } satisfies Meta);
  await batch.commit();
}

async function readListCache<T>(type: string): Promise<{ items: T[]; updated_ms: number } | null> {
  const db = getDb();
  const metaSnap = await db.collection(COLLECTION).doc(type).get();
  if (!metaSnap.exists) return null;

  const { updated_ms, chunks } = metaSnap.data() as Meta;
  const items: T[] = [];

  if (chunks > 0) {
    const refs = Array.from({ length: chunks }, (_, i) =>
      db.collection(COLLECTION).doc(`${type}_${i}`)
    );
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (s.exists) items.push(...((s.data() as { items: T[] }).items || []));
    }
  }

  return { items, updated_ms };
}

// Принудительно обновить кэш сейчас (для прогрева по расписанию/cron).
export async function refreshCachedList<T>(
  type: string,
  fetcher: () => Promise<T[]>
): Promise<number> {
  const fresh = await fetcher();
  await writeListCache(type, fresh);
  return fresh.length;
}

export async function getCachedList<T>(
  type: string,
  fetcher: () => Promise<T[]>,
  ttlMs: number
): Promise<T[]> {
  const cached = await readListCache<T>(type);

  if (cached) {
    if (Date.now() - cached.updated_ms > ttlMs) {
      // Кэш устарел — обновляем фоном (после ответа клиенту).
      after(async () => {
        try {
          const fresh = await fetcher();
          await writeListCache(type, fresh);
        } catch {
          // не критично — обновится в следующий раз
        }
      });
    }
    return cached.items;
  }

  // Первый раз — грузим живьём и сохраняем.
  const fresh = await fetcher();
  await writeListCache(type, fresh);
  return fresh;
}
