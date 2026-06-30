'use client';

import { useEffect, useState } from 'react';
import AdminGate from '@/components/AdminGate';
import { fetchAnalyticsSummary, AnalyticsPeriod, AnalyticsSummary } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import ShopTurnoverSection from '@/components/ShopTurnoverSection';
import OverallTurnoverSection from '@/components/OverallTurnoverSection';

const PERIODS: { key: AnalyticsPeriod; label: string }[] = [
  { key: 'today', label: 'Сегодня' },
  { key: '7d', label: '7 дней' },
  { key: '15d', label: '15 дней' },
  { key: '30d', label: '30 дней' },
];

type Section = 'totals' | 'shops' | 'brands' | 'top' | 'slow' | 'turnover' | 'overall';
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'totals', label: '📋 Итоги' },
  { key: 'shops', label: '🏪 По магазинам' },
  { key: 'brands', label: '🏷️ По брендам' },
  { key: 'top', label: '🔥 Топ продаж' },
  { key: 'slow', label: '🐌 Не продаётся' },
  { key: 'turnover', label: '🏬 Оборачиваемость по магазину' },
  { key: 'overall', label: '📦 Сводная (все магазины)' },
];
// Сводные разделы (Итоги/По магазинам/…) пока скрыты по просьбе — оставлены только
// анализ оборачиваемости и сводная. Поставить true, чтобы вернуть остальные вкладки.
const SHOW_SUMMARY_TABS = false;
const VISIBLE_SECTIONS = SHOW_SUMMARY_TABS ? SECTIONS : SECTIONS.filter((s) => s.key === 'turnover' || s.key === 'overall');

export default function AnalyticsPage() {
  return (
    <AdminGate min="manager">
      <AnalyticsContent />
    </AdminGate>
  );
}

