import { getDb } from './firebase';

const COLLECTION = 'vehicle_positions';

// Одна перезаписываемая позиция на водителя (doc id = username) — для живой
// карты менеджера. История точек не хранится: км маршрута считается по
// полям km доставок (см. lib/routes.ts), а не по GPS-треку.
export interface VehiclePosition {
  username: string;
  driver_name: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  at: string;         // время фиксации на клиенте
  updated_at: string;  // время записи на сервере
  route_id: string | null;
}

function str(v: unknown): string {
  return String(v ?? '').trim();
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function upsertVehiclePosition(input: {
  username: string;
  driver_name: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  at?: string;
  route_id: string | null;
}): Promise<void> {
  const username = str(input.username);
  if (!username) return;
  const pos: VehiclePosition = {
    username,
    driver_name: str(input.driver_name),
    lat: Number(input.lat),
    lng: Number(input.lng),
    accuracy: num(input.accuracy),
    speed: num(input.speed),
    heading: num(input.heading),
    at: input.at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    route_id: input.route_id ?? null,
  };
  await getDb().collection(COLLECTION).doc(username).set(pos);
}

export async function listVehiclePositions(): Promise<VehiclePosition[]> {
  const snap = await getDb().collection(COLLECTION).get();
  return snap.docs.map((d) => d.data() as VehiclePosition);
}
