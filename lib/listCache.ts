import { after } from 'next/server';
import { getDb } from './firebase';

// Кэш списков/снимков в Firestore. Страница всегда читает из Firestore (быстро),
// а при устаревании обновление из Smartup запускается ФОНОМ (after()).
// Так данные не зависят от «прогрева» инстанса Vercel.

const COLLECTION = 'list_cache';
const CHUNK = 1000; // Firestore: лимит документа 1 МБ, режем на части
// Не запускать повторное фоновое обновление, если другое началось недавно
// (защита от «толпы»: 25 магазинов заходят одновременно → 1 обновление, не 25).
const REFRESH_LOCK_MS = 2 * 60 * 1000;

interface Meta {
  updated_ms: number;
  chunks: number;
  refreshing_at?: number;
}

async function writeListCache(type: string, items: unknown[], chunkSize = CHUNK) {
  const db = getDb();
  const col = db.collection(COLLECTION);
  const chunks = Math.ceil(items.length / chunkSize);

  const batch = db.batch();
  for (let i = 0; i < chunks; i++) {
    batch.set(col.doc(`${type}_${i}`), { items: items.slice(i * chunkSize, (i + 1) * chunkSize) });
  }
  // Подчищаем возможные «лишние» старые чанки (если список стал короче).
  for (let i = chunks; i < chunks + 30; i++) {
    batch.delete(col.doc(`${type}_${i}`));
  }
  batch.set(col.doc(type), { updated_ms: Date.now(), chunks } satisfies Meta);
  await batch.commit();
}

async function readMeta(type: string): Promise<Meta | null> {
  const snap = await getDb().collection(COLLECTION).doc(type).get();
  if (!snap.exists) return null;
  return snap.data() as Meta;
}

async function readChunks<T>(type: string, chunks: number): Promise<T[]> {
  if (!chunks || chunks <= 0) return [];
  const db = getDb();
  const refs = Array.from({ length: chunks }, (_, i) =>
    db.collection(COLLECTION).doc(`${type}_${i}`)
  );
  const snaps = await db.getAll(...refs);
  const items: T[] = [];
  for (const s of snaps) {
    if (s.exists) items.push(...((s.data() as { items: T[] }).items || []));
  }
  return items;
}

async function readListCache<T>(type: string): Promise<{ items: T[]; updated_ms: number } | null> {
  const meta = await readMeta(type);
  if (!meta) return null;
  const items = await readChunks<T>(type, meta.chunks);
  return { items, updated_ms: meta.updated_ms };
}

// Когда снимок последний раз обновлялся (мс). null — если кэша ещё нет.
export async function getCachedListUpdatedMs(type: string): Promise<number | null> {
  const meta = await readMeta(type);
  return meta?.updated_ms ?? null;
}

// Принудительно обновить кэш сейчас (для прогрева по расписанию/cron).
export async function refreshCachedList<T>(
  type: string,
  fetcher: () => Promise<T[]>,
  chunkSize = CHUNK
): Promise<number> {
  const fresh = await fetcher();
  await writeListCache(type, fresh, chunkSize);
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
      after(async () => {
        try {
          const fresh = await fetcher();
          await writeListCache(type, fresh);
        } catch {
          // обновится в следующий раз
        }
      });
    }
    return cached.items;
  }
  const fresh = await fetcher();
  await writeListCache(type, fresh);
  return fresh;
}

// Снимок для частого обновления (остатки): TTL + защита от «толпы» + размер чанка.
// При устаревании отдаёт текущие данные мгновенно и ОДИН раз запускает фоновое
// обновление (другие заходы в течение REFRESH_LOCK_MS его не дублируют).
export async function getCachedSnapshot<T>(
  type: string,
  fetcher: () => Promise<T[]>,
  ttlMs: number,
  chunkSize = CHUNK
): Promise<T[]> {
  const meta = await readMeta(type);
  if (meta) {
    const items = await readChunks<T>(type, meta.chunks);
    const now = Date.now();
    const stale = now - meta.updated_ms > ttlMs;
    const busy = now - (meta.refreshing_at ?? 0) < REFRESH_LOCK_MS;
    if (stale && !busy) {
      // Помечаем «обновление началось» — чтобы параллельные заходы не дублировали.
      await getDb().collection(COLLECTION).doc(type).set({ refreshing_at: now }, { merge: true });
      after(async () => {
        try {
          const fresh = await fetcher();
          await writeListCache(type, fresh, chunkSize);
        } catch {
          // обновится при следующем заходе
        }
      });
    }
    return items;
  }
  const fresh = await fetcher();
  await writeListCache(type, fresh, chunkSize);
  return fresh;
}
