'use client';

import { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { listProducts } from '@/lib/api';
import { useCachedList } from '@/lib/useCachedList';
import CameraScanner, { isCameraScanSupported } from '@/components/CameraScanner';

const PAGE_SIZE = 50;

export default function ProductsPage() {
  return (
    <Suspense>
      <ProductsContent />
    </Suspense>
  );
}

function ProductsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: products, loading, error } = useCachedList(
    'cache:products_v3',
    listProducts,
    30 * 60 * 1000
  );
  const [query, setQuery] = useState(() => searchParams.get('q') || '');
  const [producer, setProducer] = useState(() => searchParams.get('p') || '');
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const [page, setPage] = useState(1);

  // Синхронизируем поиск с URL — чтобы при возврате назад поиск сохранялся
  const updateUrl = useCallback((q: string, p: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (p) params.set('p', p);
    const qs = params.toString();
    router.replace(qs ? `/products?${qs}` : '/products', { scroll: false });
  }, [router]);

  function onQueryChange(v: string) {
    setQuery(v);
    setPage(1);
    updateUrl(v, producer);
  }

  function onProducerChange(v: string) {
    setProducer(v);
    setPage(1);
    updateUrl(query, v);
  }

  // Поиск товара по штрихкоду (для сканера USB/камеры)
  function gotoByBarcode(raw: string): boolean {
    const code = raw.trim();
    if (!code) return false;
    const hit = products.find(p => p.barcodes.some(b => b === code))
      || products.find(p => p.code === code);
    if (hit) {
      router.push(`/products/${encodeURIComponent(hit.code)}`);
      return true;
    }
    return false;
  }

  function onCameraDetected(code: string) {
    setScanning(false);
    if (!gotoByBarcode(code)) {
      onQueryChange(code);
      setScanMsg(`Штрихкод ${code} не найден в справочнике`);
    }
  }

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      // USB-сканер вводит ШК и жмёт Enter
      if (gotoByBarcode(query)) return;
    }
  }

  // Список производителей для фильтра
  const producers = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.producer) set.add(p.producer);
    return Array.from(set).sort();
  }, [products]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    return products.filter(p => {
      if (producer && p.producer !== producer) return false;
      if (!q) return true;
      return (
        p.code.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.barcodes.some(b => b.includes(q))
      );
    });
  }, [products, q, producer]);

  useEffect(() => { setPage(1); }, [q, producer]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const shown = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function goToPage(p: number) {
    setPage(Math.min(totalPages, Math.max(1, p)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const pagination = totalPages > 1 && (
    <div className="flex items-center justify-center gap-3 my-3">
      <button onClick={() => goToPage(safePage - 1)} disabled={safePage <= 1}
        className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm disabled:opacity-40 disabled:cursor-not-allowed">
        ← Назад
      </button>
      <span className="text-sm text-gray-500">Стр. {safePage} из {totalPages}</span>
      <button onClick={() => goToPage(safePage + 1)} disabled={safePage >= totalPages}
        className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm disabled:opacity-40 disabled:cursor-not-allowed">
        Вперёд →
      </button>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xl font-bold">📚 Справочник товаров</h2>
        <span className="text-sm text-gray-400">{loading ? '…' : `${products.length} шт.`}</span>
      </div>

      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={query}
          onChange={e => { onQueryChange(e.target.value); setScanMsg(''); }}
          onKeyDown={onSearchKey}
          placeholder="🔍 Поиск или сканируйте штрихкод..."
          autoFocus
          className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm
                     outline-none focus:border-blue-400 transition-colors"
        />
        {isCameraScanSupported() && (
          <button
            onClick={() => { setScanMsg(''); setScanning(true); }}
            title="Сканировать камерой"
            className="px-3 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-lg"
          >
            📷
          </button>
        )}
      </div>

      {scanMsg && <p className="text-amber-600 text-xs mb-3">{scanMsg}</p>}

      {producers.length > 1 && (
        <select
          value={producer}
          onChange={e => onProducerChange(e.target.value)}
          className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm mb-4
                     outline-none focus:border-blue-400 transition-colors bg-white"
        >
          <option value="">🏭 Все производители</option>
          {producers.map(pr => (
            <option key={pr} value={pr}>{pr}</option>
          ))}
        </select>
      )}

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh] gap-3 text-gray-500">
          <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          Загрузка справочника...
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400 mb-2">
            {q || producer ? `Найдено: ${filtered.length}` : `Всего: ${filtered.length}`}
          </p>
          {pagination}
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
                  {p.price > 0 && (
                    <span className="text-[13px] font-semibold text-emerald-700 whitespace-nowrap">
                      {p.price.toLocaleString('ru-RU')}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
          {pagination}
        </>
      )}

      {scanning && (
        <CameraScanner onDetected={onCameraDetected} onClose={() => setScanning(false)} />
      )}
    </div>
  );
}
