'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AdminGate from '@/components/AdminGate';
import { listShopRequests, Delivery, DELIVERY_STATUS_LABEL, DeliveryStatus } from '@/lib/api';
import { fmtDateTimeYear as fmt } from '@/lib/format';
import { loadXLSX } from '@/lib/xlsx';

function statusClass(s: DeliveryStatus): string {
  switch (s) {
    case 'delivered': return 'bg-green-100 text-green-700';
    case 'on_way': return 'bg-blue-100 text-blue-700';
    case 'returned': return 'bg-red-100 text-red-700';
    case 'assigned': return 'bg-amber-100 text-amber-700';
    default: return 'bg-gray-100 text-gray-600';
  }
}

export default function ClientsPage() {
  return (
    <AdminGate min="manager">
      <ClientsContent />
    </AdminGate>
  );
}

function ClientsContent() {
  const [items, setItems] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    listShopRequests()
      .then(setItems)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...items].sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (!q) return sorted;
    return sorted.filter((d) =>
      (d.shop_name || '').toLowerCase().includes(q) ||
      (d.client_name || '').toLowerCase().includes(q) ||
      (d.client_phone || '').toLowerCase().includes(q) ||
      (d.address || '').toLowerCase().includes(q)
    );
  }, [items, search]);

  async function exportExcel() {
    setExporting(true);
    try {
      const XLSX = await loadXLSX();
      const rows = filtered.map((d) => ({
        'Магазин': d.shop_name || '',
        'Клиент': d.client_name || '',
        'Телефон': d.client_phone || '',
        'Адрес': d.address || '',
        'Геолокация': d.lat != null && d.lng != null ? `${d.lat}, ${d.lng}` : '',
        'Товар': d.items.map((it) => `${it.name} ×${it.qty}`).join(', '),
        'Статус': DELIVERY_STATUS_LABEL[d.status],
        'Создано': fmt(d.created_at),
        'Водитель': d.driver_name || '',
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Клиенты');
      XLSX.writeFile(wb, `klienty_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Link href="/logistics" className="text-sm text-gray-500 hover:text-gray-700">← Логистика</Link>
        <h2 className="text-xl font-bold ml-1">👥 База клиентов <span className="text-sm text-gray-400 font-normal">({filtered.length})</span></h2>
        <Link href="/logistics/reports"
          className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700">
          📊 Отчёты
        </Link>
        <button onClick={exportExcel} disabled={exporting || filtered.length === 0}
          className="ml-auto px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 text-emerald-700 text-xs font-semibold rounded-lg whitespace-nowrap">
          {exporting ? '⏳…' : '📥 Экспорт в Excel'}
        </button>
      </div>

      <input
        value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="🔍 Поиск по магазину, клиенту, телефону, адресу"
        className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 mb-4"
      />

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {loading ? (
        <div className="text-gray-500 text-sm">Загрузка…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">Заявок магазинов нет</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500">
                  <th className="px-3 py-2 font-semibold">Магазин</th>
                  <th className="px-3 py-2 font-semibold">Клиент</th>
                  <th className="px-3 py-2 font-semibold">Телефон</th>
                  <th className="px-3 py-2 font-semibold">Адрес / геолокация</th>
                  <th className="px-3 py-2 font-semibold">Товар</th>
                  <th className="px-3 py-2 font-semibold">Статус</th>
                  <th className="px-3 py-2 font-semibold">Создано</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">🏪 {d.shop_name || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{d.client_name || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {d.client_phone ? <a href={`tel:${d.client_phone}`} className="text-blue-600 hover:underline">📞 {d.client_phone}</a> : '—'}
                    </td>
                    <td className="px-3 py-2 max-w-xs">
                      <div className="truncate">{d.address || '—'}</div>
                      {d.lat != null && d.lng != null && (
                        <a href={`https://yandex.ru/maps/?pt=${d.lng},${d.lat}&z=16&l=map`} target="_blank" rel="noopener noreferrer"
                          className="text-[11px] text-emerald-600 hover:underline">📌 {d.lat.toFixed(5)}, {d.lng.toFixed(5)}</a>
                      )}
                    </td>
                    <td className="px-3 py-2 max-w-xs">
                      <div className="truncate text-xs text-gray-500">
                        {d.items.length > 0 ? d.items.map((it) => `${it.name} ×${it.qty}`).join(', ') : '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusClass(d.status)}`}>
                        {DELIVERY_STATUS_LABEL[d.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-400">{fmt(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
