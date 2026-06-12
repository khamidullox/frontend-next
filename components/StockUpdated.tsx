'use client';

import { useEffect, useState } from 'react';
import { getStockUpdated } from '@/lib/api';

function relative(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч ${min % 60} мин назад`;
  const d = Math.floor(h / 24);
  return `${d} дн назад`;
}

// Подпись «Остатки обновлены … назад» — берёт время снимка из Firestore.
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
      🕒 Остатки обновлены {relative(ms)}
    </span>
  );
}
