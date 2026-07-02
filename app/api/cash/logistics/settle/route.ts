import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { settleDriverCash } from '@/lib/deliveries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Менеджер принял наличные у водителя → все его несданные доставки помечаются
// сданными (архивируются), баланс водителя обнуляется.
export async function POST(request: NextRequest) {
  return withRole('manager', async (user) => {
    const body = await request.json().catch(() => ({}));
    const username = String(body?.username || '').trim();
    if (!username) return Response.json({ error: 'Не указан водитель' }, { status: 400 });
    const res = await settleDriverCash(username, user.name || user.username);
    return Response.json({ data: res });
  });
}
