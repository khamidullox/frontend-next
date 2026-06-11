// Простой кэш в памяти с TTL и дедупликацией параллельных запросов.
// На Vercel живёт в пределах «тёплого» инстанса — повторные запросы в окне
// TTL не дёргают Smartup заново.

interface Entry<T> {
  expiresAt: number;
  value: T;
}

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value;
  }

  // Уже выполняется такой же запрос — ждём его, а не запускаем второй.
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;

  const promise = fn()
    .then((value) => {
      store.set(key, { expiresAt: Date.now() + ttlMs, value });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}
