'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { listProducts, getProductStock, CatalogItem, ProductStock } from '@/lib/api';
import { useCachedList } from '@/lib/useCachedList';
import ProductPhoto from '@/components/ProductPhoto';

export default function ProductDetailPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();

  // Название/ШК берём из каталога (кэш браузера — мгновенно)
  const { data: products } = useCachedList('cache:products_v3', listProducts, 30 * 60 * 1000);
  const item: CatalogItem | undefined = products.find(p => p.code === code);

  const [stock, setStock] = useState<ProductStock | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Фильтр по складам внутри карточки
  const [whQuery, setWhQuery] = useState('');
  const [onlyPositive, setOnlyPositive] = useState(true);
  type SortMode = 'qty_desc' | 'qty_asc' | 'name';
  const [sortMode, setSortMode] = useState<SortMode>('qty_desc');

  useEffect(() => {
    let alive = true;
    getProductStock(code)
      .then(s => { if (alive) setStock(s); })
      .catch(e => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [code]);

  const wq = whQuery.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!stock) return [];
    const filtered = stock.rows
      .filter(r => (onlyPositive ? r.quantity > 0 : true))
      .filter(r => (wq ? r.warehouse_name.toLowerCase().includes(wq) : true));
    return filtered.sort((a, b) => {
      if (sortMode === 'qty_asc') return a.quantity - b.quantity;
      if (sortMode === 'name') return a.warehouse_name.localeCompare(b.warehouse_name, 'ru');
      return b.quantity - a.quantity; // qty_desc
    });
  }, [stock, wq, onlyPositive, sortMode]);

  return (
    <div>
      <button
        onClick={() => router.back()}
        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-600 mb-3"
      >
        ← Назад
      </button>

      {/* Шапка товара */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <ProductPhoto code={code} size="lg" className="mx-auto mb-3" />
        <div>
          <h2 className="font-bold text-base leading-snug">{item?.name || `Товар ${code}`}</h2>
          <p className="text-xs text-gray-400 mt-1">
            Код {code}
            {item?.producer && ` · ${item.producer}`}
          </p>
          {item && item.barcodes.length > 0 && (
            <p className="text-xs text-gray-500 mt-0.5">ШК: {item.barcodes.join(', ')}</p>
          )}
          {stock && stock.wholesale_price > 0 && (
            <p className="mt-2 text-sm">
              💵 Оптовая цена:{' '}
              <strong className="text-emerald-600">
                {stock.wholesale_price.toLocaleString('ru-RU')} сум
              </strong>
            </p>
          )}
        </div>
      </div>

      {/* Остатки */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold">📦 Остатки по складам</span>
          {stock && (
            <span className="text-sm">
              доступно: <strong className="text-green-600">{stock.total}</strong> шт.
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-gray-500 text-sm">
            <span className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
            Загрузка остатков...
          </div>
        ) : error ? (
          <p className="text-red-500 text-sm">{error}</p>
        ) : stock && stock.rows.length > 0 ? (
          <>
            {/* Поиск по складам */}
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                value={whQuery}
                onChange={e => setWhQuery(e.target.value)}
                placeholder="🔍 Поиск по складу..."
                className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm
                           outline-none focus:border-blue-400 transition-colors"
              />
              <button
                onClick={() => setOnlyPositive(v => !v)}
                className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors ${
                  onlyPositive
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                title="Показывать только склады с остатком"
              >
                {onlyPositive ? 'Только с остатком' : 'Все склады'}
              </button>
            </div>

            {/* Сортировка */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-gray-400">Сортировка:</span>
              <select
                value={sortMode}
                onChange={e => setSortMode(e.target.value as SortMode)}
                className="border-2 border-gray-200 rounded-lg px-2 py-1 text-xs bg-white
                           outline-none focus:border-blue-400 transition-colors"
              >
                <option value="qty_desc">Количество ↓</option>
                <option value="qty_asc">Количество ↑</option>
                <option value="name">Название А–Я</option>
              </select>
            </div>

            {rows.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {rows.map((r, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                    <span className="truncate">{r.warehouse_name}</span>
                    <span className="font-bold whitespace-nowrap ml-2">{r.quantity} шт.</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-gray-400 py-6 text-sm">
                {wq ? 'Склад не найден' : 'Нет складов с остатком'}
              </div>
            )}
          </>
        ) : (
          <div className="text-center text-gray-400 py-8 text-sm">Нет остатков на складах</div>
        )}
      </div>
    </div>
  );
}
