import { getSession } from '@/lib/auth';
import { getUserRaw } from '@/lib/users';
import { getLogisticsSettings, defaultCapacity } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Своя вместимость (для строки «насколько я загружен» на /logistics/my) — водитель
// видит только себя, не весь список (тот эндпоинт менеджерский, /api/drivers).
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });
  if (s.role !== 'driver') return Response.json({ error: 'Только для водителей' }, { status: 403 });

  const [user, settings] = await Promise.all([getUserRaw(s.username), getLogisticsSettings()]);
  const def = defaultCapacity(user?.transport, settings);
  const capacity_kg = user?.capacity_kg && user.capacity_kg > 0 ? user.capacity_kg : def.kg;
  const capacity_m3 = user?.capacity_m3 && user.capacity_m3 > 0 ? user.capacity_m3 : def.m3;
  return Response.json({ data: { capacity_kg, capacity_m3, transport: user?.transport || null } });
}
