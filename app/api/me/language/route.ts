import { NextRequest } from 'next/server';
import { getSession, setSessionCookie } from '@/lib/auth';
import { setLanguage } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Любой авторизованный пользователь может сменить язык интерфейса себе — в
// отличие от логина/пароля, тут не нужны права админа и не ломаются никакие
// внешние ссылки. Куку сразу переподписываем с новым языком, чтобы не
// заставлять перезаходить, как при смене логина.
export async function PATCH(request: NextRequest) {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const language = body.language === 'uz' ? 'uz' : body.language === 'ru' ? 'ru' : null;
  if (!language) return Response.json({ error: 'Неверный язык' }, { status: 400 });

  const res = await setLanguage(s.username, language);
  if ('error' in res) return Response.json({ error: res.error }, { status: 400 });

  await setSessionCookie({ ...s, language });
  return Response.json({ ok: true, language });
}
