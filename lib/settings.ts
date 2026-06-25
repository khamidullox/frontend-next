import { getDb } from './firebase';

// Ключ-«заглушка» для вида транспорта без своей настройки («Прочие»). Используется
// во всём UI и в сравнениях как есть.
export const CAP_DEFAULT_KEY = '__default__';

// ВАЖНО: Firestore запрещает имена полей, совпадающие с шаблоном __.*__ (двойное
// подчёркивание в начале И в конце). Ключ '__default__' внутри карт cap_by_type/
// rate_by_type/… — это имя вложенного поля, поэтому запись таких карт молча
// ломалась, документ настроек не сохранялся, и чтение всегда откатывалось на
// дефолты (отсюда «поменял вместимость/КПИ → после перезахода снова старое»).
// Поэтому в Firestore храним под безопасным ключом, а на границе get/set
// переводим туда-обратно — остальной код этого не замечает.
const STORAGE_DEFAULT_KEY = 'DEFAULT';

function mapKeys<T>(m: Record<string, T> | undefined, from: string, to: string): Record<string, T> | undefined {
  if (!m) return m;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(m)) out[k === from ? to : k] = v;
  return out;
}
const toStorage = <T>(m: Record<string, T> | undefined) => mapKeys(m, CAP_DEFAULT_KEY, STORAGE_DEFAULT_KEY);
const fromStorage = <T>(m: Record<string, T> | undefined) => mapKeys(m, STORAGE_DEFAULT_KEY, CAP_DEFAULT_KEY);

export interface LogisticsSettings {
  // Вместимость по умолчанию по виду транспорта (когда у водителя своя не задана).
  // Ключ — точное значение поля «Транспорт» у водителя; CAP_DEFAULT_KEY — для
  // видов транспорта без своей настройки («Прочие»).
  cap_by_type: Record<string, { kg: number; m3: number }>;
  // КПИ водителя — ставка за км по виду транспорта (для отчётов), отдельно от
  // топлива: у LABO своя ставка, у Газели своя и т.д. Тот же принцип ключей, что у cap_by_type.
  rate_by_type: Record<string, number>;
  // КПИ за точку доставки (сумма за один заезд в магазин, независимо от числа
  // накладных/складов) по виду транспорта. Тот же принцип ключей.
  point_rate_by_type: Record<string, number>;
  // Сниженная ставка за точку, когда выезд недогружен (< 50% вместимости машины по
  // весу или объёму — например, взял с одного склада один маленький товар и довёз
  // рядом). 0/не задано — скидка не применяется, платится обычная ставка.
  point_rate_low_load_by_type: Record<string, number>;
  // Стоимость топлива (сум/км, в одну сторону — ×2 при подсчёте туда-обратно) по виду
  // транспорта, тот же принцип ключей — у LABO свой расход, у Газели свой и т.д.
  fuel_rate_by_type: Record<string, number>;
}

const DEFAULTS: LogisticsSettings = {
  cap_by_type: {
    LABO: { kg: 600, m3: 3 },
    'Газель': { kg: 1500, m3: 9 },
    [CAP_DEFAULT_KEY]: { kg: 300, m3: 2 },
  },
  rate_by_type: {},
  point_rate_by_type: {},
  point_rate_low_load_by_type: {},
  fuel_rate_by_type: {},
};

export async function getLogisticsSettings(): Promise<LogisticsSettings> {
  const snap = await getDb().collection('settings').doc('logistics').get();
  if (!snap.exists) return { ...DEFAULTS, cap_by_type: { ...DEFAULTS.cap_by_type } };
  const data = snap.data() as Partial<LogisticsSettings> & { fuel_rate_per_km?: number };
  // Старое единое fuel_rate_per_km (до перехода на ставку по виду транспорта) —
  // переносим в «Прочие», чтобы у тех, кто уже настроил топливо, цифра не пропала.
  const fuelByType = data.fuel_rate_by_type && Object.keys(data.fuel_rate_by_type).length
    ? data.fuel_rate_by_type
    : (data.fuel_rate_per_km ? { [STORAGE_DEFAULT_KEY]: data.fuel_rate_per_km } : DEFAULTS.fuel_rate_by_type);
  // Переводим storage-ключ DEFAULT обратно в CAP_DEFAULT_KEY для остального кода.
  return {
    cap_by_type: fromStorage(data.cap_by_type && Object.keys(data.cap_by_type).length ? data.cap_by_type : { ...DEFAULTS.cap_by_type })!,
    rate_by_type: fromStorage(data.rate_by_type ?? DEFAULTS.rate_by_type)!,
    point_rate_by_type: fromStorage(data.point_rate_by_type ?? DEFAULTS.point_rate_by_type)!,
    point_rate_low_load_by_type: fromStorage(data.point_rate_low_load_by_type ?? DEFAULTS.point_rate_low_load_by_type)!,
    fuel_rate_by_type: fromStorage(fuelByType)!,
  };
}

export async function setLogisticsSettings(patch: Partial<LogisticsSettings>): Promise<void> {
  // Переводим CAP_DEFAULT_KEY ('__default__') в безопасный для Firestore ключ —
  // иначе запись поля молча не проходит (см. комментарий к STORAGE_DEFAULT_KEY).
  const safe: Partial<LogisticsSettings> = {};
  if (patch.cap_by_type) safe.cap_by_type = toStorage(patch.cap_by_type);
  if (patch.rate_by_type) safe.rate_by_type = toStorage(patch.rate_by_type);
  if (patch.point_rate_by_type) safe.point_rate_by_type = toStorage(patch.point_rate_by_type);
  if (patch.point_rate_low_load_by_type) safe.point_rate_low_load_by_type = toStorage(patch.point_rate_low_load_by_type);
  if (patch.fuel_rate_by_type) safe.fuel_rate_by_type = toStorage(patch.fuel_rate_by_type);
  await getDb().collection('settings').doc('logistics').set(safe, { merge: true });
}

// Семейство транспорта по подстроке в названии (любая модель LABO/Газели — независимо
// от точной модели, например «Chevrolet LABO» или «GAZ 33021»).
export function vehicleFamily(transport: string | null | undefined): 'LABO' | 'Газель' | null {
  const t = (transport || '').toLowerCase();
  if (t.includes('labo')) return 'LABO';
  if (t.includes('gaz') || t.includes('газел') || t.includes('33021')) return 'Газель';
  return null;
}

// Вместимость по умолчанию для вида транспорта: своя настройка → настройка семейства
// (LABO/Газель) → «Прочие». pcs — ориентировочная вместимость в штуках (фолбэк, когда
// у товаров нет веса/объёма).
export function defaultCapacity(transport: string | null | undefined, settings: LogisticsSettings): { kg: number; m3: number; pcs: number } {
  const key = (transport || '').trim();
  const family = vehicleFamily(key);
  const cap = (key && settings.cap_by_type[key])
    || (family && settings.cap_by_type[family])
    || settings.cap_by_type[CAP_DEFAULT_KEY]
    || { kg: 0, m3: 0 };
  const pcs = family === 'LABO' ? 80 : family === 'Газель' ? 200 : 50;
  return { kg: cap.kg, m3: cap.m3, pcs };
}
