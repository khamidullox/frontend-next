import { NextRequest } from 'next/server';
import { deleteUser, setPassword } from '@/lib/users';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Смена пароля пользователя (только админ).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  return withRole('admin', async () => {
    const { username } = await params;
    const { password } = await request.json().catch(() => ({}));
    const res = await setPassword(username, String(password || ''));
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    return Response.json({ ok: true });
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  return withRole('admin', async (session) => {
    const { username } = await params;
    if (username.toLowerCase() === session.username.toLowerCase()) {
      return Response.json({ error: 'Нельзя удалить самого себя' }, { status: 400 });
    }
    await deleteUser(username);
    return Response.json({ ok: true });
  });
}
