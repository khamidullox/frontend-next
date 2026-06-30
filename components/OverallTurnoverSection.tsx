'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchOverallTurnover, OverallRow } from '@/lib/api';
import { loadXLSX } from '@/lib/xlsx';
import { fmtDateTime } from '@/lib/format';

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysAgo(n: number): string { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); }
const QUICK: { key: string; label: string; from: () => string }[] = [
  { key: 'today', label: 'Сегодня', from: () => isoDate(new Date()) },
  { key: '7d', label: '7 дней', from: () => daysAgo(6) },
  { key: '15d', label: '15 дней', from: () => daysAgo(14) },
  { key: '30d', label: '30 дней', from: () => daysAgo(29) },
];

function category(r: OverallRow, t1: number, t2: number): string {
  if (r.base <= 0) return 'Нет в наличии';
  if (r.sold <= 0) return 'Не продаётся';
  if (r.turnover <= t1) return 'Мало продаётся';
  if (r.turnover <= t2) return 'Пассивно';
  return 'Активно';
}
const CAT_CLASS: Record<string, string> = {
  'Активно': 'text-emerald-600', 'Пассивно': 'text-blue-600', 'Мало продаётся': 'text-amber-600',
  'Не продаётся': 'text-red-500', 'Нет в наличии': 'text-gray-400',
};
const CATEGORIES = ['Активно', 'Пассивно', 'Мало продаётся', 'Не продаётся', 'Нет в наличии'];

export default function OverallTurnoverSection() {
  const [from, setFrom] = useState(() => daysAgo(6));
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [rows, setRows] = useState<OverallRow[]>([]);
  const [updatedMs, setUpdatedMs] = useState(0);
  const [historyFrom, setHistoryFrom] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [t1, setT1] = useState(0.2);
  const [t2, setT2] = useState(0.6);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [exporting, setExporting] = useState(false);

  const activeQuick = QUICK.find((q) => q.from() === from && to === isoDate(new Date()))?.key || '';

  useEffect(() => {
    setLoading(true); setError('');
    fetchOverallTurnover(from, to)
      .then((d) => { setRows(d.rows); setUpdatedMs(d.updated_ms); setHistoryFrom(d.history_from); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [from, to]);

  const groups = useMemo(() => [...new Set(rows.map((r) => r.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')), [rows]);
  const brands = useMemo(() => [...new Set(rows.map((r) => r.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (groupFilter && r.group !== groupFilter) return false;
      if (brandFilter && r.brand !== brandFilter) return false;
      if (catFilter && category(r, t1, t2) !== catFilter) return false;
      if (q && !(r.product_name.toLowerCase().includes(q) || r.product_code.includes(q) || r.brand.toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => b.sold - a.sold || b.stock_total - a.stock_total);
  }, [rows, search, groupFilter, brandFilter, catFilter, t1, t2]);

  const tot = useMemo(() => filtered.reduce((s, r) => ({
    sold: s.sold + r.sold, shops: s.shops + r.stock_shops, base: s.base + r.stock_base,
  }), { sold: 0, shops: 0, base: 0 }), [filtered]);

  async function exportExcel() {
    setExporting(true);
    try {
      const XLSX = await loadXLSX();
      const data = filtered.map((r) => ({
        'Артикул': r.product_code, 'Наименование': r.product_name, 'Бренд': r.brand, 'Группа': r.group,
        'Продано': r.sold, 'Остаток магазины': r.stock_shops, 'Остаток база': r.stock_base,
        'Остаток всего': r.stock_total, 'В обороте': r.base,
        'Оборачиваемость': Math.round(r.turnover * 1000) / 1000, 'Категория': category(r, t1, t2),
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Сводная');
      XLSX.writeFile(wb, `svodnaya_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) { setError((e as Error).message); } finally { setExporting(false); }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-white rounded-xl shadow-sm p-3 flex flex-wrap items-center gap-2">
        {QUICK.map((q) => (
          <button key={q.key} onClick={() => { setFrom(q.from()); setTo(isoDate(new Date())); }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${activeQuick === q.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {q.label}
          </button>
        ))}
        <span className="w-px h-6 bg-gray-200 mx-1" />
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
          className="border-2 border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-blue-400" />
        <span className="text-gray-400 text-xs">—</span>
        <input type="date" value={to} min={from} max={isoDate(new Date())} onChange={(e) => setTo(e.target.value)}
          className="border-2 border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-blue-400" />
        <button onClick={exportExcel} disabled={exporting || !filtered.length}
          className="ml-auto px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
          {exporting ? '⏳…' : '⬇️ Excel'}
        </button>
      </div>

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
        <span className="text-xs text-gray-400">Порог «мало» ≤</span>
        <input type="number" min={0} max={1} step={0.05} value={t1} onChange={(e) => setT1(Number(e.target.value) || 0)}
          className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400" />
        <span className="text-xs text-gray-400">«пассивно» ≤</span>
        <input type="number" min={0} max={1} step={0.05} value={t2} onChange={(e) => setT2(Number(e.target.value) || 0)}
          className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400" />
        <span className="text-[11px] text-gray-400 ml-auto">Показано: {filtered.length}</span>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <span>Продано: <b className="text-emerald-600">{Math.round(tot.sold)}</b></span>
        <span>Остаток магазины: <b>{Math.round(tot.shops)}</b></span>
        <span>Остаток база: <b className="text-indigo-600">{Math.round(tot.base)}</b></span>
        <span>Всего остаток: <b>{Math.round(tot.shops + tot.base)}</b></span>
      </div>

      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по товару / коду / бренду…"
        className="w-full border rounded-lg px-3 py-2 text-sm" />

      {historyFrom && (
        <div className="text-[11px] text-amber-600">⚠️ Продажи учитываются с {historyFrom} (раньше истории нет).</div>
      )}
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {updatedMs > 0 && <div className="text-[11px] text-gray-400">Обновлено: {fmtDateTime(new Date(updatedMs).toISOString())}</div>}

      {loading ? <div className="text-gray-500 text-sm">Загрузка…</div> : (
        <div className="bg-white rounded-xl shadow-sm p-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400">
                <th className="py-1 pr-2">Товар</th>
                <th className="py-1 pr-2 text-right">Продано</th>
                <th className="py-1 pr-2 text-right">Ост. магазины</th>
                <th className="py-1 pr-2 text-right">Ост. база</th>
                <th className="py-1 pr-2 text-right">Ост. всего</th>
                <th className="py-1 pr-2 text-right">Обор.</th>
                <th className="py-1 text-right">Категория</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r) => {
                const cat = category(r, t1, t2);
                return (
                  <tr key={r.product_code}>
                    <td className="py-1.5 pr-2"><div className="font-medium break-words">{r.product_name}</div><div className="text-gray-400">{r.product_code}{r.brand ? ` · ${r.brand}` : ''}</div></td>
                    <td className="py-1.5 pr-2 text-right font-medium text-emerald-600">{Math.round(r.sold)}</td>
                    <td className="py-1.5 pr-2 text-right">{Math.round(r.stock_shops)}</td>
                    <td className="py-1.5 pr-2 text-right text-indigo-600">{Math.round(r.stock_base)}</td>
                    <td className="py-1.5 pr-2 text-right font-semibold">{Math.round(r.stock_total)}</td>
                    <td className="py-1.5 pr-2 text-right">{Math.round(r.turnover * 100)}%</td>
                    <td className={`py-1.5 text-right font-semibold ${CAT_CLASS[cat]}`}>{cat}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={7} className="py-3 text-center text-gray-400">Нет данных за период</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
