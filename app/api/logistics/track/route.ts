import { NextRequest } from 'next/server';
import { getSession, withRole } from '@/lib/auth';
import { upsertVehiclePosition, listVehiclePositions } from '@/lib/vehiclePositions';
import { getActiveRouteForDriver } from '@/lib/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Водитель отправляет свою текущую позицию (раз в N секунд со страницы /logistics/my).
export async function POST(request: NextRequest) {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });
  if (s.role !== 'driver') return Response.json({ error: 'Недостаточно прав' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: 'Координаты не указаны' }, { status: 400 });
  }

  const route = await getActiveRouteForDriver(s.username);
  await upsertVehiclePosition({
    username: s.username,
    driver_name: s.name,
    lat,
    lng,
    accuracy: body.accuracy,
    speed: body.speed,
    heading: body.heading,
    at: typeof body.at === 'string' ? body.at : undefined,
    route_id: route?.id ?? null,
  });
  return Response.json({ ok: true });
}

// Менеджер/админ видит позиции всех машин (для карты).
export async function GET() {
  return withRole('manager', async () => {
    return Response.json({ data: await listVehiclePositions() });
  });
}
