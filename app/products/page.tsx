'use client';

import { useState, useMemo, useEffect } from 'react';
import { listProducts, getProductStock, CatalogItem, ProductStock } from '@/lib/api';
import { useCachedList } from '@/lib/useCachedList';

const MAX_SHOWN = 100;

function StockDialog({ item, onClose }: { item: CatalogItem; onClose: () => void }) {
  const [stock, setStock] = useState<ProductStock | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    getProductStock(item.code)
      .then(s => { if (alive) setStock(s); })
      .catch(e => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [item.code]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5 w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-sm leading-tight">{item.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5">Код {item.code}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>

        {item.barcodes.length > 0 && (
          <p className="text-xs text-gray-500 mb-3">ШК: {item.barcodes.join(', ')}</p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-gray-500 text-sm">
            <span className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
            Загрузка остатков...
          </div>
        ) : error ? (
          <p className="text-red-500 text-sm">{error}</p>
        ) : stock && stock.rows.length > 0 ? (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold">📦 Остатки</span>
              <span className="text-sm">
                всего: <strong className="text-green-600">{stock.total}</strong> шт.
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {stock.rows.map((r, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                  <span className="truncate">{r.warehouse_name}</span>
                  <span className="font-bold whitespace-nowrap ml-2">{r.quantity} шт.</span>
                </div>
              ))}
            </div>
            {stock.input_price > 0 && (
              <p className="text-xs text-gray-500 mt-3">
                Цена прихода: {stock.input_price.toLocaleString('ru-RU')} сум
              </p>
            )}
          </>
        ) : (
          <div className="text-center text-gray-400 py-8 text-sm">
            Нет остатков на складах
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProductsPage() {
  const { data: products, loading, error } = useCachedList(
    'cache:products',
    listProducts,
    30 * 60 * 1000
  );
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CatalogItem | null>(null);

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
                <button
                  key={p.code}
                  onClick={() => setSelected(p)}
                  className="bg-white rounded-lg shadow-sm px-3 py-2 flex items-center gap-3 text-left
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
                </button>
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

      {selected && <StockDialog item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
