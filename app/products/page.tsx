'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { listProducts } from '@/lib/api';
import { useCachedList } from '@/lib/useCachedList';

const MAX_SHOWN = 100;

export default function ProductsPage() {
  const { data: products, loading, error } = useCachedList(
    'cache:products',
    listProducts,
    30 * 60 * 1000
  );
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return products;
    return products.filter(p =>
      p.code.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      p.barcodes.some(b => b.includes(q))
    );
  }, [products, q]);

  const shown = filtered.slice(0, MAX_SHOWN);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xl font-bold">📚 Справочник товаров</h2>
        <span className="text-sm text-gray-400">{loading ? '…' : `${products.length} шт.`}</span>
      </div>

      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="🔍 Поиск по названию, коду или штрихкоду..."
        autoFocus
        className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm mb-4
                   outline-none focus:border-blue-400 transition-colors"
      />

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh] gap-3 text-gray-500">
          <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          Загрузка справочника...
        </div>
      ) : (
        <>
          {q && (
            <p className="text-xs text-gray-400 mb-2">
              Найдено: {filtered.length}
              {filtered.length > MAX_SHOWN && ` (показано первых ${MAX_SHOWN})`}
            </p>
          )}
          {shown.length === 0 ? (
            <div className="bg-white rounded-xl p-8 text-center text-gray-400">Ничего не найдено</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {shown.map(p => (
                <Link
                  key={p.code}
                  href={`/products/${encodeURIComponent(p.code)}`}
                  className="bg-white rounded-lg shadow-sm px-3 py-2 flex items-center gap-3
                             hover:ring-2 hover:ring-blue-200 transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-[13px] leading-tight truncate">{p.name || '—'}</div>
                    <div className="text-[11px] text-gray-400 truncate">
                      Код {p.code}
                      {p.producer && ` · ${p.producer}`}
                      {p.barcodes.length > 0 && ` · ШК ${p.barcodes.join(', ')}`}
                    </div>
                  </div>
                  <span className="text-blue-400 text-base">📦</span>
                </Link>
              ))}
            </div>
          )}
          {!q && products.length > MAX_SHOWN && (
            <p className="text-xs text-gray-400 mt-3 text-center">
              Показаны первые {MAX_SHOWN}. Введите запрос для поиска по всем {products.length}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
