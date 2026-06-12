'use client';

import { useEffect, useState } from 'react';
import { getStockUpdated } from '@/lib/api';

// Снимок остатков живёт 4 часа (совпадает с STOCK_TTL_MS на сервере).
const TTL_MS = 4 * 60 * 60 * 1000;

function ago(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  return `${h} ч ${min % 60} мин назад`;
}

function countdown(msLeft: number): string {
  if (msLeft <= 0) return 'обновится при следующем открытии';
  const total = Math.floor(msLeft / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// Подпись «Остатки обновлены … назад» + обратный отсчёт до следующего обновления.
export default function StockUpdated({ className = '' }: { className?: string }) {
  const [ms, setMs] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    getStockUpdated().then(v => { if (alive) setMs(v); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Тикаем раз в секунду — живой обратный отсчёт.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!ms) return null;

  const left = ms + TTL_MS - now;
  const exact = new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <span className={`text-[11px] text-gray-400 ${className}`} title={`Снимок: ${exact}`}>
      🕒 Обновлено {ago(ms)} · до обновления {countdown(left)}
    </span>
  );
}
