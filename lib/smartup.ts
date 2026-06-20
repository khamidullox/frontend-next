const SMARTUP_URL = process.env.SMARTUP_URL || 'https://smartup.online';
const SMARTUP_USERNAME = process.env.SMARTUP_USERNAME || '';
const SMARTUP_PASSWORD = process.env.SMARTUP_PASSWORD || '';
const SMARTUP_PROJECT = process.env.SMARTUP_PROJECT || 'anor';
const SMARTUP_FILIAL_ID = process.env.SMARTUP_FILIAL_ID || '';

export const getSmartupProject = () => SMARTUP_PROJECT;

// ─── Учёт лимитов Smartup ────────────────────────────────────────────────
// Каждый ответ Smartup содержит объект limits со счётчиком по типу документа.
// Запоминаем последнее виденное значение по endpoint — без лишних запросов.
export interface SmartupLimit {
  endpoint: string;
  left: number | null;       // left_limit_quant — сколько осталось
  total: number | null;      // limit_quant — суточный лимит
  seen_at: string;           // когда последний раз видели
}

const limitStore = new Map<string, SmartupLimit>();

export function getSmartupLimits(): SmartupLimit[] {
  return Array.from(limitStore.values()).sort((a, b) => a.endpoint.localeCompare(b.endpoint));
}

function recordLimit(endpoint: string, parsed: unknown) {
  if (!parsed || typeof parsed !== 'object') return;
  const limits = (parsed as Record<string, unknown>).limits as Record<string, unknown> | undefined;
  if (!limits || typeof limits !== 'object') return;
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  limitStore.set(endpoint, {
    endpoint,
    left: num(limits.left_limit_quant),
    total: num(limits.limit_quant),
    seen_at: new Date().toISOString(),
  });
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
