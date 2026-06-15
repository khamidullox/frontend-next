'use client';

import { useEffect, useMemo, useState } from 'react';
import { listProducts, getProductStock, CatalogItem } from '@/lib/api';
import { useCachedList } from '@/lib/useCachedList';
import { loadJsBarcode, pickBarcode } from '@/lib/barcode';

interface TagItem {
  code: string;
  name: string;
  barcode: string;
  format: string;
  price: number;
  qty: number;
}

type TemplateId = 'grid' | 'label';

const TEMPLATES: Record<TemplateId, { label: string; cols: number; width: string; height: string; pageCss: string }> = {
  grid: {
    label: 'A4 — сетка 3×7 (63.5×38.1мм)',
    cols: 3,
    width: '63.5mm',
    height: '38.1mm',
    pageCss: '@page { size: A4; margin: 15mm 7.5mm; }',
  },
  label: {
    label: 'Термоэтикетка 58×40мм (1 на странице)',
    cols: 1,
    width: '58mm',
    height: '40mm',
    pageCss: '@page { size: 58mm 40mm; margin: 0; }',
  },
};

export default function PriceTagsPage() {
  const { data: products, loading } = useCachedList('cache:products_v2', listProducts, 30 * 60 * 1000);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<TagItem[]>([]);
  const [template, setTemplate] = useState<TemplateId>('grid');
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState('');

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    return products.filter(p =>
      p.code.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      p.barcodes.some(b => b.includes(q))
    ).slice(0, 20);
  }, [products, q]);

  async function addItem(p: CatalogItem) {
    if (items.some(i => i.code === p.code)) return;
    setAdding(p.code);
    setError('');
    try {
      const stock = await getProductStock(p.code);
      const { value, format } = pickBarcode(p.code, p.barcodes);
      setItems(prev => [...prev, {
        code: p.code, name: p.name, barcode: value, format,
        price: stock.wholesale_price || 0, qty: 1,
      }]);
      setQuery('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(null);
    }
  }

  function updateItem(code: string, patch: Partial<TagItem>) {
    setItems(prev => prev.map(i => (i.code === code ? { ...i, ...patch } : i)));
  }

  function removeItem(code: string) {
    setItems(prev => prev.filter(i => i.code !== code));
  }

  // Каждая копия ценника — отдельная запись для печати
  const tags = useMemo(() => {
    const out: TagItem[] = [];
    for (const item of items) {
      for (let i = 0; i < Math.max(1, item.qty); i++) out.push(item);
    }
    return out;
  }, [items]);

  // Рисуем штрихкоды в SVG после загрузки JsBarcode
  useEffect(() => {
    let alive = true;
    loadJsBarcode().then(JsBarcode => {
      if (!alive) return;
      tags.forEach((tag, idx) => {
        const el = document.getElementById(`tag-bc-${idx}`);
        if (!el) return;
        try {
          JsBarcode(el, tag.barcode, { format: tag.format, displayValue: false, margin: 0, height: 40 });
        } catch {
          try {
            JsBarcode(el, tag.barcode, { format: 'CODE128', displayValue: false, margin: 0, height: 40 });
          } catch {
            // невалидный штрихкод — оставляем пустым
          }
        }
      });
    }).catch(e => setError((e as Error).message));
    return () => { alive = false; };
  }, [tags]);

  // CSS текущего шаблона для печати
  useEffect(() => {
    const styleId = 'price-tag-print-style';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    const t = TEMPLATES[template];
    styleEl.textContent = `
      ${t.pageCss}
      @media print {
        .price-tags-sheet { gap: 0 !important; }
        .price-tag { width: ${t.width}; height: ${t.height}; border: none !important; page-break-inside: avoid; }
        ${template === 'label' ? '.price-tag { page-break-after: always; }' : ''}
      }
    `;
    return () => { styleEl?.remove(); };
  }, [template]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2 print:hidden">
        <h2 className="text-xl font-bold">🏷️ Ценники и штрихкоды</h2>
      </div>

      <div className="print:hidden">
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Шаблон печати</label>
          <select
            value={template}
            onChange={e => setTemplate(e.target.value as TemplateId)}
            className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400 transition-colors"
          >
            {Object.entries(TEMPLATES).map(([id, t]) => (
              <option key={id} value={id}>{t.label}</option>
            ))}
          </select>
        </div>

        <div className="relative mb-3">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={loading ? 'Загрузка справочника...' : '🔍 Найти товар по названию, коду или штрихкоду...'}
            disabled={loading}
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-400 transition-colors disabled:bg-gray-50"
          />
          {results.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-100 max-h-72 overflow-y-auto">
              {results.map(p => {
                const added = items.some(i => i.code === p.code);
                return (
                  <button
                    key={p.code}
                    onClick={() => addItem(p)}
                    disabled={adding === p.code || added}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center gap-2 disabled:opacity-50 border-b border-gray-50 last:border-0"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium truncate">{p.name || '—'}</div>
                      <div className="text-[11px] text-gray-400 truncate">
                        Код {p.code}{p.barcodes.length > 0 && ` · ШК ${p.barcodes.join(', ')}`}
                      </div>
                    </div>
                    {added ? (
                      <span className="text-green-500 text-xs whitespace-nowrap">добавлено</span>
                    ) : (
                      <span className="text-blue-500 text-lg">{adding === p.code ? '⏳' : '+'}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        {items.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center text-gray-400 mb-3">
            Добавьте товары для печати ценников
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm p-3 mb-3 flex flex-col gap-2">
            {items.map(item => (
              <div key={item.code} className="flex items-center gap-2 border-b border-gray-100 last:border-0 pb-2 last:pb-0">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{item.name || '—'}</div>
                  <div className="text-[11px] text-gray-400 truncate">Код {item.code} · ШК {item.barcode}</div>
                </div>
                <input
                  type="number"
                  min={0}
                  value={item.price}
                  onChange={e => updateItem(item.code, { price: Number(e.target.value) || 0 })}
                  title="Цена"
                  className="w-24 border-2 border-gray-200 rounded-lg px-2 py-1 text-sm text-right outline-none focus:border-blue-400"
                />
                <input
                  type="number"
                  min={1}
                  value={item.qty}
                  onChange={e => updateItem(item.code, { qty: Math.max(1, Number(e.target.value) || 1) })}
                  title="Количество ценников"
                  className="w-16 border-2 border-gray-200 rounded-lg px-2 py-1 text-sm text-right outline-none focus:border-blue-400"
                />
                <button onClick={() => removeItem(item.code)} className="text-red-400 hover:text-red-600 px-1 text-lg">✕</button>
              </div>
            ))}
          </div>
        )}

        {items.length > 0 && (
          <button
            onClick={() => window.print()}
            className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors mb-4"
          >
            🖨️ Печать ({tags.length} шт.)
          </button>
        )}
      </div>

      {tags.length > 0 && (
        <div
          className="price-tags-sheet grid gap-2 mt-2 justify-center"
          style={{ gridTemplateColumns: `repeat(${TEMPLATES[template].cols}, ${TEMPLATES[template].width})` }}
        >
          {tags.map((tag, idx) => (
            <div
              key={idx}
              className="price-tag border border-dashed border-gray-300 rounded flex flex-col items-center justify-between p-1.5 overflow-hidden"
              style={{ width: TEMPLATES[template].width, height: TEMPLATES[template].height }}
            >
              <div className="text-[10px] leading-tight text-center font-medium w-full truncate">{tag.name || tag.code}</div>
              <div className="text-lg font-bold whitespace-nowrap">{tag.price > 0 ? `${tag.price.toLocaleString('ru-RU')} сум` : ''}</div>
              <svg id={`tag-bc-${idx}`} className="w-full" />
              <div className="text-[9px] text-gray-400">{tag.code}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
