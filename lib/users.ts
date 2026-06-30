import { getDb, getRtdb } from './firebase';
import { hashPassword, Role, Language } from './auth';

const COLLECTION = 'users';

export interface StoredUser {
  username: string;
  name: string;
  role: Role;
  password_hash: string;
  created_at: string;
  warehouses?: string[];
  car_number?: string;   // для роли «водитель»
  transport?: string;    // тип транспорта (Газель, Спринтер, …)
  capacity_m3?: number;  // вместимость машины, м³
  capacity_kg?: number;  // грузоподъёмность, кг
  direction?: string;    // основное направление машины
  shop_id?: string;      // для роли «магазин» — привязка к точке (lib/shops.ts)
  home_warehouse?: string; // для роли «магазин» — код своего склада (по умолчанию в ценниках и т.п.)
  gps_user_id?: string;  // UUID на платформе gps16888.com
  language?: Language;   // язык интерфейса — выбирается самим пользователем в /profile
  features?: Record<string, boolean>; // переопределения доступа к разделам (см. lib/features.ts)
}

export interface UserInfo {
  username: string;
  name: string;
  role: Role;
  created_at: string;
  warehouses: string[];
  car_number: string;
  transport: string;
  capacity_m3: number;
  capacity_kg: number;
  direction: string;
  shop_id: string;
  home_warehouse: string;
  gps_user_id: string;
  language: Language;
  features: Record<string, boolean>;
}

function publicUser(u: StoredUser): UserInfo {
  return {
    username: u.username ?? '',
    name: u.name ?? '',
    role: u.role,
    created_at: u.created_at,
    warehouses: Array.isArray(u.warehouses) ? u.warehouses : [],
    car_number: u.car_number ?? '',
    transport: u.transport ?? '',
    capacity_m3: Number(u.capacity_m3) || 0,
    capacity_kg: Number(u.capacity_kg) || 0,
    direction: u.direction ?? '',
    shop_id: u.shop_id ?? '',
    home_warehouse: u.home_warehouse ?? '',
    gps_user_id: u.gps_user_id ?? '',
    language: u.language === 'uz' ? 'uz' : 'ru',
    features: u.features && typeof u.features === 'object' ? u.features : {},
  };
}

