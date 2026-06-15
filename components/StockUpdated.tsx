'use client';

import { useEffect, useState } from 'react';
import { getStockUpdated } from '@/lib/api';

function ago(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  return `${h} ч ${min % 60} мин назад`;
}

// Подпись «Остатки обновлены … назад».
export default function StockUpdated({ className = '' }: { className?: string }) {
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    getStockUpdated().then(v => { if (alive) setMs(v); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!ms) return null;

  const exact = new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <span className={`text-[11px] text-gray-400 ${className}`} title={`Снимок: ${exact}`}>
      🕒 Обновлено {ago(ms)}
    </span>
  );
}
