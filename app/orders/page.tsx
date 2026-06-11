'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { listOrders, createSession } from '@/lib/api';
import AdminGate from '@/components/AdminGate';
import { useCachedList } from '@/lib/useCachedList';

export default function OrdersPage() {
  return (
    <AdminGate>
      <OrdersContent />
    </AdminGate>
  );
}

function OrdersContent() {
  const { data: orders, loading, error: loadError } = useCachedList(
    'cache:orders',
    listOrders
  );
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const router = useRouter();

  async function open(dealId: string) {
    setOpeningId(dealId);
    setError('');
    try {
      const checker = localStorage.getItem('checker_name') || '';
      const session = await createSession({ deal_id: dealId, checker_name: checker });
      router.push(`/session/${session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setOpeningId(null);
    }
  }

  const filtered = orders.filter(o => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      o.deal_id.toLowerCase().includes(q) ||
      o.doc_number.toLowerCase().includes(q) ||
      o.client_name.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] gap-3 text-gray-500">
        <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        Загрузка заказов из Smartup...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold">Заказы из Smartup</h2>
        <span className="text-sm text-gray-400">{filtered.length} шт.</span>
      </div>

      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="🔍 Поиск по ID, номеру или клиенту..."
        className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm mb-4
                   outline-none focus:border-blue-400 transition-colors"
      />

      {(error || loadError) && <p className="text-red-500 text-sm mb-3">{error || loadError}</p>}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">
          Заказов не найдено
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map(o => (
            <button
              key={o.deal_id}
              onClick={() => open(o.deal_id)}
              disabled={openingId !== null}
              className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-4 text-left
                         hover:shadow-md hover:ring-2 hover:ring-purple-200 transition-all
                         disabled:opacity-60"
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base truncate">
                  {o.client_name || `№ ${o.doc_number}`}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  ID: {o.deal_id}
                  {o.date && ` · ${o.date}`}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Позиций: {o.items_count} · Всего: {o.total_quantity} шт.
                </div>
              </div>
              {openingId === o.deal_id ? (
                <span className="w-5 h-5 border-2 border-gray-300 border-t-purple-500 rounded-full animate-spin" />
              ) : (
                <span className="text-purple-500 text-xl">→</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
