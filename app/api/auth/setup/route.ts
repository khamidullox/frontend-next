import { NextRequest } from 'next/server';
import { countUsers, createUser } from '@/lib/users';
import { setSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Создание ПЕРВОГО админа — работает только пока пользователей нет.
export async function POST(request: NextRequest) {
  try {
    if ((await countUsers()) > 0) {
      return Response.json({ error: 'Настройка уже завершена' }, { status: 403 });
    }
    const { username, name, password } = await request.json().catch(() => ({}));
    const res = await createUser({
      username: String(username || ''),
      name: String(name || ''),
      role: 'admin',
      password: String(password || ''),
    });
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });

    const uname = String(username).trim().toLowerCase();
    await setSessionCookie({ username: uname, name: String(name || uname), role: 'admin' });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
