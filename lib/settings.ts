import { getDb } from './firebase';

export const CAP_DEFAULT_KEY = '__default__';

export interface LogisticsSettings {
  fuel_rate_per_km: number; // стоимость 1 км (в сумах, round-trip × 2 в UI)
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
}

const DEFAULTS: LogisticsSettings = {
  fuel_rate_per_km: 0,
  cap_by_type: {
    LABO: { kg: 600, m3: 3 },
    'Газель': { kg: 1500, m3: 9 },
    [CAP_DEFAULT_KEY]: { kg: 300, m3: 2 },
  },
  rate_by_type: {},
  point_rate_by_type: {},
};

export async function getLogisticsSettings(): Promise<LogisticsSettings> {
  const snap = await getDb().collection('settings').doc('logistics').get();
  if (!snap.exists) return { ...DEFAULTS, cap_by_type: { ...DEFAULTS.cap_by_type } };
  const data = snap.data() as Partial<LogisticsSettings>;
  return {
    fuel_rate_per_km: data.fuel_rate_per_km ?? DEFAULTS.fuel_rate_per_km,
    cap_by_type: data.cap_by_type && Object.keys(data.cap_by_type).length ? data.cap_by_type : { ...DEFAULTS.cap_by_type },
    rate_by_type: data.rate_by_type ?? DEFAULTS.rate_by_type,
    point_rate_by_type: data.point_rate_by_type ?? DEFAULTS.point_rate_by_type,
  };
}

export async function setLogisticsSettings(patch: Partial<LogisticsSettings>): Promise<void> {
  await getDb().collection('settings').doc('logistics').set(patch, { merge: true });
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
