const SMARTUP_URL = process.env.SMARTUP_URL || 'https://smartup.online';
const SMARTUP_USERNAME = process.env.SMARTUP_USERNAME || '';
const SMARTUP_PASSWORD = process.env.SMARTUP_PASSWORD || '';
const SMARTUP_PROJECT = process.env.SMARTUP_PROJECT || 'anor';
const SMARTUP_FILIAL_ID = process.env.SMARTUP_FILIAL_ID || '';

export async function smartupRequest<T = Record<string, unknown>>(
  endpoint: string,
  body: Record<string, unknown> = {},
  retry = 2
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
    project_code: SMARTUP_PROJECT,
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
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Smartup returned non-JSON response: ${text}`);
    }
  } catch (err) {
    if (retry > 0) {
      return smartupRequest<T>(endpoint, body, retry - 1);
    }
    throw err;
  }
}
