import { getDb } from './firebase';
import { hashPassword, Role } from './auth';

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
}

function publicUser(u: StoredUser): UserInfo {
  return {
    username: u.username,
    name: u.name,
    role: u.role,
    created_at: u.created_at,
    warehouses: Array.isArray(u.warehouses) ? u.warehouses : [],
    car_number: u.car_number ?? '',
    transport: u.transport ?? '',
    capacity_m3: Number(u.capacity_m3) || 0,
    capacity_kg: Number(u.capacity_kg) || 0,
    direction: u.direction ?? '',
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
    .map((d) => publicUser(d.data() as StoredUser))
    .sort((a, b) => a.username.localeCompare(b.username));
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

// Обновление профиля водителя (машина/транспорт/вместимость/направление).
export async function setDriverProfile(
  username: string,
  profile: { car_number?: string; transport?: string; capacity_m3?: number; capacity_kg?: number; direction?: string }
): Promise<{ ok: true } | { error: string }> {
  const ref = getDb().collection(COLLECTION).doc(normUsername(username));
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Пользователь не найден' };
  const patch: Partial<StoredUser> = {};
  if (profile.car_number !== undefined) patch.car_number = String(profile.car_number || '').trim();
  if (profile.transport !== undefined) patch.transport = String(profile.transport || '').trim();
  if (profile.capacity_m3 !== undefined) patch.capacity_m3 = Math.max(0, Number(profile.capacity_m3) || 0);
  if (profile.capacity_kg !== undefined) patch.capacity_kg = Math.max(0, Number(profile.capacity_kg) || 0);
  if (profile.direction !== undefined) patch.direction = String(profile.direction || '').trim();
  await ref.set(patch, { merge: true });
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
