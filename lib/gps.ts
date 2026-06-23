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

// Сохраняет данные, присланные userscript-релеем (Tampermonkey на gps16888.com) —
// для трекеров, ещё не переведённых на GPS-Trace.
export async function saveGpsLocations(locations: GpsLocation[]): Promise<void> {
  await getDb().doc(CACHE_DOC).set({
    locations,
    updated_at: new Date().toISOString(),
  });
}

interface GpsTraceUnit {
  id: number;
  name: string;
  ident: string;
}

interface GpsTraceTelemetryValue<T> { ts: number; value: T }
interface GpsTracePosition { latitude: number; longitude: number; speed: number; valid: boolean }
interface GpsTraceTelemetry {
  position?: GpsTraceTelemetryValue<GpsTracePosition>;
}

const GPS_TRACE_API = 'https://api.gps-trace.com';
let traceCache: { locations: GpsLocation[]; at: number } | null = null;
const TRACE_CACHE_TTL_MS = 20_000;

// Прямой опрос API GPS-Trace (долгоживущий токен, без релея) для уже переключённых трекеров.
async function fetchGpsTraceLocations(): Promise<GpsLocation[]> {
  const token = process.env.GPS_TRACE_API_TOKEN;
  const accountId = process.env.GPS_TRACE_ACCOUNT_ID;
  if (!token || !accountId) return [];
  if (traceCache && Date.now() - traceCache.at < TRACE_CACHE_TTL_MS) return traceCache.locations;

  try {
    const headers = { 'X-AccessToken': token };
    const unitsRes = await fetch(`${GPS_TRACE_API}/provider/units?account_ids=${accountId}`, { headers });
    if (!unitsRes.ok) throw new Error(`units ${unitsRes.status}`);
    const units = await unitsRes.json() as GpsTraceUnit[];

    const results = await Promise.all(units.map(async (u): Promise<GpsLocation | null> => {
      const res = await fetch(`${GPS_TRACE_API}/provider/units/${u.id}/telemetry`, { headers });
      if (!res.ok) return null;
      const telemetry = await res.json() as GpsTraceTelemetry;
      const pos = telemetry.position?.value;
      if (!pos || !pos.valid) return null;
      const time = telemetry.position?.ts ? new Date(telemetry.position.ts * 1000).toISOString() : '';
      return {
        user_id: u.ident,
        user_name: u.name,
        lat: pos.latitude,
        lng: pos.longitude,
        speed: pos.speed,
        sys_time: time,
        heart_time: time,
        alarm: 0,
        sim_id: u.ident,
      };
    }));

    const locations = results.filter((l): l is GpsLocation => l !== null);
    traceCache = { locations, at: Date.now() };
    return locations;
  } catch (err) {
    console.error('gps-trace fetch failed', err);
    return traceCache?.locations || [];
  }
}

// Возвращает локации: GPS-Trace (живой опрос) + кэш релея (для трекеров, ещё не переключённых).
export async function getCachedGpsLocations(): Promise<{ locations: GpsLocation[]; updated_at: string | null }> {
  const [relay, traceLocations] = await Promise.all([
    (async () => {
      const snap = await getDb().doc(CACHE_DOC).get();
      if (!snap.exists) return { locations: [] as GpsLocation[], updated_at: null as string | null };
      const data = snap.data() as { locations?: GpsLocation[]; updated_at?: string };
      return { locations: data.locations || [], updated_at: data.updated_at || null };
    })(),
    fetchGpsTraceLocations(),
  ]);
  return {
    locations: [...traceLocations, ...relay.locations],
    updated_at: traceLocations.length > 0 ? new Date().toISOString() : relay.updated_at,
  };
}
