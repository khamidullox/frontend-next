import { getDb } from './firebase';

export interface LogisticsSettings {
  fuel_rate_per_km: number; // стоимость 1 км (в сумах, round-trip × 2 в UI)
  // Вместимость по умолчанию для типов транспорта (когда у водителя своя не задана).
  cap_labo_kg: number;
  cap_labo_m3: number;
  cap_gazelle_kg: number;
  cap_gazelle_m3: number;
}

const DEFAULTS: LogisticsSettings = {
  fuel_rate_per_km: 0,
  cap_labo_kg: 600,
  cap_labo_m3: 3,
  cap_gazelle_kg: 1500,
  cap_gazelle_m3: 9,
};

export async function getLogisticsSettings(): Promise<LogisticsSettings> {
  const snap = await getDb().collection('settings').doc('logistics').get();
  if (!snap.exists) return { ...DEFAULTS };
  return { ...DEFAULTS, ...(snap.data() as Partial<LogisticsSettings>) };
}

export async function setLogisticsSettings(patch: Partial<LogisticsSettings>): Promise<void> {
  await getDb().collection('settings').doc('logistics').set(patch, { merge: true });
}
