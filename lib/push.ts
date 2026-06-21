import webpush from 'web-push';
import { getDb } from './firebase';

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails('mailto:admin@taminotweb.local', pub, priv);
  configured = true;
  return true;
}

export async function savePushSubscription(username: string, sub: PushSubscriptionJSON): Promise<void> {
  const db = getDb();
  const ref = db.collection('users').doc(username);
  const snap = await ref.get();
  const existing = (snap.data()?.push_subscriptions as PushSubscriptionJSON[]) || [];
  if (existing.some((s) => s.endpoint === sub.endpoint)) return;
  await ref.set({ push_subscriptions: [...existing, sub] }, { merge: true });
}

// Отправка push конкретному пользователю (все его подписки/устройства).
// Тихо ничего не делает, если VAPID-ключи не настроены или подписок нет —
// push не критичен для работы приложения.
export async function sendPushToUser(
  username: string,
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  if (!ensureConfigured()) return;
  const db = getDb();
  const ref = db.collection('users').doc(username);
  const snap = await ref.get();
  const subs = (snap.data()?.push_subscriptions as PushSubscriptionJSON[]) || [];
  if (!subs.length) return;

  const body = JSON.stringify(payload);
  const stale: string[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, body);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) stale.push(sub.endpoint);
      }
    })
  );
  if (stale.length) {
    await ref.set(
      { push_subscriptions: subs.filter((s) => !stale.includes(s.endpoint)) },
      { merge: true }
    );
  }
}

export async function notifyDriverAssigned(username: string, label: string): Promise<void> {
  await sendPushToUser(username, {
    title: '🚚 Новая доставка',
    body: label,
    url: '/logistics/my',
  });
}
