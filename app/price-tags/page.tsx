'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  listProducts, listWarehousesForTags, getWarehouseStock,
  WarehouseProduct,
} from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { useCachedList } from '@/lib/useCachedList';
import { loadJsBarcode, pickBarcode } from '@/lib/barcode';
import { STORES, getStore, pickStoreByWarehouse, monthlyInstallment, INSTALLMENT, StoreBrand } from '@/lib/stores';

type Tab = 'tags' | 'barcodes';

interface PickedRow extends WarehouseProduct {
  copies: number;   // сколько печатать
  barcode: string;
  format: string;
}

const A4_TAG = { width: '190mm', height: '136mm' };          // 2 ценника на лист A4

// Размеры термоэтикеток (по одной на «страницу» термопринтера).
const BC_SIZES: Record<string, { label: string; w: string; h: string }> = {
  '58x40': { label: '58 × 40 мм', w: '58mm', h: '40mm' },
  '56x40': { label: '56 × 40 мм', w: '56mm', h: '40mm' },
  '58x30': { label: '58 × 30 мм', w: '58mm', h: '30mm' },
  '40x30': { label: '40 × 30 мм', w: '40mm', h: '30mm' },
  '30x20': { label: '30 × 20 мм', w: '30mm', h: '20mm' },
};

