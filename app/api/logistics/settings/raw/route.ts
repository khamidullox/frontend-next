import { getSession, ROLE_RANK } from '@/lib/auth';
import { getDb } from '@/lib/firebase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Отладка: сырой документ settings/logistics из Firestore, без миграций/переводов
// ключей (__default__<->DEFAULT) — чтобы видеть, что реально лежит в базе, минуя
// все слои lib/settings.ts. Только админ.
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });
  if (ROLE_RANK[s.role] < ROLE_RANK['admin']) {
    return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  }
  const snap = await getDb().collection('settings').doc('logistics').get();
  return Response.json({
    exists: snap.exists,
    id: snap.id,
    data: snap.exists ? snap.data() : null,
    update_time: snap.updateTime?.toDate().toISOString() ?? null,
  });
}
