import { getDb } from './firebase';
import { haversineKm } from './geo';

// Реальное расстояние по дорогам между двумя точками (км). Источник:
//   • OpenRouteService — если задан env ORS_API_KEY (надёжный, бесплатно до 2000/день);
//   • иначе OSRM-совместимый сервис (env ROUTING_URL, по умолчанию публичный демо-сервер).
// Каждое посчитанное плечо КЭШИРУЕТСЯ в Firestore — у нас ограниченный набор точек
// (база ↔ магазины), поэтому к внешнему сервису обращаемся один раз на пару, дальше из
// кэша (с учётом этого даже лимита ORS хватает с огромным запасом). Если сервис недоступен —
// НЕ ломаемся, а возвращаем оценку: прямая × 1.3 (средний «извилистый» коэффициент для
// города), и такую оценку НЕ кэшируем, чтобы в следующий раз снова получить точное значение.

const COLLECTION = 'road_distance_cache';
const ROAD_FACTOR = 1.3; // фолбэк: во сколько раз дорога обычно длиннее прямой
const TIMEOUT_MS = 6000;

function routingBase(): string {
  return (process.env.ROUTING_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
}

function keyFor(lat1: number, lng1: number, lat2: number, lng2: number): string {
  const r = (n: number) => n.toFixed(5);
  return `${r(lat1)},${r(lng1)}_${r(lat2)},${r(lng2)}`;
}

function withTimeout(): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return { signal: ctrl.signal, clear: () => clearTimeout(timer) };
}

// OpenRouteService (GET directions). Ключ — env ORS_API_KEY.
async function fetchOrs(lat1: number, lng1: number, lat2: number, lng2: number): Promise<number | null> {
  const key = process.env.ORS_API_KEY;
  if (!key) return null;
  const url = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${encodeURIComponent(key)}&start=${lng1},${lat1}&end=${lng2},${lat2}`;
  const t = withTimeout();
  try {
    const res = await fetch(url, { signal: t.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const meters = data?.features?.[0]?.properties?.summary?.distance;
    return typeof meters === 'number' && meters > 0 ? meters / 1000 : null;
  } catch {
    return null;
  } finally {
    t.clear();
  }
}

// OSRM-совместимый сервис (env ROUTING_URL).
async function fetchOsrm(lat1: number, lng1: number, lat2: number, lng2: number): Promise<number | null> {
  const url = `${routingBase()}/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;
  const t = withTimeout();
  try {
    const res = await fetch(url, { signal: t.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const meters = data?.routes?.[0]?.distance;
    return typeof meters === 'number' && meters > 0 ? meters / 1000 : null;
  } catch {
    return null;
  } finally {
    t.clear();
  }
}

// Точное дорожное расстояние от выбранного провайдера: ORS (если есть ключ), иначе OSRM.
async function fetchRoad(lat1: number, lng1: number, lat2: number, lng2: number): Promise<number | null> {
  if (process.env.ORS_API_KEY) return fetchOrs(lat1, lng1, lat2, lng2);
  return fetchOsrm(lat1, lng1, lat2, lng2);
}

// Дорожное расстояние (км, не округлённое). Никогда не бросает: при сбое сервиса —
// оценка по прямой × коэффициент.
export async function roadKm(lat1: number, lng1: number, lat2: number, lng2: number): Promise<number> {
  const fallback = () => haversineKm(lat1, lng1, lat2, lng2) * ROAD_FACTOR;
  const db = getDb();
  const ref = db.collection(COLLECTION).doc(keyFor(lat1, lng1, lat2, lng2));
  try {
    const snap = await ref.get();
    if (snap.exists) {
      const km = (snap.data() as { km?: number }).km;
      if (typeof km === 'number' && km > 0) return km;
    }
  } catch { /* кэш недоступен — считаем заново */ }

  const km = await fetchRoad(lat1, lng1, lat2, lng2);
  if (km == null) return fallback(); // сервис лёг — оценка, без кэширования
  try {
    const source = process.env.ORS_API_KEY ? 'ors' : 'osrm';
    await ref.set({ km, lat1, lng1, lat2, lng2, source, at: new Date().toISOString() });
  } catch { /* запись в кэш не критична */ }
  return km;
}
