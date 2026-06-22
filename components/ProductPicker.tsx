'use client';

import { useEffect, useState } from 'react';
import { listProducts, CatalogItem, DeliveryItem } from '@/lib/api';

// Выбор товаров из справочника ТМЦ для заявки «магазин → клиент»:
// поиск по названию/коду, добавление в список с количеством.
export default function ProductPicker({
  items, onChange,
}: {
  items: DeliveryItem[];
  onChange: (items: DeliveryItem[]) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [search, setSearch] = useState('');
  const [showList, setShowList] = useState(false);

  useEffect(() => {
    listProducts().then(setCatalog).catch(() => {});
  }, []);

  const q = search.trim().toLowerCase();
  const results = q.length >= 1
    ? catalog.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)).slice(0, 20)
    : [];

  function addItem(p: CatalogItem) {
    if (items.some((it) => it.code === p.code)) { setSearch(''); setShowList(false); return; }
    onChange([...items, { code: p.code, name: p.name, qty: 1 }]);
    setSearch(''); setShowList(false);
  }
  function setQty(code: string, qty: number) {
    onChange(items.map((it) => (it.code === code ? { ...it, qty: Math.max(1, qty) } : it)));
  }
  function removeItem(code: string) {
    onChange(items.filter((it) => it.code !== code));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setShowList(true); }}
          onFocus={() => setShowList(true)}
          onBlur={() => setTimeout(() => setShowList(false), 150)}
          placeholder="🔍 Товар из справочника (необязательно)"
          autoComplete="off"
          className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
        />
        {showList && results.length > 0 && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
            {results.map((p) => (
              <button key={p.code} type="button" onMouseDown={() => addItem(p)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-50 last:border-0 flex items-center justify-between gap-2">
                <span className="truncate">{p.name}</span>
                {p.price > 0 && <span className="text-[10px] text-gray-400 shrink-0">{p.price.toLocaleString('ru-RU')} сум</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="flex flex-col gap-1">
          {items.map((it) => (
            <div key={it.code} className="flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-1.5 text-xs">
              <span className="flex-1 min-w-0 truncate">{it.name}</span>
              <input type="number" min={1} value={it.qty}
                onChange={(e) => setQty(it.code, Number(e.target.value) || 1)}
                className="w-14 border border-gray-200 rounded px-1.5 py-1 text-xs text-right outline-none focus:border-blue-400" />
              <button type="button" onClick={() => removeItem(it.code)} className="text-red-400 hover:text-red-600 px-1">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
