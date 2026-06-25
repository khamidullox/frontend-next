import { getDb } from './firebase';
import { getCachedGpsLocations } from './gps';
import { haversineKm } from './geo';

const COLLECTION = 'gps_daily_mileage';

// Защита от единичных скачков координат у трекера (плохой GPS-фикс) — за один
// опрос (несколько минут) машина физически не проедет больше этого.
const MAX_PLAUSIBLE_KM_PER_TICK = 20;
// Дрожание GPS на стоянке (несколько метров) не копим как пробег.
const MIN_MOVE_KM = 0.03;

// «Сутки» по времени Ташкента (UTC+5, без перехода на летнее) — иначе вечером
// (после 19:00 UTC) пробег начал бы засчитываться в завтрашний день.
export function tashkentDateKey(d = new Date()): string {
  return new Date(d.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

interface MileageDoc {
  date: string;
  user_id: string;
  user_name: string;
  km: number;
  last_lat: number;
  last_lng: number;
  last_sys_time: string;
  updated_at: string;
}

// Вызывается по внешнему cron-триггеру (см. app/api/cron/gps-mileage) каждые
// несколько минут: берёт текущие позиции (GPS-Trace + релей, тот же источник,
// что у карты) и копит расстояние между соседними точками по дню — так получаем
// дневной пробег без отдельного API мили/одометра у GPS-Trace (его там нет).
export async function recordGpsTick(): Promise<{ checked: number; updated: number }> {
  const { locations } = await getCachedGpsLocations();
  const date = tashkentDateKey();
  const db = getDb();
  let updated = 0;

  for (const loc of locations) {
    if (!loc.user_id || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) continue;
    const ref = db.collection(COLLECTION).doc(`${date}_${loc.user_id}`);
    const snap = await ref.get();

    if (!snap.exists) {
      const doc: MileageDoc = {
        date, user_id: loc.user_id, user_name: loc.user_name || '',
        km: 0, last_lat: loc.lat, last_lng: loc.lng, last_sys_time: loc.sys_time || '',
        updated_at: new Date().toISOString(),
      };
      await ref.set(doc);
      continue;
    }

    const prev = snap.data() as MileageDoc;
    // Тот же таймстамп — трекер не присылал новый фикс с прошлого опроса, нечего считать.
    if (prev.last_sys_time && loc.sys_time && prev.last_sys_time === loc.sys_time) continue;

    const delta = haversineKm(prev.last_lat, prev.last_lng, loc.lat, loc.lng);
    const add = delta >= MIN_MOVE_KM && delta <= MAX_PLAUSIBLE_KM_PER_TICK ? delta : 0;

    await ref.set({
      km: (prev.km || 0) + add,
      last_lat: loc.lat, last_lng: loc.lng, last_sys_time: loc.sys_time || '',
      user_name: loc.user_name || prev.user_name,
      updated_at: new Date().toISOString(),
    }, { merge: true });
    if (add > 0) updated++;
  }

  return { checked: locations.length, updated };
}

export interface DailyMileageRow {
  user_id: string;
  user_name: string;
  km: number;
  updated_at: string;
}

export async function listDailyMileage(date: string): Promise<DailyMileageRow[]> {
  const snap = await getDb().collection(COLLECTION).where('date', '==', date).get();
  return snap.docs
    .map((d) => {
      const v = d.data() as MileageDoc;
      return { user_id: v.user_id, user_name: v.user_name, km: Math.round((v.km || 0) * 10) / 10, updated_at: v.updated_at };
    })
    .sort((a, b) => b.km - a.km);
}
