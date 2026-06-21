import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { savePushSubscription } from '@/lib/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Сохраняет push-подписку браузера водителя для дальнейшей отправки уведомлений.
export async function POST(request: NextRequest) {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
    return Response.json({ error: 'Некорректная подписка' }, { status: 400 });
  }
  await savePushSubscription(s.username, {
    endpoint: body.endpoint,
    keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
  });
  return Response.json({ ok: true });
}
