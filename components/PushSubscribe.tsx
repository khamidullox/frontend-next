'use client';

import { useEffect } from 'react';
import { subscribePush } from '@/lib/api';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}

// Подписывает текущего пользователя на push-уведомления (новая назначенная доставка).
// Не критично для работы приложения — любая ошибка молча игнорируется.
export default function PushSubscribe() {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key) return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;

    (async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          const perm = await Notification.requestPermission();
          if (perm !== 'granted') return;
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key),
          });
        }
        const json = sub.toJSON();
        if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
          await subscribePush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
        }
      } catch {
        // push не критичен — игнорируем
      }
    })();
  }, []);

  return null;
}
