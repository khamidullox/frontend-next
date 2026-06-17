'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  listProducts, listWarehousesForTags, getWarehouseStock, getProductStock,
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
  fromCatalog?: boolean; // добавлен через поиск по справочнику
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
  const { data: catalog } = useCachedList('cache:products_v3', listProducts, 30 * 60 * 1000);
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
  const [bcFormat, setBcFormat] = useState<string>('auto'); // тип штрихкода (под сканер)
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

  // Процент рассрочки на ценнике (38/40/55/свой)
  const [pctMode, setPctMode] = useState<string>(String(INSTALLMENT.defaultPct));
  const [customPct, setCustomPct] = useState(INSTALLMENT.defaultPct);
  const installmentPct = pctMode === 'custom' ? customPct : Number(pctMode);

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

  // Поиск по всему справочнику (для менеджера/админа) — любой товар, не только со склада
  const [catalogQuery, setCatalogQuery] = useState('');
  const cq = catalogQuery.trim().toLowerCase();
  const catalogResults = useMemo(() => {
    if (!cq) return [];
    return catalog.filter(p =>
      p.code.toLowerCase().includes(cq) ||
      p.name.toLowerCase().includes(cq) ||
      p.barcodes.some(b => b.includes(cq))
    ).slice(0, 15);
  }, [catalog, cq]);

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
  const [stockMode, setStockMode] = useState(false); // кол-во копий = остаток
  const [previewPage, setPreviewPage] = useState(0); // страница предпросмотра при большом объёме
  const lastIndexRef = useRef<number | null>(null);

  function makePicked(row: WarehouseProduct): PickedRow {
    const codes = barcodeByCode.get(row.product_code) || [];
    const { value, format } = pickBarcode(row.product_code, codes);
    return { ...row, copies: stockMode ? Math.max(1, row.quantity || 1) : 1, barcode: value, format };
  }
  // Добавить любой товар из справочника. Цену подтягиваем автоматически (оптовая из остатков).
  function addCatalogItem(c: { code: string; name: string; producer: string; group: string }) {
    if (picked[c.code]) { setCatalogQuery(''); return; }
    const row: WarehouseProduct = {
      product_code: c.code, product_name: c.name, producer: c.producer, group: c.group, quantity: 0, price: 0,
    };
    setPicked(prev => prev[c.code] ? prev : { ...prev, [c.code]: { ...makePicked(row), fromCatalog: true } });
    setCatalogQuery('');
    // Автоподстановка цены
    getProductStock(c.code)
      .then(s => setPicked(prev => prev[c.code] ? { ...prev, [c.code]: { ...prev[c.code], price: s.wholesale_price || 0 } } : prev))
      .catch(() => {});
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
  // Переключатель: кол-во копий = остаток (вкл) или = 1 (выкл), для всех выбранных.
  function toggleStockMode() {
    const on = !stockMode;
    setStockMode(on);
    setPicked(prev => {
      const next: Record<string, PickedRow> = {};
      for (const [code, p] of Object.entries(prev)) next[code] = { ...p, copies: on ? Math.max(1, p.quantity || 1) : 1 };
      return next;
    });
  }

  const allVisibleSelected = orderedList.length > 0 && orderedList.every(r => picked[r.product_code]);
  const someVisibleSelected = orderedList.some(r => picked[r.product_code]);
  const masterState: TriState = allVisibleSelected ? 'all' : someVisibleSelected ? 'some' : 'none';

  const pickedList = useMemo(() => Object.values(picked), [picked]);
  // Товары, добавленные через справочник — отдельный список, чтобы указать количество и цену
  // (показываем независимо от того, есть ли товар на текущем складе).
  const extraPicked = useMemo(() => pickedList.filter(p => p.fromCatalog), [pickedList]);
  const printItems = useMemo(() => {
    const out: PickedRow[] = [];
    for (const p of pickedList) for (let i = 0; i < Math.max(1, p.copies); i++) out.push(p);
    return out;
  }, [pickedList]);

  // Постраничный предпросмотр/печать при большом объёме (чтобы не грузить тысячи этикеток сразу)
  const PREVIEW_PAGE = 100;
  const previewPages = Math.max(1, Math.ceil(printItems.length / PREVIEW_PAGE));
  const safePreviewPage = Math.min(previewPage, previewPages - 1);
  const visibleItems = printItems.slice(safePreviewPage * PREVIEW_PAGE, safePreviewPage * PREVIEW_PAGE + PREVIEW_PAGE);
  useEffect(() => { setPreviewPage(0); }, [printItems.length, tab]);

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
           html, body { margin: 0 !important; padding: 0 !important; }
           main { margin: 0 !important; padding: 0 !important; max-width: none !important; }
           .bc-sheet { display: block !important; gap: 0 !important; margin: 0 !important; padding: 0 !important; }
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
              <label className="block text-xs font-semibold text-gray-500 mb-1 mt-2">Рассрочка, %</label>
              <select
                value={pctMode}
                onChange={e => setPctMode(e.target.value)}
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400"
              >
                <option value="38">38%</option>
                <option value="40">40%</option>
                <option value="55">55%</option>
                <option value="custom">Свой…</option>
              </select>
              {pctMode === 'custom' && (
                <input
                  type="number" min={0} max={300} value={customPct}
                  onChange={e => setCustomPct(Math.max(0, Number(e.target.value) || 0))}
                  title="Процент рассрочки"
                  className="w-full mt-2 border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm text-right outline-none focus:border-blue-400"
                />
              )}
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
              <label className="block text-xs font-semibold text-gray-500 mb-1 mt-2">Тип штрих-кода (под сканер)</label>
              <select
                value={bcFormat}
                onChange={e => setBcFormat(e.target.value)}
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400"
              >
                <option value="auto">Авто</option>
                <option value="ITF">ITF / 2 из 5 (для сканеров EAN)</option>
                <option value="CODE128">CODE128</option>
                <option value="EAN13">EAN-13</option>
              </select>
            </div>
          )}
        </div>

        {/* Поиск по всему справочнику (менеджер/админ) — можно добавить любой товар */}
        {isManager && (
          <div className="relative mb-3">
            <input
              type="text"
              value={catalogQuery}
              onChange={e => setCatalogQuery(e.target.value)}
              placeholder="📚 Добавить любой товар из справочника (по названию, коду, ШК)…"
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-400"
            />
            {catalogResults.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-100 max-h-72 overflow-y-auto">
                {catalogResults.map(p => {
                  const added = !!picked[p.code];
                  return (
                    <button
                      key={p.code}
                      onClick={() => addCatalogItem(p)}
                      disabled={added}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center gap-2 disabled:opacity-50 border-b border-gray-50 last:border-0"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate">{p.name || '—'}</div>
                        <div className="text-[11px] text-gray-400 truncate">
                          Код {p.code}{p.barcodes.length > 0 && ` · ШК ${p.barcodes.join(', ')}`}
                        </div>
                      </div>
                      <span className={added ? 'text-green-500 text-xs' : 'text-blue-500 text-lg'}>{added ? 'добавлено' : '+'}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Добавленные из справочника — указать количество и цену */}
        {extraPicked.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-3 mb-3 flex flex-col gap-2">
            <div className="text-xs font-semibold text-gray-500">Добавлено из справочника ({extraPicked.length})</div>
            {extraPicked.map(p => (
              <div key={p.product_code} className="flex items-center gap-2 border-b border-gray-100 last:border-0 pb-2 last:pb-0">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.product_name || p.product_code}</div>
                  <div className="text-[11px] text-gray-400 truncate">Код {p.product_code} · ШК {p.barcode}</div>
                </div>
                <input
                  type="number" min={0} value={p.price}
                  onChange={e => setPrice(p.product_code, Number(e.target.value) || 0)}
                  title="Цена"
                  className="w-24 border-2 border-gray-200 rounded-lg px-2 py-1 text-sm text-right outline-none focus:border-blue-400"
                />
                <input
                  type="number" min={1} value={p.copies}
                  onChange={e => setCopies(p.product_code, Number(e.target.value) || 1)}
                  title="Количество"
                  className="w-16 border-2 border-gray-200 rounded-lg px-2 py-1 text-sm text-right outline-none focus:border-blue-400"
                />
                <button onClick={() => setRows([p], false)} className="text-red-400 hover:text-red-600 px-1 text-lg">✕</button>
              </div>
            ))}
          </div>
        )}

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
            <button
              onClick={toggleStockMode}
              title="Количество копий = остаток на складе"
              className={`ml-auto text-[11px] px-2 py-0.5 rounded-md whitespace-nowrap transition-colors border ${
                stockMode ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-blue-600 border-blue-300 hover:bg-blue-50'
              }`}
            >
              {stockMode ? '✓ ' : ''}кол-во=остаток
            </button>
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

            {/* Постранично, если этикеток много */}
            {previewPages > 1 && (
              <div className="flex items-center justify-center gap-3 mb-2 text-sm">
                <button
                  onClick={() => setPreviewPage(p => Math.max(0, p - 1))}
                  disabled={safePreviewPage <= 0}
                  className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-40"
                >← Назад</button>
                <span className="text-gray-500">Стр. {safePreviewPage + 1} из {previewPages}</span>
                <button
                  onClick={() => setPreviewPage(p => Math.min(previewPages - 1, p + 1))}
                  disabled={safePreviewPage >= previewPages - 1}
                  className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-40"
                >Вперёд →</button>
              </div>
            )}

            <button
              onClick={() => window.print()}
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors mb-1"
            >
              🖨️ Печать {previewPages > 1 ? `этой порции (${visibleItems.length} шт.)` : `(${printItems.length} шт.)`}
            </button>
            {previewPages > 1 && (
              <p className="text-[11px] text-gray-400 text-center mb-4">
                Печатается текущая страница. Всего {printItems.length} шт. — печатайте по порциям, листая «Вперёд».
              </p>
            )}
          </>
        )}
      </div>

      {/* ── Область печати ── */}
      {printItems.length > 0 && tab === 'tags' && (
        <div className="flex flex-col items-center gap-2">
          {visibleItems.map((it, idx) => <PriceTag key={idx} item={it} store={store} pct={installmentPct} />)}
        </div>
      )}

      {printItems.length > 0 && tab === 'barcodes' && (
        <div className="bc-sheet flex flex-col items-center gap-2">
          {visibleItems.map((it, idx) => (
            <div
              key={idx}
              className="bclabel border border-gray-300 rounded-lg flex flex-col gap-1 p-1.5 overflow-hidden box-border"
              style={{ width: bcLabel.w, height: bcLabel.h }}
            >
              {/* Капсула с названием */}
              <div className="flex" style={{ flex: '0 0 24%', minHeight: 0 }}>
                <div className="flex-1 border border-gray-700 rounded-lg px-1 flex items-center justify-center text-center font-bold text-[9px] leading-tight overflow-hidden">
                  <span className="line-clamp-2 break-words">{it.product_name || it.product_code}</span>
                </div>
              </div>
              {/* Штрихкод — те же пропорции, что и на ценнике (он сканируется): фикс. высота + ширина авто */}
              <div className="flex flex-col items-center justify-center overflow-hidden gap-1 py-0.5" style={{ flex: '1 1 auto', minHeight: 0 }}>
                <BarcodeSvg value={it.barcode} format={bcFormat === 'auto' ? it.format : bcFormat} height={40} width={1.4} margin={10} par="xMidYMid meet" className="h-14 w-auto max-w-full max-h-full block mx-auto" />
                <span className="font-mono text-[8px] text-gray-700 leading-none">{it.barcode}</span>
              </div>
              {/* Капсула с кодом товара */}
              <div className="flex" style={{ flex: '0 0 24%', minHeight: 0 }}>
                <div className="flex-1 border border-gray-700 rounded-lg px-1 flex items-center justify-center text-center font-bold text-[14px] leading-none overflow-hidden">
                  Код {it.product_code}
                </div>
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
function BarcodeSvg({ value, format, height, width, displayValue, className, par = 'xMidYMid meet', margin = 0 }: {
  value: string; format: string; height: number; width: number; displayValue?: boolean; className?: string; par?: string; margin?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let alive = true;
    loadJsBarcode().then(JsBarcode => {
      const el = ref.current;
      if (!alive || !el) return;
      const opts = { displayValue: !!displayValue, margin, height, width };
      try { JsBarcode(el, value, { format, ...opts }); }
      catch { try { JsBarcode(el, value, { format: 'CODE128', ...opts }); } catch { return; } }
      const w = el.getAttribute('width'); const h = el.getAttribute('height');
      if (w && h) { el.setAttribute('viewBox', `0 0 ${w} ${h}`); el.removeAttribute('width'); el.removeAttribute('height'); }
    }).catch(() => {});
    return () => { alive = false; };
  }, [value, format, height, width, displayValue, margin]);
  // shapeRendering=crispEdges — резкие края полос (без сглаживания), критично для печати/сканера.
  return <svg ref={ref} className={className} preserveAspectRatio={par} shapeRendering="crispEdges" />;
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

// Логотип ARZONCHI (генерируется, если нет картинки arzonchi.png): «ARZ[🧺]NCHI».
function ArzonchiLogo({ className }: { className?: string }) {
  const g = '#6b7280'; // серый, как на логотипе
  return (
    <svg viewBox="0 0 200 120" className={className}>
      <g fontFamily="'Arial Black', Arial, sans-serif" fontWeight={900} fontSize={54} fill="black">
        <text x="2" y="80">ARZ</text>
        <text x="128" y="80">NCHI</text>
      </g>
      {/* «O» — стиральная машина */}
      <rect x="73" y="30" width="54" height="74" rx="7" fill="white" stroke={g} strokeWidth="5" />
      <line x1="73" y1="52" x2="127" y2="52" stroke={g} strokeWidth="5" />
      <rect x="80" y="39" width="22" height="5" rx="2.5" fill={g} />
      <circle cx="111" cy="41.5" r="2.6" fill={g} />
      <circle cx="119" cy="41.5" r="2.6" fill={g} />
      <circle cx="100" cy="78" r="20" fill="white" stroke={g} strokeWidth="5" />
      <circle cx="100" cy="78" r="13" fill="white" stroke={g} strokeWidth="3.5" />
      <path d="M93 86 a9 9 0 0 0 9 4" fill="none" stroke={g} strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

// Бейдж рассрочки — синяя зубчатая звезда-печать.
function InstallmentBadge({ monthly, months }: { monthly: number; months: number }) {
  const N = 18;
  const pts: string[] = [];
  for (let i = 0; i < N * 2; i++) {
    const r = i % 2 === 0 ? 50 : 41;
    const a = (Math.PI * i) / N - Math.PI / 2;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
  }
  return (
    <div className="relative w-[120px] h-[120px] flex-shrink-0 text-black">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <polygon points={pts.join(' ')} fill="#1ec8c8" stroke="#0e9a9a" strokeWidth="1.5" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none px-2">
        <div className="text-[12px] font-extrabold">{months} OYIGA</div>
        <div className="text-[19px] font-black my-0.5">{monthly.toLocaleString('ru-RU')}</div>
        <div className="text-[9px] font-bold leading-tight">RASMIY<br />DAROMADGA</div>
      </div>
    </div>
  );
}

// Ценник ARZONCHI (2 шт. на лист A4): логотип, бейдж рассрочки, название, крупная цена, описание, штрих-код.
function PriceTag({ item, store, pct }: { item: PickedRow; store: StoreBrand; pct: number }) {
  const [logoOk, setLogoOk] = useState(true);
  // Убираем ведущий код группы (цифры в начале), например «1025 Obogrevatel» → «Obogrevatel».
  const cleanGroup = item.group.replace(/^\d+\s*/, '');
  const title = `${cleanGroup} ${item.producer}`.trim() || item.product_name;
  const monthly = monthlyInstallment(item.price, pct);

  return (
    <div className="tag relative border-[11px] border-black bg-white flex flex-col overflow-hidden" style={{ width: A4_TAG.width, height: A4_TAG.height }}>
      {/* Бейдж рассрочки — в самый угол, чуть выходит на рамку */}
      {monthly > 0 && (
        <div className="absolute z-10" style={{ top: -2, right: -2, transform: 'rotate(-12deg)' }}>
          <InstallmentBadge monthly={monthly} months={INSTALLMENT.months} />
        </div>
      )}
      {/* Верхняя часть с отступами */}
      <div className="flex-1 flex flex-col px-4 pt-3 min-h-0">
        {/* Шапка: крупный логотип, смещён левее (справа место под бейдж) */}
        <div className="flex items-center justify-center pr-28 min-h-[170px]">
          {logoOk && store.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={store.logo} alt={store.name} onError={() => setLogoOk(false)} className="h-44 w-auto max-w-[90%] object-contain" />
          ) : store.id === 'arzonchi' ? (
            <ArzonchiLogo className="h-44 w-auto" />
          ) : (
            <div className="text-8xl font-black tracking-tight">{store.name}</div>
          )}
        </div>

        {/* Название товара */}
        <div className="text-center text-[42px] font-black leading-tight">{title}</div>

        {/* Цена — тянется к краям; короткие числа остаются по центру. my-auto — компактнее по вертикали */}
        <div className="flex-1 flex items-center justify-center overflow-hidden px-2 py-1">
          {(() => {
            const s = item.price.toLocaleString('ru-RU');
            const fs = Math.min(210, Math.floor(700 / Math.max(1, s.length * 0.5)));
            return (
              <div className="leading-none whitespace-nowrap text-black" style={{ fontFamily: "Impact, 'Arial Narrow', sans-serif", fontSize: `${fs}px`, color: '#000', WebkitTextStroke: '2px #000', paintOrder: 'stroke fill' }}>
                {s}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Низ: описание + код (одинаковая фикс. высота) прижаты к низу; штрих-код справа с отступом */}
      <div className="flex items-end" style={{ fontFamily: 'Arial, sans-serif' }}>
        <div className="flex items-end">
          <div className="border-t border-r border-black px-2 text-[12px] leading-tight flex items-center justify-center text-center w-[300px] h-[46px]">
            <span className="line-clamp-2">{item.product_name}</span>
          </div>
          <div className="border-t border-r border-black px-2 flex items-center justify-center text-[13px] w-[68px] h-[39px]">
            {item.product_code}
          </div>
        </div>
        <div className="ml-auto mr-1 flex flex-col items-center shrink-0 pb-1" style={{ width: 158 }}>
          <BarcodeSvg value={item.barcode} format={item.format} height={36} width={1.4} margin={2} className="w-full h-9" />
          <span className="text-[8px] text-gray-500 leading-none mt-0.5">{item.barcode}</span>
        </div>
      </div>
    </div>
  );
}
