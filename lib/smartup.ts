import { getDb } from './firebase';

const SMARTUP_URL = process.env.SMARTUP_URL || 'https://smartup.online';
const SMARTUP_USERNAME = process.env.SMARTUP_USERNAME || '';
const SMARTUP_PASSWORD = process.env.SMARTUP_PASSWORD || '';
const SMARTUP_PROJECT = process.env.SMARTUP_PROJECT || 'anor';
const SMARTUP_FILIAL_ID = process.env.SMARTUP_FILIAL_ID || '';

export const getSmartupProject = () => SMARTUP_PROJECT;

// ─── Учёт лимитов Smartup ────────────────────────────────────────────────
// Официальные лимиты Smartup:
//   Справочники (inventory, warehouse, price, product_group): 100 запросов/день
//   Редкие документы (movement, input): 300 запросов/день
//   Частые документы (order, balance): 500 запросов/день
//   Период данных: не старше 7 дней (per endpoint — см. day_range в ответе)
//   Макс. объектов в запросе: 5000
//
// Данные сохраняются в Firestore (meta/smartup_limits), чтобы пережить
// перезапуск Vercel serverless instances.
export interface SmartupLimit {
  endpoint: string;
  has_limit: boolean;           // has_limit === 'Y'
  total: number | null;         // limit_quant — суточный лимит
  used: number | null;          // request_quant — сколько уже использовано
  left: number | null;          // left_limit_quant — сколько осталось
  object_count: number | null;  // макс. объектов в одном запросе
  day_range: number | null;     // day_range_limit — макс. дней в запросе
  seen_at: string;
}

const limitStore = new Map<string, SmartupLimit>();

export function getSmartupLimits(): SmartupLimit[] {
  return Array.from(limitStore.values()).sort((a, b) => a.endpoint.localeCompare(b.endpoint));
}

export async function getSmartupLimitsFromFirestore(): Promise<SmartupLimit[]> {
  try {
    const db = getDb();
    const doc = await db.collection('meta').doc('smartup_limits').get();
    const fsData = doc.exists ? doc.data() || {} : {};
    const fsItems = Object.values(fsData)
      .filter((v): v is SmartupLimit => !!v && typeof v === 'object' && 'endpoint' in (v as object));
    // Слияние: in-memory приоритетнее (он свежее если instance только что стрелял)
    const merged = new Map<string, SmartupLimit>();
    for (const item of fsItems) merged.set(item.endpoint, item);
    for (const item of limitStore.values()) merged.set(item.endpoint, item);
    return [...merged.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint));
  } catch {
    return getSmartupLimits();
  }
}

function recordLimit(endpoint: string, parsed: unknown) {
  if (!parsed || typeof parsed !== 'object') return;
  const l = (parsed as Record<string, unknown>).limits as Record<string, unknown> | undefined;
  if (!l || typeof l !== 'object') return;
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const entry: SmartupLimit = {
    endpoint,
    has_limit: l.has_limit === 'Y',
    total: num(l.limit_quant),
    used: num(l.request_quant),
    left: num(l.left_limit_quant),
    object_count: num(l.object_count),
    day_range: num(l.day_range_limit),
    seen_at: new Date().toISOString(),
  };
  limitStore.set(endpoint, entry);
  // Сохраняем в Firestore асинхронно (fire-and-forget) — переживает cold start
  try {
    const db = getDb();
    const key = endpoint.replace(/[^a-zA-Z0-9_$]/g, '_');
    db.collection('meta').doc('smartup_limits')
      .set({ [key]: entry, updated_at: entry.seen_at }, { merge: true })
      .catch(() => {});
  } catch {}
}

export async function smartupRequest<T = Record<string, unknown>>(
  endpoint: string,
  body: Record<string, unknown> = {},
  retry = 2,
  project: string = SMARTUP_PROJECT
): Promise<T> {
  if (!SMARTUP_USERNAME || !SMARTUP_PASSWORD) {
    throw new Error('Не заданы SMARTUP_USERNAME / SMARTUP_PASSWORD');
  }

  const url = `${SMARTUP_URL}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    Authorization:
      'Basic ' +
      Buffer.from(`${SMARTUP_USERNAME}:${SMARTUP_PASSWORD}`).toString('base64'),
    project_code: project,
  };

  if (SMARTUP_FILIAL_ID) {
    headers.filial_id = SMARTUP_FILIAL_ID;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const text = await res.text();

    if (!res.ok) {
      throw new Error(`Smartup returned ${res.status}: ${text}`);
    }

    if (!text.trim()) {
      return {} as T;
    }

    try {
      const parsed = JSON.parse(text);
      recordLimit(endpoint, parsed);
      return parsed as T;
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error(`Smartup returned non-JSON response: ${text}`);
      }
      throw e;
    }
  } catch (err) {
    if (retry > 0) {
      return smartupRequest<T>(endpoint, body, retry - 1, project);
    }
    throw err;
  }
}

// GET-запрос к Smartup (для biruni: фото, файлы) — тот же Basic auth.
export async function smartupGetFile(path: string): Promise<Response> {
  if (!SMARTUP_USERNAME || !SMARTUP_PASSWORD) {
    throw new Error('Не заданы SMARTUP_USERNAME / SMARTUP_PASSWORD');
  }
  return fetch(`${SMARTUP_URL}${path}`, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${SMARTUP_USERNAME}:${SMARTUP_PASSWORD}`).toString('base64'),
    },
    redirect: 'follow',
  });
}
