import { NextRequest } from 'next/server';
import { getUserRaw } from '@/lib/users';
import { verifyPassword, setSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json().catch(() => ({}));
    const user = await getUserRaw(String(username || ''));
    if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
      return Response.json({ error: 'Неверный логин или пароль' }, { status: 401 });
    }
    const warehouses = Array.isArray(user.warehouses) ? user.warehouses : [];
    const session = { username: user.username, name: user.name, role: user.role, warehouses, shop_id: user.shop_id || undefined };
    await setSessionCookie(session);
    return Response.json(session);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
