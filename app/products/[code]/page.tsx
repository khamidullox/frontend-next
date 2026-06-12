'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { listProducts, getProductStock, CatalogItem, ProductStock } from '@/lib/api';
import { useCachedList } from '@/lib/useCachedList';

export default function ProductDetailPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();

  // Название/ШК берём из каталога (кэш браузера — мгновенно)
  const { data: products } = useCachedList('cache:products', listProducts, 30 * 60 * 1000);
  const item: CatalogItem | undefined = products.find(p => p.code === code);

  const [stock, setStock] = useState<ProductStock | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    getProductStock(code)
      .then(s => { if (alive) setStock(s); })
      .catch(e => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [code]);

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
        <h2 className="font-bold text-base leading-snug">{item?.name || `Товар ${code}`}</h2>
        <p className="text-xs text-gray-400 mt-1">
          Код {code}
          {item?.producer && ` · ${item.producer}`}
        </p>
        {item && item.barcodes.length > 0 && (
          <p className="text-xs text-gray-500 mt-0.5">ШК: {item.barcodes.join(', ')}</p>
        )}
      </div>

      {/* Остатки */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold">📦 Остатки по складам</span>
          {stock && (
            <span className="text-sm">
              всего: <strong className="text-green-600">{stock.total}</strong> шт.
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
          <div className="flex flex-col gap-1.5">
            {stock.rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                <span className="truncate">{r.warehouse_name}</span>
                <span className="font-bold whitespace-nowrap ml-2">{r.quantity} шт.</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-gray-400 py-8 text-sm">Нет остатков на складах</div>
        )}
      </div>
    </div>
  );
}
