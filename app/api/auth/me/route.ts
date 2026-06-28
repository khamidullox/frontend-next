import { getSession, setSessionCookie } from '@/lib/auth';
import { countUsers, getUserRaw } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Текущая сессия. Если пользователей ещё нет — отдаём setup_needed (первый запуск).
export async function GET() {
  const session = await getSession();
  if (session) {
    // Права (features) и язык могли поменять в карточке после входа — подтягиваем
    // свежие из базы, чтобы изменения применялись без перелогина (cookie держит старое).
    try {
      const u = await getUserRaw(session.username);
      if (u) {
        session.features = u.features && typeof u.features === 'object' ? u.features : {};
        session.language = u.language === 'uz' ? 'uz' : 'ru';
      }
    } catch { /* база недоступна — отдаём что есть из cookie */ }
    // Скользящее продление: при каждом заходе обновляем срок cookie на год.
    await setSessionCookie(session);
    return Response.json({ session });
  }
  let setup_needed = false;
  try {
    setup_needed = (await countUsers()) === 0;
  } catch {
    // Firestore недоступна — не блокируем
  }
  return Response.json({ session: null, setup_needed });
}
