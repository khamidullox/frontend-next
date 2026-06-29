'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchShopTurnover, ShopTurnoverRow, ShopTurnoverSummary } from '@/lib/api';
import { loadXLSX } from '@/lib/xlsx';
import { fmtDateTime } from '@/lib/format';

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n);
  return isoDate(d);
}
// Быстрые периоды → диапазон дат (включительно по сегодня).
const QUICK: { key: string; label: string; from: () => string }[] = [
  { key: 'today', label: 'Сегодня', from: () => isoDate(new Date()) },
  { key: '7d', label: '7 дней', from: () => daysAgo(6) },
  { key: '15d', label: '15 дней', from: () => daysAgo(14) },
  { key: '30d', label: '30 дней', from: () => daysAgo(29) },
];

// Категория по оборачиваемости и настраиваемым порогам — как в наманганском файле.
// (нов.)-варианты пропущены: в лёгкой версии нет данных о новых приходах.
function category(row: ShopTurnoverRow, t1: number, t2: number): string {
  if (row.base <= 0) return 'Нет в наличии';
  if (row.sold_qty <= 0) return 'Не продаётся';
  if (row.turnover <= t1) return 'Мало продаётся';
  if (row.turnover <= t2) return 'Пассивно';
  return 'Активно';
}

const CAT_CLASS: Record<string, string> = {
  'Активно': 'text-emerald-600',
  'Пассивно': 'text-blue-600',
  'Мало продаётся': 'text-amber-600',
  'Не продаётся': 'text-red-500',
  'Нет в наличии': 'text-gray-400',
};

const CATEGORIES = ['Активно', 'Пассивно', 'Мало продаётся', 'Не продаётся', 'Нет в наличии'];

// «Требуется» (значок Т): товар продавался, но сейчас в остатке 0 — нужно завезти.
function isNeeded(row: ShopTurnoverRow): boolean {
  return row.sold_qty > 0 && row.stock <= 0;
}

