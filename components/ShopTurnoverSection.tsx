'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchShopTurnover, AnalyticsPeriod, ShopTurnoverRow, ShopTurnoverSummary } from '@/lib/api';
import { loadXLSX } from '@/lib/xlsx';
import { fmtDateTime } from '@/lib/format';

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

export default function ShopTurnoverSection({ period }: { period: AnalyticsPeriod }) {
  const [shops, setShops] = useState<ShopTurnoverSummary[]>([]);
  const [shop, setShop] = useState('');
  const [rows, setRows] = useState<ShopTurnoverRow[]>([]);
  const [updatedMs, setUpdatedMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [t1, setT1] = useState(0.2);
  const [t2, setT2] = useState(0.6);
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError('');
    fetchShopTurnover(period, shop)
      .then((d) => {
        setShops(d.shops);
        setRows(d.rows);
        setUpdatedMs(d.updated_ms);
        if (!shop && d.shops.length) setShop(d.shops[0].code);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [period, shop]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? rows.filter((r) => r.product_name.toLowerCase().includes(q) || r.product_code.includes(q) || r.brand.toLowerCase().includes(q))
      : rows;
    return [...list].sort((a, b) => b.turnover - a.turnover || b.sold_qty - a.sold_qty);
  }, [rows, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) { const cat = category(r, t1, t2); c[cat] = (c[cat] || 0) + 1; }
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
        'Категория': category(r, t1, t2),
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
      {error && <div className="text-red-600 text-sm">{error}</div>}

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
                <th className="py-1 text-right">Категория</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r) => {
                const cat = category(r, t1, t2);
                return (
                  <tr key={r.product_code}>
                    <td className="py-1.5 pr-2 max-w-xs truncate" title={r.product_name}>{r.product_name || r.product_code}</td>
                    <td className="py-1.5 pr-2 text-right text-gray-400">{Math.round(r.order_qty)}</td>
                    <td className="py-1.5 pr-2 text-right text-gray-400">{Math.round(r.return_qty)}</td>
                    <td className="py-1.5 pr-2 text-right font-medium text-emerald-600">{Math.round(r.sold_qty)}</td>
                    <td className="py-1.5 pr-2 text-right">{Math.round(r.stock)}</td>
                    <td className="py-1.5 pr-2 text-right text-gray-400">{Math.round(r.base)}</td>
                    <td className="py-1.5 pr-2 text-right">{Math.round(r.turnover * 100)}%</td>
                    <td className={`py-1.5 text-right font-semibold ${CAT_CLASS[cat]}`}>{cat}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="py-3 text-center text-gray-400">Нет данных по этому магазину за период</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-400">
        Лёгкая версия: продажи/заказы/возвраты — из заказов Smartup (точно), остаток — текущий доступный.
        «База» = остаток + продажи (приближение к «остаток на начало + приходы»), оборачиваемость = продажи / база.
        Категории пересчитываются сразу при изменении порогов выше.
      </p>
    </div>
  );
}