function AnalyticsContent() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('7d');
  const [section, setSection] = useState<Section>(SHOW_SUMMARY_TABS ? 'totals' : 'turnover');
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Сводные разделы скрыты — не дёргаем тяжёлый order$export, пока он не нужен.
    if (section === 'turnover' || section === 'overall') { setLoading(false); return; }
    setLoading(true);
    setError('');
    fetchAnalyticsSummary(period)
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [period, section]);

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-4">
      <h1 className="text-lg font-bold mb-3">📊 Аналитика продаж</h1>

      {SHOW_SUMMARY_TABS && (
        <div className="flex gap-1 mb-3 bg-gray-100 rounded-xl p-1 flex-wrap w-fit">
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-lg transition-colors ${
                period === p.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1 mb-4 border-b border-gray-200 flex-wrap">
        {VISIBLE_SECTIONS.map((s) => (
          <button key={s.key} onClick={() => setSection(s.key)}
            className={`px-3 py-2 text-xs sm:text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
              section === s.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {section === 'turnover' && <ShopTurnoverSection />}
      {section === 'overall' && <OverallTurnoverSection />}

      {section !== 'turnover' && section !== 'overall' && error && <div className="text-red-600 text-sm mb-3">{error}</div>}
      {section !== 'turnover' && section !== 'overall' && (loading && !data ? (
        <div className="text-gray-500 text-sm">Загрузка…</div>
      ) : data ? (
        <>
          <div className="text-[11px] text-gray-400 mb-3">Обновлено: {fmtDateTime(new Date(data.updated_ms).toISOString())}</div>

          {section === 'totals' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-white rounded-xl shadow-sm p-3">
                <div className="text-[11px] text-gray-400">Продано, шт</div>
                <div className="text-xl font-bold text-emerald-600">{Math.round(data.total_qty)}</div>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-3">
                <div className="text-[11px] text-gray-400">Заказов</div>
                <div className="text-xl font-bold">{data.total_orders}</div>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-3">
                <div className="text-[11px] text-gray-400">Магазинов купило</div>
                <div className="text-xl font-bold">{data.by_shop.length}</div>
              </div>
              <div className="bg-white rounded-xl shadow-sm p-3">
                <div className="text-[11px] text-gray-400">Не продаётся (есть остаток)</div>
                <div className="text-xl font-bold text-amber-600">{data.slow_products_total}</div>
              </div>
            </div>
          )}

          {section === 'shops' && (
            <div className="bg-white rounded-xl shadow-sm p-3">
              <div className="text-sm font-semibold mb-2">🏪 По магазинам</div>
              {data.by_shop.length === 0 ? (
                <div className="text-xs text-gray-400">Нет продаж за период</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-400">
                        <th className="py-1 pr-2">Магазин</th>
                        <th className="py-1 pr-2 text-right">Шт</th>
                        <th className="py-1 pr-2 text-right">Заказов</th>
                        <th className="py-1 text-right">Позиций</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.by_shop.map((s) => (
                        <tr key={s.shop}>
                          <td className="py-1.5 pr-2">{s.shop}</td>
                          <td className="py-1.5 pr-2 text-right font-medium">{Math.round(s.qty)}</td>
                          <td className="py-1.5 pr-2 text-right text-gray-400">{s.orders}</td>
                          <td className="py-1.5 text-right text-gray-400">{s.products}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {section === 'brands' && (
            <div className="bg-white rounded-xl shadow-sm p-3">
              <div className="text-sm font-semibold mb-2">🏷️ По торговым маркам</div>
              {data.by_brand.length === 0 ? (
                <div className="text-xs text-gray-400">Нет продаж за период</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-400">
                        <th className="py-1 pr-2">Бренд</th>
                        <th className="py-1 pr-2 text-right">Шт</th>
                        <th className="py-1 pr-2 text-right">Заказов</th>
                        <th className="py-1 text-right">Товаров</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.by_brand.map((b) => (
                        <tr key={b.brand}>
                          <td className="py-1.5 pr-2">{b.brand}</td>
                          <td className="py-1.5 pr-2 text-right font-medium">{Math.round(b.qty)}</td>
                          <td className="py-1.5 pr-2 text-right text-gray-400">{b.orders}</td>
                          <td className="py-1.5 text-right text-gray-400">{b.products}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {section === 'top' && (
            <div className="bg-white rounded-xl shadow-sm p-3">
              <div className="text-sm font-semibold mb-2">🔥 Хорошо продаётся (топ-50)</div>
              {data.top_products.length === 0 ? (
                <div className="text-xs text-gray-400">Нет продаж за период</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-400">
                        <th className="py-1 pr-2">Товар</th>
                        <th className="py-1 pr-2 text-right">Продано, шт</th>
                        <th className="py-1 pr-2 text-right">Заказов</th>
                        <th className="py-1 text-right">Остаток</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.top_products.map((p) => (
                        <tr key={p.code}>
                          <td className="py-1.5 pr-2 max-w-xs truncate" title={p.name}>{p.name || p.code}</td>
                          <td className="py-1.5 pr-2 text-right font-medium text-emerald-600">{Math.round(p.qty)}</td>
                          <td className="py-1.5 pr-2 text-right text-gray-400">{p.orders}</td>
                          <td className={`py-1.5 text-right ${p.stock <= 0 ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
                            {Math.round(p.stock)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {section === 'slow' && (
            <div className="bg-white rounded-xl shadow-sm p-3">
              <div className="text-sm font-semibold mb-2">
                🐌 Не продаётся, но есть остаток
                {data.slow_products_total > data.slow_products.length && (
                  <span className="text-gray-400 font-normal"> (показаны топ-{data.slow_products.length} из {data.slow_products_total} по остатку)</span>
                )}
              </div>
              {data.slow_products.length === 0 ? (
                <div className="text-xs text-gray-400">Все товары с остатком продавались за период</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-400">
                        <th className="py-1 pr-2">Товар</th>
                        <th className="py-1 pr-2">Группа</th>
                        <th className="py-1 text-right">Остаток</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.slow_products.map((p) => (
                        <tr key={p.code}>
                          <td className="py-1.5 pr-2 max-w-xs truncate" title={p.name}>{p.name || p.code}</td>
                          <td className="py-1.5 pr-2 text-gray-400">{p.group}</td>
                          <td className="py-1.5 text-right font-medium text-amber-600">{Math.round(p.stock)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      ) : null)}
    </div>
  );
}
