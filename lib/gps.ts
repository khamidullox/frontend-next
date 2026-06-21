import { getDb } from './firebase';

export interface GpsLocation {
  user_name: string;
  user_id: string;
  lat: number;
  lng: number;
  speed: number;
  sys_time: string;
  heart_time: string;
  alarm: number;
  sim_id: string;
}

const CACHE_DOC = 'system/gps_cache';

// Сохраняет данные, присланные userscript-релеем (Tampermonkey на gps16888.com).
export async function saveGpsLocations(locations: GpsLocation[]): Promise<void> {
  await getDb().doc(CACHE_DOC).set({
    locations,
    updated_at: new Date().toISOString(),
  });
}

// Возвращает закэшированные локации + время последнего обновления релея.
export async function getCachedGpsLocations(): Promise<{ locations: GpsLocation[]; updated_at: string | null }> {
  const snap = await getDb().doc(CACHE_DOC).get();
  if (!snap.exists) return { locations: [], updated_at: null };
  const data = snap.data() as { locations?: GpsLocation[]; updated_at?: string };
  return { locations: data.locations || [], updated_at: data.updated_at || null };
}
