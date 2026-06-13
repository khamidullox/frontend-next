'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getWarehouseStock, WarehouseStock } from '@/lib/api';
import StockUpdated from '@/components/StockUpdated';

const PAGE_SIZE = 50;
type SortMode = 'qty_desc' | 'qty_asc' | 'name' | 'group';

export default function WarehouseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [stock, setStock] = useState<WarehouseStock | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('group');
  const [page, setPage] = useState(1);

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
      r.product_name.toLowerCase().includes(q) ||
      r.producer.toLowerCase().includes(q) ||
      r.group.toLowerCase().includes(q)
    );
    return filtered.sort((a, b) => {
      if (sortMode === 'qty_asc') return a.quantity - b.quantity;
      if (sortMode === 'name') return a.product_name.localeCompare(b.product_name, 'ru');
      if (sortMode === 'group') {
        // по группе, внутри группы — по убыванию остатка
        return a.group.localeCompare(b.group, 'ru', { numeric: true }) || b.quantity - a.quantity;
      }
      return b.quantity - a.quantity;
    });
  }, [stock, q, sortMode]);

  // Пагинация: при смене поиска/сортировки возвращаемся на первую страницу.
  useEffect(() => { setPage(1); }, [q, sortMode]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function goToPage(p: number) {
    setPage(Math.min(totalPages, Math.max(1, p)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const pagination = totalPages > 1 && (
    <div className="flex items-center justify-center gap-3 my-3">
      <button
        onClick={() => goToPage(safePage - 1)}
        disabled={safePage <= 1}
        className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm
                   disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ← Назад
      </button>
      <span className="text-sm text-gray-500">Стр. {safePage} из {totalPages}</span>
      <button
        onClick={() => goToPage(safePage + 1)}
        disabled={safePage >= totalPages}
        className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm
                   disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Вперёд →
      </button>
    </div>
  );

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
            Товаров: {stock.rows.length} · Доступно: <strong className="text-green-600">{stock.total}</strong> шт.
          </p>
        )}
        <div className="mt-1"><StockUpdated /></div>
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
                <option value="qty_desc">Остаток ↓</option>
                <option value="qty_asc">Остаток ↑</option>
                <option value="name">Название</option>
                <option value="group">Группа</option>
              </select>
            </div>

            <p className="text-xs text-gray-400 mb-2">
              {q ? `Найдено: ${rows.length}` : `Всего позиций: ${rows.length}`}
            </p>

            {pageRows.length === 0 ? (
              <div className="text-center text-gray-400 py-6 text-sm">Товар не найден</div>
            ) : (
              <>
                {/* Пагинация сверху */}
                {pagination}

                {/* Шапка таблицы */}
                <div className="grid grid-cols-[minmax(0,1fr)_58px_84px_72px_48px] gap-2 px-2 pb-1.5 mb-1
                                text-[11px] font-semibold text-gray-400 border-b border-gray-200">
                  <span>Название</span>
                  <span className="text-center">Бренд</span>
                  <span className="text-center">Вид</span>
                  <span className="text-right">Цена</span>
                  <span className="text-right">Остаток</span>
                </div>

                <div className="flex flex-col">
                  {pageRows.map(r => (
                    <div
                      key={r.product_code}
                      className="grid grid-cols-[minmax(0,1fr)_58px_84px_72px_48px] gap-2 items-center
                                 px-2 py-2 text-sm border-b border-gray-100 last:border-0"
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{r.product_name || '—'}</span>
                        <span className="block text-[11px] text-gray-400">Код {r.product_code}</span>
                      </span>
                      <span className="text-center text-xs text-gray-500 truncate">{r.producer || '—'}</span>
                      <span className="text-center text-xs text-gray-500 truncate">{r.group || '—'}</span>
                      <span className="text-right text-xs text-emerald-700 whitespace-nowrap">
                        {r.price > 0 ? r.price.toLocaleString('ru-RU') : '—'}
                      </span>
                      <span className="text-right font-bold whitespace-nowrap">{r.quantity}</span>
                    </div>
                  ))}
                </div>

                {/* Пагинация снизу */}
                {pagination}
              </>
            )}
          </>
        ) : (
          <div className="text-center text-gray-400 py-8 text-sm">На складе нет остатков</div>
        )}
      </div>
    </div>
  );
}
