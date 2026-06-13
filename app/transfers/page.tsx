'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { listTransfers, createSession } from '@/lib/api';
import AdminGate from '@/components/AdminGate';
import { useCachedList } from '@/lib/useCachedList';

export default function TransfersPage() {
  return (
    <AdminGate min="admin">
      <TransfersContent />
    </AdminGate>
  );
}

function TransfersContent() {
  const { data: transfers, loading, error: loadError } = useCachedList(
    'cache:transfers',
    listTransfers
  );
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const router = useRouter();

  async function open(transferId: string) {
    setOpeningId(transferId);
    setError('');
    try {
      const checker = localStorage.getItem('checker_name') || '';
      const session = await createSession({ transfer_id: transferId, checker_name: checker });
      router.push(`/session/${session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setOpeningId(null);
    }
  }

  const filtered = transfers.filter(t => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      t.transfer_id.toLowerCase().includes(q) ||
      t.number.toLowerCase().includes(q) ||
      (t.from_filial || '').toLowerCase().includes(q) ||
      (t.to_filial || '').toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] gap-3 text-gray-500">
        <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        Загрузка перемещений из Smartup...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold">🔄 Межфилиальные перемещения</h2>
        <span className="text-sm text-gray-400">{filtered.length} шт.</span>
      </div>

      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="🔍 Поиск по номеру или филиалу..."
        className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm mb-4
                   outline-none focus:border-blue-400 transition-colors"
      />

      {(error || loadError) && <p className="text-red-500 text-sm mb-3">{error || loadError}</p>}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">
          Перемещений не найдено
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map(t => (
            <button
              key={t.transfer_id}
              onClick={() => open(t.transfer_id)}
              disabled={openingId !== null}
              className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-4 text-left
                         hover:shadow-md hover:ring-2 hover:ring-teal-200 transition-all
                         disabled:opacity-60"
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base">№ {t.number}</div>
                <div className="text-xs text-teal-700 mt-0.5 truncate">
                  {t.from_filial || '—'} → {t.to_filial || '—'}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {t.date && `${t.date} · `}Позиций: {t.items_count} · Всего: {t.total_quantity} шт.
                </div>
              </div>
              {openingId === t.transfer_id ? (
                <span className="w-5 h-5 border-2 border-gray-300 border-t-teal-500 rounded-full animate-spin" />
              ) : (
                <span className="text-teal-500 text-xl">→</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
