'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { listReceipts, createSession } from '@/lib/api';
import AdminGate from '@/components/AdminGate';
import { useCachedList } from '@/lib/useCachedList';

export default function ReceiptsPage() {
  return (
    <AdminGate min="admin">
      <ReceiptsContent />
    </AdminGate>
  );
}

function ReceiptsContent() {
  const { data: receipts, loading, error: loadError } = useCachedList(
    'cache:receipts',
    listReceipts
  );
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const router = useRouter();

  async function open(receiptId: string) {
    setOpeningId(receiptId);
    setError('');
    try {
      const checker = localStorage.getItem('checker_name') || '';
      const session = await createSession({ receipt_id: receiptId, checker_name: checker });
      router.push(`/session/${session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setOpeningId(null);
    }
  }

  const filtered = receipts.filter(r => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      r.receipt_id.toLowerCase().includes(q) ||
      r.number.toLowerCase().includes(q) ||
      (r.warehouse_name || '').toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] gap-3 text-gray-500">
        <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        Загрузка поступлений из Smartup...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold">📥 Приёмка (поступления)</h2>
        <span className="text-sm text-gray-400">{filtered.length} шт.</span>
      </div>

      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="🔍 Поиск по номеру или складу..."
        className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm mb-4
                   outline-none focus:border-blue-400 transition-colors"
      />

      {(error || loadError) && <p className="text-red-500 text-sm mb-3">{error || loadError}</p>}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">
          Поступлений не найдено
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map(r => (
            <button
              key={r.receipt_id}
              onClick={() => open(r.receipt_id)}
              disabled={openingId !== null}
              className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-4 text-left
                         hover:shadow-md hover:ring-2 hover:ring-emerald-200 transition-all
                         disabled:opacity-60"
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base">№ {r.number}</div>
                {r.warehouse_name && (
                  <div className="text-xs text-emerald-700 mt-0.5 truncate">
                    → {r.warehouse_name}
                  </div>
                )}
                <div className="text-xs text-gray-400 mt-0.5">
                  {r.date && `${r.date} · `}Позиций: {r.items_count} · Всего: {r.total_quantity} шт.
                </div>
              </div>
              {openingId === r.receipt_id ? (
                <span className="w-5 h-5 border-2 border-gray-300 border-t-emerald-500 rounded-full animate-spin" />
              ) : (
                <span className="text-emerald-500 text-xl">→</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
