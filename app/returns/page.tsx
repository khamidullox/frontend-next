'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { listReturns, createSession } from '@/lib/api';
import AdminGate from '@/components/AdminGate';
import { useCachedList } from '@/lib/useCachedList';

export default function ReturnsPage() {
  return (
    <AdminGate>
      <ReturnsContent />
    </AdminGate>
  );
}

function ReturnsContent() {
  const { data: returns, loading, error: loadError } = useCachedList(
    'cache:returns',
    listReturns
  );
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const router = useRouter();

  async function open(returnId: string) {
    setOpeningId(returnId);
    setError('');
    try {
      const checker = localStorage.getItem('checker_name') || '';
      const session = await createSession({ return_id: returnId, checker_name: checker });
      router.push(`/session/${session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setOpeningId(null);
    }
  }

  const filtered = returns.filter(r => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      r.return_id.toLowerCase().includes(q) ||
      r.number.toLowerCase().includes(q) ||
      (r.supplier_code || '').toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] gap-3 text-gray-500">
        <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        Загрузка возвратов из Smartup...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold">↩️ Возвраты</h2>
        <span className="text-sm text-gray-400">{filtered.length} шт.</span>
      </div>

      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="🔍 Поиск по номеру или поставщику..."
        className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm mb-4
                   outline-none focus:border-blue-400 transition-colors"
      />

      {(error || loadError) && <p className="text-red-500 text-sm mb-3">{error || loadError}</p>}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">
          Возвратов не найдено
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map(r => (
            <button
              key={r.return_id}
              onClick={() => open(r.return_id)}
              disabled={openingId !== null}
              className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-4 text-left
                         hover:shadow-md hover:ring-2 hover:ring-orange-200 transition-all
                         disabled:opacity-60"
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base">№ {r.number}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {r.supplier_code && `Поставщик: ${r.supplier_code} · `}
                  {r.date}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Позиций: {r.items_count} · Всего: {r.total_quantity} шт.
                </div>
              </div>
              {openingId === r.return_id ? (
                <span className="w-5 h-5 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" />
              ) : (
                <span className="text-orange-500 text-xl">→</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