// Нормализация списка складов: "001, 002 ; 003" → ["001","002","003"]
export function normWarehouses(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normUsername(u: string): string {
  return String(u || '').trim().toLowerCase();
}

export async function countUsers(): Promise<number> {
  const snap = await getDb().collection(COLLECTION).count().get();
  return snap.data().count;
}

export async function getUserRaw(username: string): Promise<StoredUser | null> {
  const snap = await getDb().collection(COLLECTION).doc(normUsername(username)).get();
  return snap.exists ? (snap.data() as StoredUser) : null;
}

export async function listUsers(): Promise<UserInfo[]> {
  const snap = await getDb().collection(COLLECTION).get();
  return snap.docs
    // Логин = id документа; если в данных поля username нет (битый/старый док) — берём id.
    .map((d) => publicUser({ ...(d.data() as StoredUser), username: (d.data() as StoredUser).username || d.id }))
    .sort((a, b) => (a.username || '').localeCompare(b.username || ''));
}

export async function createUser(input: {
  username: string;
  name: string;
  role: Role;
  password: string;
  warehouses?: string[];
  car_number?: string;
  transport?: string;
  capacity_m3?: number;
  capacity_kg?: number;
  direction?: string;
  shop_id?: string;
  home_warehouse?: string;
}): Promise<{ ok: true } | { error: string }> {
  const username = normUsername(input.username);
  if (!username) return { error: 'Логин обязателен' };
  if (!/^[a-z0-9._-]{3,}$/.test(username))
    return { error: 'Логин: латиница/цифры, минимум 3 символа' };
  if (!input.password || input.password.length < 4)
    return { error: 'Пароль минимум 4 символа' };
  if (!['driver', 'worker', 'manager', 'admin'].includes(input.role))
    return { error: 'Неверная роль' };

  const ref = getDb().collection(COLLECTION).doc(username);
  const exists = await ref.get();
  if (exists.exists) return { error: 'Такой логин уже есть' };

  const user: StoredUser = {
    username,
    name: String(input.name || '').trim() || username,
    role: input.role,
    password_hash: hashPassword(input.password),
    created_at: new Date().toISOString(),
    warehouses: normWarehouses(input.warehouses),
    car_number: String(input.car_number || '').trim(),
    transport: String(input.transport || '').trim(),
    capacity_m3: Math.max(0, Number(input.capacity_m3) || 0),
    capacity_kg: Math.max(0, Number(input.capacity_kg) || 0),
    direction: String(input.direction || '').trim(),
    shop_id: String(input.shop_id || '').trim(),
    home_warehouse: String(input.home_warehouse || '').trim(),
  };
  await ref.set(user);
  return { ok: true };
}

// Список водителей (для выпадающего выбора при назначении доставки).
export async function listDrivers(): Promise<UserInfo[]> {
  const snap = await getDb().collection(COLLECTION).where('role', '==', 'driver').get();
  return snap.docs
    .map((d) => publicUser(d.data() as StoredUser))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

// Обновление профиля водителя (машина/транспорт/вместимость/направление/GPS).
export async function setDriverProfile(
  username: string,
  profile: { name?: string; car_number?: string; transport?: string; capacity_m3?: number; capacity_kg?: number; direction?: string; gps_user_id?: string }
): Promise<{ ok: true } | { error: string }> {
  const ref = getDb().collection(COLLECTION).doc(normUsername(username));
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Пользователь не найден' };
  const patch: Partial<StoredUser> = {};
  if (profile.name !== undefined) patch.name = String(profile.name || '').trim();
  if (profile.car_number !== undefined) patch.car_number = String(profile.car_number || '').trim();
  if (profile.transport !== undefined) patch.transport = String(profile.transport || '').trim();
  if (profile.capacity_m3 !== undefined) patch.capacity_m3 = Math.max(0, Number(profile.capacity_m3) || 0);
  if (profile.capacity_kg !== undefined) patch.capacity_kg = Math.max(0, Number(profile.capacity_kg) || 0);
  if (profile.direction !== undefined) patch.direction = String(profile.direction || '').trim();
  if (profile.gps_user_id !== undefined) patch.gps_user_id = String(profile.gps_user_id || '').trim();
  await ref.set(patch, { merge: true });
  return { ok: true };
}

// Привязка магазина (роль «worker») к точке из справочника (lib/shops.ts).
export async function setWorkerShop(
  username: string,
  shopId: string
): Promise<{ ok: true } | { error: string }> {
  const ref = getDb().collection(COLLECTION).doc(normUsername(username));
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Пользователь не найден' };
  await ref.set({ shop_id: String(shopId || '').trim() }, { merge: true });
  return { ok: true };
}

// Свой склад магазина (роль «worker») — используется как умолчание в ценниках и т.п.
export async function setWorkerHomeWarehouse(
  username: string,
  warehouseCode: string
): Promise<{ ok: true } | { error: string }> {
  const ref = getDb().collection(COLLECTION).doc(normUsername(username));
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Пользователь не найден' };
  await ref.set({ home_warehouse: String(warehouseCode || '').trim() }, { merge: true });
  return { ok: true };
}

export async function setUserWarehouses(
  username: string,
  warehouses: string[]
): Promise<{ ok: true } | { error: string }> {
  const ref = getDb().collection(COLLECTION).doc(normUsername(username));
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Пользователь не найден' };
  await ref.set({ warehouses: normWarehouses(warehouses) }, { merge: true });
  return { ok: true };
}

export async function deleteUser(username: string): Promise<void> {
  await getDb().collection(COLLECTION).doc(normUsername(username)).delete();
}

export async function setPassword(
  username: string,
  password: string
): Promise<{ ok: true } | { error: string }> {
  if (!password || password.length < 4) return { error: 'Пароль минимум 4 символа' };
  const ref = getDb().collection(COLLECTION).doc(normUsername(username));
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Пользователь не найден' };
  await ref.set({ password_hash: hashPassword(password) }, { merge: true });
  return { ok: true };
}

// Язык интерфейса — самостоятельно меняет любой пользователь у себя в /profile
// (в отличие от пароля/логина, тут не нужны права админа).
export async function setLanguage(
  username: string,
  language: Language
): Promise<{ ok: true } | { error: string }> {
  if (language !== 'ru' && language !== 'uz') return { error: 'Неверный язык' };
  const ref = getDb().collection(COLLECTION).doc(normUsername(username));
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Пользователь не найден' };
  await ref.set({ language }, { merge: true });
  return { ok: true };
}

// Переопределения доступа к разделам (см. lib/features.ts) — задаёт админ в карточке.
export async function setUserFeatures(
  username: string,
  features: Record<string, boolean>
): Promise<{ ok: true } | { error: string }> {
  const ref = getDb().collection(COLLECTION).doc(normUsername(username));
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Пользователь не найден' };
  // Чистим: оставляем только булевы значения.
  const clean: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(features || {})) {
    if (typeof v === 'boolean') clean[k] = v;
  }
  await ref.set({ features: clean }, { merge: true });
  return { ok: true };
}

// Смена логина: username — это сам id документа в Firestore, переименовать
// документ на месте нельзя, поэтому переносим (читаем → пишем новый id →
// удаляем старый) и заодно правим все места, где логин хранится как внешняя
// ссылка: deliveries.driver_username, routes.driver_username, узел координат
// в Realtime DB (vehicle_positions/{username}). Активная сессия (cookie) у
// пользователя при этом не обновится — после смены логина нужен повторный вход.
export async function renameUser(
  oldUsername: string,
  newUsername: string
): Promise<{ ok: true } | { error: string }> {
  const oldU = normUsername(oldUsername);
  const newU = normUsername(newUsername);
  if (!newU) return { error: 'Логин обязателен' };
  if (!/^[a-z0-9._-]{3,}$/.test(newU))
    return { error: 'Логин: латиница/цифры, минимум 3 символа' };
  if (newU === oldU) return { ok: true };

  const db = getDb();
  const oldRef = db.collection(COLLECTION).doc(oldU);
  const newRef = db.collection(COLLECTION).doc(newU);
  const [oldSnap, newSnap] = await Promise.all([oldRef.get(), newRef.get()]);
  if (!oldSnap.exists) return { error: 'Пользователь не найден' };
  if (newSnap.exists) return { error: 'Такой логин уже есть' };

  const user = oldSnap.data() as StoredUser;
  await newRef.set({ ...user, username: newU });
  await oldRef.delete();

  const [deliveriesSnap, routesSnap] = await Promise.all([
    db.collection('deliveries').where('driver_username', '==', oldU).get(),
    db.collection('routes').where('driver_username', '==', oldU).get(),
  ]);
  const batch = db.batch();
  let changed = false;
  for (const doc of deliveriesSnap.docs) { batch.update(doc.ref, { driver_username: newU }); changed = true; }
  for (const doc of routesSnap.docs) { batch.update(doc.ref, { driver_username: newU }); changed = true; }
  if (changed) await batch.commit();

  try {
    const posSnap = await getRtdb().ref(`vehicle_positions/${oldU}`).get();
    if (posSnap.exists()) {
      const pos = posSnap.val();
      await getRtdb().ref(`vehicle_positions/${newU}`).set({ ...pos, username: newU });
      await getRtdb().ref(`vehicle_positions/${oldU}`).remove();
    }
  } catch { /* RTDB недоступна — не критично, координаты перезапишутся сами при следующем GPS-пинге */ }

  return { ok: true };
}
