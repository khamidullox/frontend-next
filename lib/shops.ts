import crypto from 'crypto';
import { getDb } from './firebase';

const COLLECTION = 'logistics_shops';

// Направления (стороны света) — оставлены для обратной совместимости.
export const DIRECTIONS = ['Север', 'Юг', 'Восток', 'Запад', 'Центр'] as const;
// direction теперь хранит произвольную строку (город/зона), а не только сторону света.
export type Direction = string;

export type ShopType = 'warehouse' | 'shop';

export interface Shop {
  id: string;
  name: string;
  address: string;
  direction: Direction;
  km: number;        // расстояние от базы (в одну сторону)
  phone: string;
  lat?: number;      // широта (десятичные градусы)
  lng?: number;      // долгота
  type?: ShopType;   // warehouse = база/склад, shop = магазин
  created_at: string;
}

function str(v: unknown): string {
  return String(v ?? '').trim();
}

function normDirection(v: unknown): Direction {
  // Раньше ограничивали сторонами света; теперь принимаем любой текст (город/зона).
  const s = str(v);
  return s || 'Центр';
}

export async function getShop(id: string): Promise<Shop | null> {
  const snap = await getDb().collection(COLLECTION).doc(str(id)).get();
  return snap.exists ? (snap.data() as Shop) : null;
}

export async function listShops(): Promise<Shop[]> {
  const snap = await getDb().collection(COLLECTION).get();
  return snap.docs
    .map((d) => d.data() as Shop)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

interface ShopInput {
  name?: string;
  address?: string;
  direction?: string;
  km?: number;
  phone?: string;
  lat?: number;
  lng?: number;
  type?: ShopType;
}

export async function createShop(input: ShopInput): Promise<{ shop: Shop } | { error: string }> {
  const name = str(input.name);
  if (!name) return { error: 'Укажите название' };
  const shop: Shop = {
    id: crypto.randomUUID(),
    name,
    address: str(input.address),
    direction: normDirection(input.direction),
    km: Math.max(0, Number(input.km) || 0),
    phone: str(input.phone),
    lat: input.lat !== undefined ? Number(input.lat) || undefined : undefined,
    lng: input.lng !== undefined ? Number(input.lng) || undefined : undefined,
    type: input.type === 'warehouse' ? 'warehouse' : 'shop',
    created_at: new Date().toISOString(),
  };
  await getDb().collection(COLLECTION).doc(shop.id).set(shop);
  return { shop };
}

export async function updateShop(id: string, input: ShopInput): Promise<{ shop: Shop } | { error: string }> {
  const ref = getDb().collection(COLLECTION).doc(str(id));
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Точка не найдена' };
  const shop = snap.data() as Shop;
  if (input.name !== undefined) shop.name = str(input.name);
  if (input.address !== undefined) shop.address = str(input.address);
  if (input.direction !== undefined) shop.direction = normDirection(input.direction);
  if (input.km !== undefined) shop.km = Math.max(0, Number(input.km) || 0);
  if (input.phone !== undefined) shop.phone = str(input.phone);
  if (input.lat !== undefined) shop.lat = Number(input.lat) || undefined;
  if (input.lng !== undefined) shop.lng = Number(input.lng) || undefined;
  if (input.type !== undefined) shop.type = input.type === 'warehouse' ? 'warehouse' : 'shop';
  await ref.set(shop);
  return { shop };
}

export async function deleteShop(id: string): Promise<boolean> {
  const ref = getDb().collection(COLLECTION).doc(str(id));
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}
