import { useEffect } from 'react';

// Опрашивает callback с заданным интервалом, но только когда вкладка видима —
// экономит чтения Firestore, когда страница открыта в фоне. При возвращении
// на вкладку сразу обновляет данные, не дожидаясь следующего тика.
export function useLivePoll(callback: () => void, intervalMs: number) {
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) callback();
    }, intervalMs);
    const onVisible = () => {
      if (!document.hidden) callback();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [callback, intervalMs]);
}
