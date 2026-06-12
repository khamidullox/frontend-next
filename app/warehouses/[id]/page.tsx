'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { getWarehouseStock, WarehouseStock } from '@/lib/api';

const MAX_SHOWN = 200;
type SortMode = 'qty_desc' | 'qty_asc' | 'name';

export default function WarehouseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [stock, setStock] = useState<WarehouseStock | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('qty_desc');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getWarehouseStock(id)
      .then(s => { if (alive) setStock(s); })
      .catch(e => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!stock) return [];
    const filtered = stock.rows.filter(r =>
      !q ||
      r.product_code.toLowerCase().includes(q) ||
      r.product_name.toLowerCase().includes(q)
    );
    return filtered.sort((a, b) => {
      if (sortMode === 'qty_asc') return a.quantity - b.quantity;
      if (sortMode === 'name') return a.product_name.localeCompare(b.product_name, 'ru');
      return b.quantity - a.quantity;
    });
  }, [stock, q, sortMode]);

  const shown = rows.slice(0, MAX_SHOWN);

  return (
    <div>
      <button
        onClick={() => router.back()}
        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-600 mb-3"
      >
        ← Назад
      </button>

      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <h2 className="font-bold text-base leading-snug">{stock?.warehouse_name || `Склад ${id}`}</h2>
        {stock && (
          <p className="text-xs text-gray-400 mt-1">
            Товаров: {stock.rows.length} · Всего: <strong className="text-green-600">{stock.total}</strong> шт.
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-gray-500 text-sm">
            <span className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
            Загрузка остатков...
          </div>
        ) : error ? (
          <p className="text-red-500 text-sm">{error}</p>
        ) : stock && stock.rows.length > 0 ? (
          <>
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="🔍 Поиск товара..."
                className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm
                           outline-none focus:border-blue-400 transition-colors"
              />
              <select
                value={sortMode}
                onChange={e => setSortMode(e.target.value as SortMode)}
                className="border-2 border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white
                           outline-none focus:border-blue-400 transition-colors"
              >
                <option value="qty_desc">Кол-во ↓</option>
                <option value="qty_asc">Кол-во ↑</option>
                <option value="name">Название</option>
              </select>
            </div>

            {q && (
              <p className="text-xs text-gray-400 mb-2">
                Найдено: {rows.length}
                {rows.length > MAX_SHOWN && ` (показано ${MAX_SHOWN})`}
              </p>
            )}

            {shown.length === 0 ? (
              <div className="text-center text-gray-400 py-6 text-sm">Товар не найден</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {shown.map(r => (
                  <Link
                    key={r.product_code}
                    href={`/products/${encodeURIComponent(r.product_code)}`}
                    className="flex items-center justify-between bg-gray-50 hover:bg-gray-100 rounded-lg px-3 py-2 text-sm transition-colors"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{r.product_name || '—'}</span>
                      <span className="text-[11px] text-gray-400">Код {r.product_code}</span>
                    </span>
                    <span className="font-bold whitespace-nowrap ml-2">{r.quantity} шт.</span>
                  </Link>
                ))}
              </div>
            )}
            {!q && rows.length > MAX_SHOWN && (
              <p className="text-xs text-gray-400 mt-3 text-center">
                Показаны первые {MAX_SHOWN}. Введите запрос для поиска по всем {rows.length}.
              </p>
            )}
          </>
        ) : (
          <div className="text-center text-gray-400 py-8 text-sm">На складе нет остатков</div>
        )}
      </div>
    </div>
  );
}
