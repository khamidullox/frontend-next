'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  listProducts, listWarehouses, getWarehouseStock,
  WarehouseSummary, WarehouseProduct,
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
const BC_LABEL = { width: '50mm', height: '30mm', cols: 4 }; // сетка штрих-кодов

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

  // Склады: менеджер видит все, магазин — только свои.
  const { data: allWarehouses, loading: whLoading } = useCachedList('cache:warehouses_v2', listWarehouses, 2 * 60 * 1000);
  const warehouses = useMemo<WarehouseSummary[]>(() => {
    if (isManager) return allWarehouses;
    const mine = new Set(session?.warehouses || []);
    return allWarehouses.filter(w => mine.has(w.warehouse_id));
  }, [allWarehouses, isManager, session]);

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

  // Шаблон магазина: по умолчанию подбираем по названию склада.
  const [storeId, setStoreId] = useState<string>(STORES[0].id);
  useEffect(() => {
    if (currentWh) setStoreId(pickStoreByWarehouse(currentWh.warehouse_name).id);
  }, [currentWh]);
  const store = getStore(storeId);

  // Выбранные позиции (общие для обеих вкладок)
  const [picked, setPicked] = useState<Record<string, PickedRow>>({});
  const [query, setQuery] = useState('');

  function toggle(row: WarehouseProduct) {
    setPicked(prev => {
      const next = { ...prev };
      if (next[row.product_code]) {
        delete next[row.product_code];
      } else {
        const codes = barcodeByCode.get(row.product_code) || [];
        const { value, format } = pickBarcode(row.product_code, codes);
        next[row.product_code] = { ...row, copies: 1, barcode: value, format };
      }
      return next;
    });
  }
  function setCopies(code: string, copies: number) {
    setPicked(prev => prev[code] ? { ...prev, [code]: { ...prev[code], copies: Math.max(1, copies) } } : prev);
  }
  function setPrice(code: string, price: number) {
    setPicked(prev => prev[code] ? { ...prev, [code]: { ...prev[code], price: Math.max(0, price) } } : prev);
  }

  const q = query.trim().toLowerCase();
  const filteredStock = useMemo(() => {
    const rows = q
      ? stockRows.filter(r =>
          r.product_code.toLowerCase().includes(q) ||
          r.product_name.toLowerCase().includes(q) ||
          r.producer.toLowerCase().includes(q) ||
          r.group.toLowerCase().includes(q))
      : stockRows;
    return rows.slice(0, 200);
  }, [stockRows, q]);

  const pickedList = useMemo(() => Object.values(picked), [picked]);

  // Разворачиваем в отдельные экземпляры для печати
  const printItems = useMemo(() => {
    const out: PickedRow[] = [];
    for (const p of pickedList) for (let i = 0; i < Math.max(1, p.copies); i++) out.push(p);
    return out;
  }, [pickedList]);

  // Рисуем штрих-коды (для вкладки штрих-кодов)
  useEffect(() => {
    if (tab !== 'barcodes' || printItems.length === 0) return;
    let alive = true;
    loadJsBarcode().then(JsBarcode => {
      if (!alive) return;
      printItems.forEach((it, idx) => {
        const el = document.getElementById(`bc-${idx}`);
        if (!el) return;
        try {
          JsBarcode(el, it.barcode, { format: it.format, displayValue: false, margin: 0, height: 38 });
        } catch {
          try { JsBarcode(el, it.barcode, { format: 'CODE128', displayValue: false, margin: 0, height: 38 }); } catch { /* пропуск */ }
        }
      });
    }).catch(e => setError((e as Error).message));
    return () => { alive = false; };
  }, [tab, printItems]);

  // CSS печати в зависимости от вкладки
  useEffect(() => {
    const id = 'price-print-style';
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
    el.textContent = tab === 'tags'
      ? `@page { size: A4 portrait; margin: 6mm; }
         @media print { .tag { page-break-inside: avoid; } .tag:nth-child(2n) { page-break-after: always; } }`
      : `@page { size: A4 portrait; margin: 8mm; }
         @media print { .bclabel { page-break-inside: avoid; } }`;
    return () => { el?.remove(); };
  }, [tab]);

  return (
    <div>
      {/* Заголовок + вкладки */}
      <div className="print:hidden">
        <h2 className="text-xl font-bold mb-3">🏷️ Печать ценников и штрих-кодов</h2>

        <div className="flex gap-2 mb-4">
          <TabBtn active={tab === 'tags'} onClick={() => setTab('tags')}>🏷️ Ценники</TabBtn>
          <TabBtn active={tab === 'barcodes'} onClick={() => setTab('barcodes')}>📊 Штрих-коды</TabBtn>
        </div>

        {/* Склад + (для ценников) шаблон магазина */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-3 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-500 mb-1">
              {isManager ? 'Склад' : 'Мой магазин / склад'}
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
          {tab === 'tags' && (
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
          )}
        </div>

        {/* Поиск товара на складе */}
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="🔍 Найти товар на складе по названию, коду, бренду…"
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm mb-3 outline-none focus:border-blue-400"
        />

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        {/* Список остатков с галочками */}
        <div className="bg-white rounded-xl shadow-sm mb-3 max-h-[42vh] overflow-y-auto">
          {stockLoading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-gray-500 text-sm">
              <span className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              Загрузка остатков…
            </div>
          ) : filteredStock.length === 0 ? (
            <div className="text-center text-gray-400 py-8 text-sm">
              {whId ? 'Нет товаров' : 'Выберите склад'}
            </div>
          ) : filteredStock.map(r => {
            const checked = !!picked[r.product_code];
            return (
              <label
                key={r.product_code}
                className="flex items-center gap-2 px-3 py-2 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-blue-50/50"
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(r)} className="w-4 h-4 accent-blue-600" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate">{r.product_name || '—'}</div>
                  <div className="text-[11px] text-gray-400 truncate">
                    Код {r.product_code}{r.producer && ` · ${r.producer}`} · остаток {r.quantity} шт.
                  </div>
                </div>
                <div className="text-[12px] text-emerald-700 whitespace-nowrap">
                  {r.price > 0 ? `${r.price.toLocaleString('ru-RU')}` : '—'}
                </div>
              </label>
            );
          })}
        </div>

        {/* Выбранные позиции: цена + количество копий */}
        {pickedList.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-3 mb-3 flex flex-col gap-2">
            <div className="text-xs font-semibold text-gray-500">Выбрано: {pickedList.length} · к печати: {printItems.length}</div>
            {pickedList.map(p => (
              <div key={p.product_code} className="flex items-center gap-2 border-b border-gray-100 last:border-0 pb-2 last:pb-0">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.product_name || p.product_code}</div>
                  <div className="text-[11px] text-gray-400 truncate">Код {p.product_code} · ШК {p.barcode}</div>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number" min={0} value={p.price}
                    onChange={e => setPrice(p.product_code, Number(e.target.value) || 0)}
                    title="Цена" className="w-24 border-2 border-gray-200 rounded-lg px-2 py-1 text-sm text-right outline-none focus:border-blue-400"
                  />
                  <span className="text-[11px] text-gray-400">сум</span>
                </div>
                <input
                  type="number" min={1} value={p.copies}
                  onChange={e => setCopies(p.product_code, Number(e.target.value) || 1)}
                  title="Сколько печатать" className="w-16 border-2 border-gray-200 rounded-lg px-2 py-1 text-sm text-right outline-none focus:border-blue-400"
                />
                <button onClick={() => toggle(p)} className="text-red-400 hover:text-red-600 px-1 text-lg">✕</button>
              </div>
            ))}
          </div>
        )}

        {printItems.length > 0 && (
          <button
            onClick={() => window.print()}
            className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors mb-4"
          >
            🖨️ Печать ({printItems.length} шт.)
          </button>
        )}
      </div>

      {/* ── Область печати ── */}
      {printItems.length > 0 && tab === 'tags' && (
        <div className="flex flex-col items-center gap-2">
          {printItems.map((it, idx) => <PriceTag key={idx} item={it} store={store} />)}
        </div>
      )}

      {printItems.length > 0 && tab === 'barcodes' && (
        <div className="grid gap-2 justify-center" style={{ gridTemplateColumns: `repeat(${BC_LABEL.cols}, ${BC_LABEL.width})` }}>
          {printItems.map((it, idx) => (
            <div
              key={idx}
              className="bclabel border border-dashed border-gray-300 rounded flex flex-col items-center justify-center p-1 overflow-hidden"
              style={{ width: BC_LABEL.width, height: BC_LABEL.height }}
            >
              <div className="text-[8px] leading-tight text-center w-full truncate">{it.product_name || it.product_code}</div>
              <svg id={`bc-${idx}`} className="w-full" />
              <div className="text-[9px] font-mono text-gray-700">{it.barcode}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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

// Один ценник (2 шт. на лист A4). Шапка-логотип, бейдж рассрочки, цена, описание, код.
function PriceTag({ item, store }: { item: PickedRow; store: StoreBrand }) {
  const [logoOk, setLogoOk] = useState(true);
  const title = `${item.group} ${item.producer}`.trim() || item.product_name;
  const monthly = monthlyInstallment(item.price);

  return (
    <div
      className="tag border-2 border-black bg-white flex flex-col p-3 overflow-hidden"
      style={{ width: A4_TAG.width, height: A4_TAG.height }}
    >
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

      {/* Низ: описание + код */}
      <div className="flex items-end gap-2">
        <div className="flex-1 border border-black px-2 py-1 text-[12px] leading-tight min-h-[36px]">
          {item.product_name}
        </div>
        <div className="border border-black px-3 py-1 text-base font-bold">{item.product_code}</div>
      </div>

      {/* Слоган */}
      <div className="text-center text-[11px] text-gray-600 mt-1">{store.footer}</div>
    </div>
  );
}