// Дата прихода YYYY-MM-DD → ДД.ММ.ГГГГ (пусто → «—»).
function fmtArrival(iso: string | null): string {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

// Список магазинов-доноров: «5505: ост.5/пр.1, 7703: ост.3/пр.0».
function surplusText(list: { code: string; name: string; sold: number; stock: number }[]): string {
  return list.map((s) => `${s.code}: ост.${Math.round(s.stock)}/пр.${Math.round(s.sold)}`).join(', ');
}

export default function ShopTurnoverSection() {
  const [shops, setShops] = useState<ShopTurnoverSummary[]>([]);
  const [shop, setShop] = useState('');
  const [from, setFrom] = useState(() => daysAgo(6));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [rows, setRows] = useState<ShopTurnoverRow[]>([]);
  const [updatedMs, setUpdatedMs] = useState(0);
  const [historyFrom, setHistoryFrom] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [t1, setT1] = useState(0.2);
  const [t2, setT2] = useState(0.6);
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const [groupFilter, setGroupFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [onlyNeeded, setOnlyNeeded] = useState(false);

  const activeQuick = QUICK.find((q) => q.from() === from && to === isoDate(new Date()))?.key || '';

  useEffect(() => {
    setLoading(true);
    setError('');
    fetchShopTurnover(from, to, shop)
      .then((d) => {
        setShops(d.shops);
        setRows(d.rows);
        setUpdatedMs(d.updated_ms);
        setHistoryFrom(d.history_from);
        if (!shop && d.shops.length) setShop(d.shops[0].code);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [from, to, shop]);

  const groups = useMemo(() => [...new Set(rows.map((r) => r.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')), [rows]);
  const brands = useMemo(() => [...new Set(rows.map((r) => r.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) => {
      if (groupFilter && r.group !== groupFilter) return false;
      if (brandFilter && r.brand !== brandFilter) return false;
      if (catFilter && category(r, t1, t2) !== catFilter) return false;
      if (onlyNeeded && !isNeeded(r)) return false;
      if (q && !(r.product_name.toLowerCase().includes(q) || r.product_code.includes(q) || r.brand.toLowerCase().includes(q))) return false;
      return true;
    });
    return list.sort((a, b) => b.turnover - a.turnover || b.sold_qty - a.sold_qty);
  }, [rows, search, groupFilter, brandFilter, catFilter, onlyNeeded, t1, t2]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    let needed = 0;
    for (const r of rows) {
      c[category(r, t1, t2)] = (c[category(r, t1, t2)] || 0) + 1;
      if (isNeeded(r)) needed++;
    }
    c['_needed'] = needed;
    return c;
  }, [rows, t1, t2]);

  async function exportExcel() {
    setExporting(true);
    try {
      const XLSX = await loadXLSX();
      const data = filtered.map((r) => ({
        'Артикул': r.product_code,
        'Наименование': r.product_name,
        'Бренд': r.brand,
        'Группа': r.group,
        'Заказ': r.order_qty,
        'Возвраты': r.return_qty,
        'Продажи': r.sold_qty,
        'Остаток': r.stock,
        'База': r.base,
        'Оборачиваемость': Math.round(r.turnover * 1000) / 1000,
        'Дата прихода': fmtArrival(r.arrival_date),
        'Есть в др. маг. (мало продаётся)': r.surplus && r.surplus.length ? surplusText(r.surplus) : '',
        'Категория': category(r, t1, t2),
        'Требуется': isNeeded(r) ? 'Т' : '',
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Анализ');
      XLSX.writeFile(wb, `analiz_${shop}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Период: быстрые кнопки + произвольный диапазон дат */}
      <div className="bg-white rounded-xl shadow-sm p-3 flex flex-wrap items-center gap-2">
        {QUICK.map((q) => (
          <button key={q.key} onClick={() => { setFrom(q.from()); setTo(isoDate(new Date())); }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${
              activeQuick === q.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {q.label}
          </button>
        ))}
        <span className="w-px h-6 bg-gray-200 mx-1" />
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
          className="border-2 border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-blue-400" />
        <span className="text-gray-400 text-xs">—</span>
        <input type="date" value={to} min={from} max={isoDate(new Date())} onChange={(e) => setTo(e.target.value)}
          className="border-2 border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-blue-400" />
      </div>

      <div className="bg-white rounded-xl shadow-sm p-3 flex flex-wrap items-center gap-3">
        <select value={shop} onChange={(e) => setShop(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-400 max-w-[260px]">
          {shops.map((s) => (
            <option key={s.code} value={s.code}>{s.name} ({s.products} поз. · {Math.round(s.sold)} шт)</option>
          ))}
        </select>
        <span className="text-xs text-gray-400">Порог «мало» ≤</span>
        <input type="number" min={0} max={1} step={0.05} value={t1}
          onChange={(e) => setT1(Number(e.target.value) || 0)}
          className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right outline-none focus:border-blue-400" />
        <span className="text-xs text-gray-400">«пассивно» ≤</span>
        <input type="number" min={0} max={1} step={0.05} value={t2}
          onChange={(e) => setT2(Number(e.target.value) || 0)}
          className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-xs text-right outline-none focus:border-blue-400" />
        <button onClick={exportExcel} disabled={exporting || filtered.length === 0}
          className="ml-auto px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold disabled:opacity-50">
          {exporting ? '⏳…' : '📊 Excel'}
        </button>
      </div>

      {updatedMs > 0 && <div className="text-[11px] text-gray-400">Обновлено: {fmtDateTime(new Date(updatedMs).toISOString())}</div>}
      {historyFrom && from < historyFrom && (
        <div className="text-[11px] text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5">
          ⚠️ История продаж накоплена только с {historyFrom.split('-').reverse().join('.')} — за более ранние даты в выбранном диапазоне данных пока нет
          (Smartup отдаёт только последние ~16 дней, остальное накапливается у нас день за днём).
        </div>
      )}
      {error && <div className="text-red-600 text-sm">{error}</div>}

      {/* Фильтры: группа, бренд, категория, только «требуется» */}
      <div className="bg-white rounded-xl shadow-sm p-3 flex flex-wrap items-center gap-2">
        <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-400 max-w-[180px]">
          <option value="">Все группы</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-400 max-w-[180px]">
          <option value="">Все бренды</option>
          {brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-400 max-w-[180px]">
          <option value="">Все категории</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={() => setOnlyNeeded((v) => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
            onlyNeeded ? 'bg-amber-500 text-white border-amber-500' : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}>
          🟠 Т — требуется ({counts['_needed'] || 0})
        </button>
        {(groupFilter || brandFilter || catFilter || onlyNeeded) && (
          <button onClick={() => { setGroupFilter(''); setBrandFilter(''); setCatFilter(''); setOnlyNeeded(false); }}
            className="px-2.5 py-1.5 rounded-lg text-xs text-gray-500 hover:bg-gray-100">
            ✕ сбросить
          </button>
        )}
        <span className="text-[11px] text-gray-400 ml-auto">Показано: {filtered.length}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {['Активно', 'Пассивно', 'Мало продаётся', 'Не продаётся'].map((cat) => (
          <span key={cat} className={`text-xs font-semibold ${CAT_CLASS[cat]}`}>
            {cat}: {counts[cat] || 0}
          </span>
        ))}
      </div>

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по товару / коду / бренду…"
        className="w-full border rounded-lg px-3 py-2 text-sm" />

      {loading ? (
        <div className="text-gray-500 text-sm">Загрузка…</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm p-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400">
                <th className="py-1 pr-2">Товар</th>
                <th className="py-1 pr-2 text-right">Заказ</th>
                <th className="py-1 pr-2 text-right">Возвр.</th>
                <th className="py-1 pr-2 text-right">Прод.</th>
                <th className="py-1 pr-2 text-right">Остаток</th>
                <th className="py-1 pr-2 text-right">База</th>
                <th className="py-1 pr-2 text-right">Обор.</th>
                <th className="py-1 pr-2 text-right whitespace-nowrap">Приход</th>
                <th className="py-1 pr-2 text-left">Есть в др. маг. (мало продаётся)</th>
                <th className="py-1 text-right">Категория</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r) => {
                const cat = category(r, t1, t2);
                const needed = isNeeded(r);
                return (
                  <tr key={r.product_code}>
                    <td className="py-1.5 pr-2 max-w-xs truncate" title={r.product_name}>
                      {needed && (
                        <span title="Требуется: продаётся, но в остатке 0 — нужно завезти"
                          className="inline-block mr-1 px-1.5 rounded bg-amber-500 text-white text-[10px] font-bold align-middle">Т</span>
                      )}
                      {r.product_name || r.product_code}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-gray-400">{Math.round(r.order_qty)}</td>
                    <td className="py-1.5 pr-2 text-right text-gray-400">{Math.round(r.return_qty)}</td>
                    <td className="py-1.5 pr-2 text-right font-medium text-emerald-600">{Math.round(r.sold_qty)}</td>
                    <td className={`py-1.5 pr-2 text-right ${needed ? 'font-semibold' : ''}`}>{Math.round(r.stock)}</td>
                    <td className="py-1.5 pr-2 text-right text-gray-400">{Math.round(r.base)}</td>
                    <td className="py-1.5 pr-2 text-right">{Math.round(r.turnover * 100)}%</td>
                    <td className="py-1.5 pr-2 text-right text-gray-500 whitespace-nowrap">{fmtArrival(r.arrival_date)}</td>
                    <td className="py-1.5 pr-2 text-left text-gray-600 max-w-sm">
                      {r.surplus && r.surplus.length > 0 ? (
                        <span title={surplusText(r.surplus)} className="line-clamp-2">{surplusText(r.surplus)}</span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className={`py-1.5 text-right font-semibold ${CAT_CLASS[cat]}`}>{cat}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="py-3 text-center text-gray-400">Нет данных по этому магазину за период</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-400">
        Лёгкая версия: продажи/заказы/возвраты — из заказов Smartup (точно), остаток — текущий доступный.
        «База» = остаток + продажи (приближение к «остаток на начало + приходы»), оборачиваемость = продажи / база.
        Категории пересчитываются сразу при изменении порогов выше. Значок <span className="px-1 rounded bg-red-600 text-white font-bold">Т</span> —
        «требуется»: товар продавался, но в остатке 0, нужно завезти.
      </p>
    </div>
  );
}
