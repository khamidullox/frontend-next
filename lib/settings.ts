import { getDb } from './firebase';

export interface LogisticsSettings {
  fuel_rate_per_km: number; // стоимость 1 км (в сумах, round-trip × 2 в UI)
}

const DEFAULTS: LogisticsSettings = { fuel_rate_per_km: 0 };

export async function getLogisticsSettings(): Promise<LogisticsSettings> {
  const snap = await getDb().collection('settings').doc('logistics').get();
  if (!snap.exists) return { ...DEFAULTS };
  return { ...DEFAULTS, ...(snap.data() as Partial<LogisticsSettings>) };
}

export async function setLogisticsSettings(patch: Partial<LogisticsSettings>): Promise<void> {
  await getDb().collection('settings').doc('logistics').set(patch, { merge: true });
}
