'use client';

import { useMemo, useState } from 'react';
import AdminGate from '@/components/AdminGate';
import LogisticsTabs from '@/components/LogisticsTabs';
import { listClientAddressStatus } from '@/lib/api';
import { useCachedList } from '@/lib/useCachedList';
import { loadXLSX } from '@/lib/xlsx';

export default function ClientAddressesPage() {
  return (
    <AdminGate min="manager">
      <ClientAddressesContent />
    </AdminGate>
  );
}

function ClientAddressesContent() {
  const { data: clients, loading, error } = useCachedList(
    'cache:client_addresses',
    listClientAddressStatus,
    5 * 60_000
  );
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'with' | 'without'>('without');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = clients.filter((c) => (tab === 'with' ? c.has_address : !c.has_address));
    if (!q) return list;
    return list.filter((c) => c.person_name.toLowerCase().includes(q));
  }, [clients, query, tab]);

  const withCount = clients.filter((c) => c.has_address).length;
  const withoutCount = clients.length - withCount;

  async function exportExcel() {
    setExporting(true);
    setExportError('');
    try {
      const XLSX = await loadXLSX();
      const rows = filtered.map((c) => ({
        'Клиент': c.person_name,
        'Есть адрес': c.has_address ? 'Да' : 'Нет',
        'Адрес': c.address || '',
        'Широта': c.lat ?? '',
        'Долгота': c.lng ?? '',
        'Заказов': c.orders_count,
        'Последний заказ': c.last_order_date || '',
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Адреса клиентов');
      const suffix = tab === 'with' ? 's_adresom' : 'bez_adresa';
      XLSX.writeFile(wb, `klienty_${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-xl font-bold mb-3">🚚 Логистика</h1>
      <LogisticsTabs />

      <p className="text-xs text-gray-500 mb-3">
        По заказам за последние 6 дней (то же окно, что в разделе «Накладные/заказы»).
        Адрес/координаты — поля Smartup <code>delivery_address_full/short</code> и{' '}
        <code>person_latitude/longitude</code>.
      </p>

      {loading && <p className="text-gray-500">Загрузка…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && (
        <>
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setTab('without')}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold ${
                tab === 'without' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              ❌ Без адреса ({withoutCount})
            </button>
            <button
              onClick={() => setTab('with')}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold ${
                tab === 'with' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              ✅ С адресом ({withCount})
            </button>
          </div>

          <div className="flex gap-2 mb-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по клиенту…"
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={exportExcel}
              disabled={exporting || filtered.length === 0}
              className="px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-semibold whitespace-nowrap disabled:opacity-50"
            >
              {exporting ? '⏳…' : '📊 Excel'}
            </button>
          </div>
          {exportError && <p className="text-red-600 text-xs mb-2">{exportError}</p>}

          <div className="flex flex-col gap-2">
            {filtered.map((c) => (
              <div key={c.person_id} className="bg-white rounded-xl shadow-sm p-3">
                <div className="font-semibold text-sm">{c.person_name}</div>
                {c.has_address && c.address && (
                  <div className="text-xs text-gray-600 mt-0.5">📍 {c.address}</div>
                )}
                {c.has_address && c.lat != null && c.lng != null && (
                  <a
                    href={`https://yandex.ru/maps/?pt=${c.lng},${c.lat}&z=16`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline mt-0.5 inline-block"
                  >
                    🗺️ {c.lat.toFixed(5)}, {c.lng.toFixed(5)}
                  </a>
                )}
                <div className="text-xs text-gray-400 mt-0.5">
                  {c.orders_count} заказ(ов) · последний {c.last_order_date || '—'}
                </div>
              </div>
            ))}
            {filtered.length === 0 && <p className="text-gray-400 text-sm">Ничего не найдено.</p>}
          </div>
        </>
      )}
    </div>
  );
}
