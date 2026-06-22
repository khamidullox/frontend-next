import { getDb } from './firebase';

export const CAP_DEFAULT_KEY = '__default__';

export interface LogisticsSettings {
  fuel_rate_per_km: number; // стоимость 1 км (в сумах, round-trip × 2 в UI)
  // Вместимость по умолчанию по виду транспорта (когда у водителя своя не задана).
  // Ключ — точное значение поля «Транспорт» у водителя; CAP_DEFAULT_KEY — для
  // видов транспорта без своей настройки («Прочие»).
  cap_by_type: Record<string, { kg: number; m3: number }>;
}

const DEFAULTS: LogisticsSettings = {
  fuel_rate_per_km: 0,
  cap_by_type: {
    LABO: { kg: 600, m3: 3 },
    'Газель': { kg: 1500, m3: 9 },
    [CAP_DEFAULT_KEY]: { kg: 300, m3: 2 },
  },
};

export async function getLogisticsSettings(): Promise<LogisticsSettings> {
  const snap = await getDb().collection('settings').doc('logistics').get();
  if (!snap.exists) return { fuel_rate_per_km: DEFAULTS.fuel_rate_per_km, cap_by_type: { ...DEFAULTS.cap_by_type } };
  const data = snap.data() as Partial<LogisticsSettings>;
  return {
    fuel_rate_per_km: data.fuel_rate_per_km ?? DEFAULTS.fuel_rate_per_km,
    cap_by_type: data.cap_by_type && Object.keys(data.cap_by_type).length ? data.cap_by_type : { ...DEFAULTS.cap_by_type },
  };
}

export async function setLogisticsSettings(patch: Partial<LogisticsSettings>): Promise<void> {
  await getDb().collection('settings').doc('logistics').set(patch, { merge: true });
}
