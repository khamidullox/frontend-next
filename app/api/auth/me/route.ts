import { getSession, setSessionCookie } from '@/lib/auth';
import { countUsers } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Текущая сессия. Если пользователей ещё нет — отдаём setup_needed (первый запуск).
export async function GET() {
  const session = await getSession();
  if (session) {
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
