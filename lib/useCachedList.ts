'use client';

import { useEffect, useState } from 'react';

interface CachedState<T> {
  data: T[];
  loading: boolean;
  error: string;
}

// Показывает список из кэша браузера мгновенно, в фоне обновляет (если устарел).
// freshMs — в течение этого окна повторный заход вообще не дёргает сервер.
export function useCachedList<T>(
  key: string,
  fetcher: () => Promise<T[]>,
  freshMs = 120_000
): CachedState<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    let cachedFresh = false;

    // 1) Мгновенно показываем из кэша.
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const { t, v } = JSON.parse(raw) as { t: number; v: T[] };
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setData(v);
        setLoading(false);
        cachedFresh = Date.now() - t < freshMs;
      }
    } catch {
      // нет/битый кэш — игнорируем
    }

    // 2) Кэш свежий — сервер не трогаем.
    if (cachedFresh) return;

    // 3) Иначе подгружаем и обновляем кэш.
    fetcher()
      .then((v) => {
        if (!alive) return;
        setData(v);
        setLoading(false);
        try {
          sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v }));
        } catch {
          // переполнение sessionStorage — не страшно
        }
      })
      .catch((e) => {
        if (!alive) return;
        setError((e as Error).message);
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [key, fetcher, freshMs]);

  return { data, loading, error };
}
