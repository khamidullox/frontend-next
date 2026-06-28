import { getDb } from './firebase';
import { haversineKm } from './geo';

// Реальное расстояние по дорогам между двумя точками (км). Источник — OSRM-совместимый
// сервис маршрутизации (по умолчанию публичный демо-сервер; можно переопределить через
// env ROUTING_URL на свой/платный). Каждое посчитанное плечо КЭШИРУЕТСЯ в Firestore —
// у нас ограниченный набор точек (база ↔ магазины), поэтому к внешнему сервису обращаемся
// один раз на пару, дальше берём из кэша. Если сервис недоступен — НЕ ломаемся, а
// возвращаем оценку: прямая × 1.3 (средний «извилистый» коэффициент для города), и такую
// оценку НЕ кэшируем, чтобы в следующий раз снова попробовать получить точное значение.

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

async function fetchOsrm(lat1: number, lng1: number, lat2: number, lng2: number): Promise<number | null> {
  const url = `${routingBase()}/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=false`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const meters = data?.routes?.[0]?.distance;
    return typeof meters === 'number' && meters > 0 ? meters / 1000 : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

  const km = await fetchOsrm(lat1, lng1, lat2, lng2);
  if (km == null) return fallback(); // сервис лёг — оценка, без кэширования
  try {
    await ref.set({ km, lat1, lng1, lat2, lng2, source: 'osrm', at: new Date().toISOString() });
  } catch { /* запись в кэш не критична */ }
  return km;
}