export default function PriceTagsPage() {
  const { session } = useAuth();
  const isManager = session ? session.role !== 'worker' : false;

  const [tab, setTab] = useState<Tab>('tags');

  // Каталог нужен только чтобы достать штрих-коды по коду товара.
  const { data: catalog } = useCachedList('cache:products_v2', listProducts, 30 * 60 * 1000);
  const barcodeByCode = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of catalog) m.set(c.code, c.barcodes);
    return m;
  }, [catalog]);

  // Склады (бэк сам разруливает по роли: менеджер/админ — все, магазин — свои без основных).
  const { data: warehouses, loading: whLoading } = useCachedList('cache:warehouses_tags', listWarehousesForTags, 2 * 60 * 1000);

  const [whId, setWhId] = useState('');
  useEffect(() => {
    if (!whId && warehouses.length > 0) setWhId(warehouses[0].warehouse_id);
  }, [warehouses, whId]);

  const currentWh = warehouses.find(w => w.warehouse_id === whId);

  // Остатки выбранного склада
  const [stockRows, setStockRows] = useState<WarehouseProduct[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!whId) return;
    let alive = true;
    setStockLoading(true);
    setError('');
    getWarehouseStock(whId)
      .then(s => { if (alive) setStockRows(s.rows); })
      .catch(e => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setStockLoading(false); });
    return () => { alive = false; };
  }, [whId]);

  // Размер термоэтикетки для штрих-кодов (+ свой размер с сохранением в браузере)
  const [bcSize, setBcSize] = useState<string>('58x40');
  const [customW, setCustomW] = useState(58);
  const [customH, setCustomH] = useState(40);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('bc-custom-size');
      if (raw) { const { w, h } = JSON.parse(raw); if (w) setCustomW(w); if (h) setCustomH(h); }
    } catch { /* нет сохранённого */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('bc-custom-size', JSON.stringify({ w: customW, h: customH })); } catch { /* недоступно */ }
  }, [customW, customH]);
  const bcLabel = bcSize === 'custom'
    ? { label: 'Свой', w: `${customW}mm`, h: `${customH}mm` }
    : BC_SIZES[bcSize];

  // Шаблон магазина: по умолчанию подбираем по названию склада. Доступны все шаблоны.
  const [storeId, setStoreId] = useState<string>(STORES[0].id);
  useEffect(() => {
    if (currentWh) setStoreId(pickStoreByWarehouse(currentWh.warehouse_name).id);
  }, [currentWh]);
  const store = getStore(storeId);

  // Фильтры (можно выбирать несколько групп/брендов)
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<Set<string>>(new Set());
  const [brandFilter, setBrandFilter] = useState<Set<string>>(new Set());

  const groupOptions = useMemo(
    () => Array.from(new Set(stockRows.map(r => r.group).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru')),
    [stockRows]
  );
  const brandOptions = useMemo(
    () => Array.from(new Set(stockRows.map(r => r.producer).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru')),
    [stockRows]
  );

  // Отфильтрованный и отсортированный по группе список (плоский, индексы — для диапазонного выделения)
  const q = query.trim().toLowerCase();
  const orderedList = useMemo(() => {
    const rows = stockRows.filter(r =>
      (groupFilter.size === 0 || groupFilter.has(r.group)) &&
      (brandFilter.size === 0 || brandFilter.has(r.producer)) &&
      (!q ||
        r.product_code.toLowerCase().includes(q) ||
        r.product_name.toLowerCase().includes(q) ||
        r.producer.toLowerCase().includes(q) ||
        r.group.toLowerCase().includes(q))
    );
    rows.sort((a, b) =>
      (a.group || '').localeCompare(b.group || '', 'ru', { numeric: true }) ||
      (a.product_name || '').localeCompare(b.product_name || '', 'ru')
    );
    return rows;
  }, [stockRows, groupFilter, brandFilter, q]);

  // Группировка для заголовков с галочкой «вся группа»
  const groups = useMemo(() => {
    const map = new Map<string, { row: WarehouseProduct; index: number }[]>();
    orderedList.forEach((row, index) => {
      const g = row.group || '— Без группы';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push({ row, index });
    });
    return Array.from(map, ([group, items]) => ({ group, items }));
  }, [orderedList]);

  // ── Выделение ──
  const [picked, setPicked] = useState<Record<string, PickedRow>>({});
  const lastIndexRef = useRef<number | null>(null);

  function makePicked(row: WarehouseProduct): PickedRow {
    const codes = barcodeByCode.get(row.product_code) || [];
    const { value, format } = pickBarcode(row.product_code, codes);
    return { ...row, copies: 1, barcode: value, format };
  }
  function setRows(rows: WarehouseProduct[], on: boolean) {
    setPicked(prev => {
      const next = { ...prev };
      for (const r of rows) {
        if (on) { if (!next[r.product_code]) next[r.product_code] = makePicked(r); }
        else delete next[r.product_code];
      }
      return next;
    });
  }
  function rowClick(e: React.MouseEvent, row: WarehouseProduct, index: number) {
    if (e.shiftKey && lastIndexRef.current !== null) {
      const [a, b] = [lastIndexRef.current, index].sort((x, y) => x - y);
      setRows(orderedList.slice(a, b + 1), true); // диапазон — выделяем всё
    } else {
      setRows([row], !picked[row.product_code]);
    }
    lastIndexRef.current = index;
  }
  function setCopies(code: string, copies: number) {
    setPicked(prev => prev[code] ? { ...prev, [code]: { ...prev[code], copies: Math.max(1, copies) } } : prev);
  }
  function setPrice(code: string, price: number) {
    setPicked(prev => prev[code] ? { ...prev, [code]: { ...prev[code], price: Math.max(0, price) } } : prev);
  }

  const allVisibleSelected = orderedList.length > 0 && orderedList.every(r => picked[r.product_code]);
  const someVisibleSelected = orderedList.some(r => picked[r.product_code]);
  const masterState: TriState = allVisibleSelected ? 'all' : someVisibleSelected ? 'some' : 'none';

  const pickedList = useMemo(() => Object.values(picked), [picked]);
  const printItems = useMemo(() => {
    const out: PickedRow[] = [];
    for (const p of pickedList) for (let i = 0; i < Math.max(1, p.copies); i++) out.push(p);
    return out;
  }, [pickedList]);

  // Сброс выделения при смене склада
  useEffect(() => { setPicked({}); lastIndexRef.current = null; }, [whId]);

  // CSS печати
  useEffect(() => {
    const id = 'price-print-style';
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    el.textContent = tab === 'tags'
      ? `@page { size: A4 portrait; margin: 6mm; }
         @media print { .tag { page-break-inside: avoid; } .tag:nth-child(2n) { page-break-after: always; } }`
      : `@page { size: ${bcLabel.w} ${bcLabel.h}; margin: 0; }
         @media print {
           .bc-sheet { display: block !important; gap: 0 !important; }
           .bclabel { width: ${bcLabel.w}; height: ${bcLabel.h}; margin: 0 !important; page-break-after: always; }
           .bclabel:last-child { page-break-after: auto; }
         }`;
    return () => { el?.remove(); };
  }, [tab, bcLabel.w, bcLabel.h]);

  return (
    <div>
      <div className="print:hidden">
        <h2 className="text-xl font-bold mb-3">🏷️ Печать ценников и штрих-кодов</h2>

        <div className="flex gap-2 mb-4">
          <TabBtn active={tab === 'tags'} onClick={() => setTab('tags')}>🏷️ Ценники</TabBtn>
          <TabBtn active={tab === 'barcodes'} onClick={() => setTab('barcodes')}>📊 Штрих-коды</TabBtn>
        </div>

        {/* Склад + шаблон магазина */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              {isManager ? 'Склад' : 'Мой магазин'}
            </label>
            <select
              value={whId}
              onChange={e => setWhId(e.target.value)}
              disabled={whLoading || warehouses.length === 0}
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400"
            >
              {warehouses.length === 0 && <option>{whLoading ? 'Загрузка…' : 'Нет доступных складов'}</option>}
              {warehouses.map(w => (
                <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_name}</option>
              ))}
            </select>
          </div>
          {tab === 'tags' ? (
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Шаблон магазина</label>
              <select
                value={storeId}
                onChange={e => setStoreId(e.target.value)}
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400"
              >
                {STORES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          ) : (
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Размер этикетки (термопринтер)</label>
              <select
                value={bcSize}
                onChange={e => setBcSize(e.target.value)}
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400"
              >
                {Object.entries(BC_SIZES).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
                <option value="custom">Свой размер…</option>
              </select>
              {bcSize === 'custom' && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="number" min={10} max={210} value={customW}
                    onChange={e => setCustomW(Math.max(10, Number(e.target.value) || 0))}
                    title="Ширина, мм"
                    className="w-20 border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right outline-none focus:border-blue-400"
                  />
                  <span className="text-gray-400">×</span>
                  <input
                    type="number" min={10} max={297} value={customH}
                    onChange={e => setCustomH(Math.max(10, Number(e.target.value) || 0))}
                    title="Высота, мм"
                    className="w-20 border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right outline-none focus:border-blue-400"
                  />
                  <span className="text-xs text-gray-400">мм</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Фильтры: группы + бренды (множественный выбор) + поиск */}
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <MultiSelect label="группы" options={groupOptions} selected={groupFilter} onChange={setGroupFilter} />
          <MultiSelect label="бренды" options={brandOptions} selected={brandFilter} onChange={setBrandFilter} />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="🔍 Поиск товара…"
            className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
          />
        </div>

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        {/* Шапка списка: выделить всё + подсказка */}
        {orderedList.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-t-xl border border-b-0 border-gray-100 text-xs text-gray-500">
            <TriCheckbox state={masterState} onClick={() => setRows(orderedList, masterState !== 'all')} />
            <span>Выделить всё ({orderedList.length})</span>
            <span className="ml-auto hidden sm:inline text-gray-400">Shift+клик — выделить диапазон</span>
          </div>
        )}

        {/* Список остатков по группам */}
        <div className="bg-white rounded-b-xl shadow-sm mb-3 max-h-[62vh] overflow-y-auto border border-gray-100">
          {stockLoading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-gray-500 text-sm">
              <span className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              Загрузка остатков…
            </div>
          ) : orderedList.length === 0 ? (
            <div className="text-center text-gray-400 py-8 text-sm">{whId ? 'Нет товаров' : 'Выберите склад'}</div>
          ) : groups.map(g => {
            const gRows = g.items.map(i => i.row);
            const gAll = gRows.every(r => picked[r.product_code]);
            const gSome = gRows.some(r => picked[r.product_code]);
            const gState: TriState = gAll ? 'all' : gSome ? 'some' : 'none';
            return (
              <div key={g.group}>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100/70 sticky top-0 text-[12px] font-semibold text-gray-600">
                  <TriCheckbox state={gState} onClick={() => setRows(gRows, gState !== 'all')} />
                  <span className="truncate">{g.group}</span>
                  <span className="text-gray-400 font-normal">· {g.items.length}</span>
                </div>
                {g.items.map(({ row, index }) => {
                  const checked = !!picked[row.product_code];
                  return (
                    <div
                      key={row.product_code}
                      onClick={e => rowClick(e, row, index)}
                      className={`flex items-center gap-2 px-3 py-2 border-b border-gray-50 last:border-0 cursor-pointer select-none ${
                        checked ? 'bg-blue-50' : 'hover:bg-blue-50/50'
                      }`}
                    >
                      <input type="checkbox" readOnly checked={checked} className="w-4 h-4 accent-blue-600 pointer-events-none" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate">{row.product_name || '—'}</div>
                        <div className="text-[11px] text-gray-400 truncate">
                          Код {row.product_code}{row.producer && ` · ${row.producer}`} · остаток {row.quantity} шт.
                        </div>
                      </div>
                      {checked ? (
                        <>
                          <input
                            type="number" min={0} value={picked[row.product_code].price}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setPrice(row.product_code, Number(e.target.value) || 0)}
                            title="Цена"
                            className="w-24 border-2 border-gray-200 rounded-lg px-1.5 py-1 text-sm text-right outline-none focus:border-blue-400"
                          />
                          <input
                            type="number" min={1} value={picked[row.product_code].copies}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setCopies(row.product_code, Number(e.target.value) || 1)}
                            title="Сколько печатать"
                            className="w-14 border-2 border-gray-200 rounded-lg px-1.5 py-1 text-sm text-right outline-none focus:border-blue-400"
                          />
                        </>
                      ) : (
                        <div className="text-[12px] text-emerald-700 whitespace-nowrap">
                          {row.price > 0 ? row.price.toLocaleString('ru-RU') : '—'}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Счётчик + кнопка печати — сразу после списка */}
        {printItems.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-2 text-xs text-gray-500">
              <span>Выбрано: {pickedList.length} · к печати: {printItems.length}</span>
              <button onClick={() => setPicked({})} className="hover:text-red-500">Очистить</button>
            </div>
            <button
              onClick={() => window.print()}
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors mb-4"
            >
              🖨️ Печать ({printItems.length} шт.)
            </button>
          </>
        )}
      </div>

      {/* ── Область печати ── */}
      {printItems.length > 0 && tab === 'tags' && (
        <div className="flex flex-col items-center gap-2">
          {printItems.map((it, idx) => <PriceTag key={idx} item={it} store={store} />)}
        </div>
      )}

      {printItems.length > 0 && tab === 'barcodes' && (
        <div className="bc-sheet flex flex-col items-center gap-2">
          {printItems.map((it, idx) => (
            <div
              key={idx}
              className="bclabel border-2 border-gray-800 rounded flex flex-col overflow-hidden box-border"
              style={{ width: bcLabel.w, height: bcLabel.h }}
            >
              {/* Верхняя рамка: название + код товара */}
              <div className="border-b-2 border-gray-700 px-1 flex flex-col items-center justify-center text-center overflow-hidden"
                   style={{ flex: '0 0 34%', minHeight: 0 }}>
                <span className="font-bold text-[10px] leading-tight line-clamp-2 break-words">{it.product_name || it.product_code}</span>
                <span className="font-bold text-[14px] leading-none mt-0.5">Код {it.product_code}</span>
              </div>
              {/* Штрихкод (центр) — растянут ровно на свою зону, размер одинаковый */}
              <div className="px-1.5 py-1 flex items-center justify-center overflow-hidden"
                   style={{ flex: '0 0 46%', minHeight: 0 }}>
                <BarcodeSvg value={it.barcode} format={it.format} height={60} width={2} par="none" className="w-full h-full block" />
              </div>
              {/* Нижняя рамка: значение ШК */}
              <div className="border-t-2 border-gray-700 px-1 flex items-center justify-center text-center overflow-hidden"
                   style={{ flex: '0 0 20%', minHeight: 0 }}>
                <span className="font-mono text-[11px] text-gray-900">{it.barcode}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Множественный выбор (группы / бренды)
function MultiSelect({ label, options, selected, onChange }: {
  label: string; options: string[]; selected: Set<string>; onChange: (s: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const title = selected.size === 0 ? `Все ${label}` : `${label}: ${selected.size}`;
  return (
    <div className="relative sm:w-48">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-left flex items-center justify-between gap-1 outline-none focus:border-blue-400"
      >
        <span className="truncate">{title}</span>
        <span className="text-gray-400">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 left-0 right-0 bg-white rounded-lg shadow-lg border border-gray-100 max-h-64 overflow-y-auto">
            {selected.size > 0 && (
              <button
                onClick={() => onChange(new Set())}
                className="w-full text-left px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 border-b border-gray-50"
              >
                Сбросить
              </button>
            )}
            {options.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">Нет вариантов</div>}
            {options.map(o => {
              const on = selected.has(o);
              return (
                <label key={o} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-blue-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const next = new Set(selected);
                      if (on) next.delete(o); else next.add(o);
                      onChange(next);
                    }}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span className="truncate">{o}</span>
                </label>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

type TriState = 'none' | 'some' | 'all';

function TriCheckbox({ state, onClick }: { state: TriState; onClick: () => void }) {
  return (
    <input
      type="checkbox"
      readOnly
      checked={state === 'all'}
      ref={el => { if (el) el.indeterminate = state === 'some'; }}
      onClick={onClick}
      className="w-4 h-4 accent-blue-600 cursor-pointer"
    />
  );
}

// Самостоятельный штрихкод: рисует JsBarcode в свой ref (без рассинхрона по id),
// добавляет viewBox — масштабируется по контейнеру с сохранением пропорций.
function BarcodeSvg({ value, format, height, width, displayValue, className, par = 'xMidYMid meet' }: {
  value: string; format: string; height: number; width: number; displayValue?: boolean; className?: string; par?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let alive = true;
    loadJsBarcode().then(JsBarcode => {
      const el = ref.current;
      if (!alive || !el) return;
      const opts = { displayValue: !!displayValue, margin: 0, height, width };
      try { JsBarcode(el, value, { format, ...opts }); }
      catch { try { JsBarcode(el, value, { format: 'CODE128', ...opts }); } catch { return; } }
      const w = el.getAttribute('width'); const h = el.getAttribute('height');
      if (w && h) { el.setAttribute('viewBox', `0 0 ${w} ${h}`); el.removeAttribute('width'); el.removeAttribute('height'); }
    }).catch(() => {});
    return () => { alive = false; };
  }, [value, format, height, width, displayValue]);
  return <svg ref={ref} className={className} preserveAspectRatio={par} />;
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
        active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

// Один ценник (2 шт. на лист A4). Логотип, бейдж рассрочки, цена, описание, код + штрих-код.
function PriceTag({ item, store }: { item: PickedRow; store: StoreBrand }) {
  const [logoOk, setLogoOk] = useState(true);
  const title = `${item.group} ${item.producer}`.trim() || item.product_name;
  const monthly = monthlyInstallment(item.price);

  return (
    <div className="tag border-2 border-black bg-white flex flex-col p-3 overflow-hidden" style={{ width: A4_TAG.width, height: A4_TAG.height }}>
      {/* Шапка: логотип + бейдж рассрочки */}
      <div className="flex items-start justify-between">
        {logoOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={store.logo} alt={store.name} onError={() => setLogoOk(false)} className="h-12 object-contain" />
        ) : (
          <div className="text-3xl font-extrabold tracking-tight">{store.name}</div>
        )}
        {monthly > 0 && (
          <div className="text-center leading-tight">
            <div className="text-[11px] font-bold">{INSTALLMENT.months} OYIGA</div>
            <div className="text-xl font-extrabold">{monthly.toLocaleString('ru-RU')}</div>
            <div className="text-[10px] font-semibold">RASMIY DAROMADGA</div>
          </div>
        )}
      </div>

      {/* Название товара */}
      <div className="text-center text-2xl font-bold mt-2">{title}</div>

      {/* Цена */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-[64px] font-extrabold leading-none">{item.price.toLocaleString('ru-RU')}</div>
      </div>

      {/* Низ: описание (слева) + код и штрих-код (справа) */}
      <div className="flex items-end gap-2">
        <div className="flex-1 border border-black px-2 py-1 text-[12px] leading-tight min-h-[40px]">
          {item.product_name}
        </div>
        <div className="flex flex-col items-end">
          <BarcodeSvg value={item.barcode} format={item.format} height={34} width={1.4} className="h-9 w-auto" />
          <div className="border border-black px-3 py-0.5 text-base font-bold mt-0.5">{item.product_code}</div>
        </div>
      </div>

      <div className="text-center text-[11px] text-gray-600 mt-1">{store.footer}</div>
    </div>
  );
}
