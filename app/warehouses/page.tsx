'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { listWarehouses } from '@/lib/api';
import { useCachedList } from '@/lib/useCachedList';
import StockUpdated from '@/components/StockUpdated';

export default function WarehousesPage() {
  const { data: warehouses, loading, error } = useCachedList(
    'cache:warehouses',
    listWarehouses,
    30 * 60 * 1000
  );
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return warehouses;
    return warehouses.filter(w =>
      w.warehouse_name.toLowerCase().includes(q) ||
      w.warehouse_id.toLowerCase().includes(q)
    );
  }, [warehouses, q]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h2 className="text-xl font-bold">🏬 Остатки по складам</h2>
        <span className="text-sm text-gray-400">{loading ? '…' : `${warehouses.length} складов`}</span>
      </div>
      <div className="mb-3"><StockUpdated /></div>

      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="🔍 Поиск по складу..."
        autoFocus
        className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm mb-4
                   outline-none focus:border-blue-400 transition-colors"
      />

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh] gap-3 text-gray-500">
          <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          Загрузка складов...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">Ничего не найдено</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.map(w => (
            <Link
              key={w.warehouse_id}
              href={`/warehouses/${encodeURIComponent(w.warehouse_id)}`}
              className="bg-white rounded-lg shadow-sm px-3 py-2.5 flex items-center gap-3
                         hover:ring-2 hover:ring-teal-200 transition-all"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm leading-tight truncate">{w.warehouse_name}</div>
                <div className="text-[11px] text-gray-400">
                  Товаров: {w.products_count} · Всего: {w.total_quantity} шт.
                </div>
              </div>
              <span className="text-teal-500 text-base">📦</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
