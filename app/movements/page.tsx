'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { listMovements, createSession, MOVEMENT_STATUS_LABEL } from '@/lib/api';
import AdminGate from '@/components/AdminGate';
import { useCachedList } from '@/lib/useCachedList';
import Pager from '@/components/Pager';

const PAGE_SIZE = 50;

// Палитра как в Smartup: ожидание — лавандовый, завершено — бирюзовый.
const STATUS_STYLE: Record<string, string> = {
  N: 'bg-indigo-100 text-indigo-700',
  S: 'bg-indigo-100 text-indigo-700',
  R: 'bg-violet-100 text-violet-700',
  T: 'bg-purple-100 text-purple-700',
  D: 'bg-slate-100 text-slate-600',
  C: 'bg-teal-100 text-teal-700',
};

export default function MovementsPage() {
  return (
    <AdminGate>
      <MovementsContent />
    </AdminGate>
  );
}

function MovementsContent() {
  const { data: movements, loading, error: loadError } = useCachedList(
    'cache:movements_v2',
    listMovements
  );
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const router = useRouter();

  async function open(movementId: string) {
    setOpeningId(movementId);
    setError('');
    try {
      const checker = localStorage.getItem('checker_name') || '';
      const session = await createSession({ movement_id: movementId, checker_name: checker });
      router.push(`/session/${session.id}`);
    } catch (e) {
      setError((e as Error).message);
      setOpeningId(null);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  // Статусы, которые реально встречаются в списке
  const statuses = Array.from(new Set(movements.map(m => m.status).filter(Boolean)));

  const filtered = movements.filter(m => {
    if (statusFilter && m.status !== statusFilter) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      m.movement_id.toLowerCase().includes(q) ||
      m.movement_number.toLowerCase().includes(q)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const shown = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] gap-3 text-gray-500">
        <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        Загрузка накладных из Smartup...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold">Накладные из Smartup</h2>
        <span className="text-sm text-gray-400">{filtered.length} шт.</span>
      </div>

      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="🔍 Поиск по ID или номеру..."
        className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm mb-3
                   outline-none focus:border-blue-400 transition-colors"
      />

      {statuses.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button
            onClick={() => setStatusFilter('')}
            className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
              statusFilter === '' ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Все
          </button>
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                statusFilter === s ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {MOVEMENT_STATUS_LABEL[s] || s}
            </button>
          ))}
        </div>
      )}

      {(error || loadError) && <p className="text-red-500 text-sm mb-3">{error || loadError}</p>}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">
          Накладных не найдено
        </div>
      ) : (
        <>
        <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
        <div className="flex flex-col gap-2.5">
          {shown.map(m => (
            <button
              key={m.movement_id}
              onClick={() => open(m.movement_id)}
              disabled={openingId !== null}
              className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-4 text-left
                         hover:shadow-md hover:ring-2 hover:ring-indigo-200 transition-all
                         disabled:opacity-60"
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base flex items-center gap-2">
                  № {m.movement_number}
                  {m.status && m.status !== 'C' && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_STYLE[m.status] || 'bg-gray-100 text-gray-600'}`}>
                      {MOVEMENT_STATUS_LABEL[m.status] || m.status}
                    </span>
                  )}
                </div>
                {(m.from_warehouse_name || m.to_warehouse_name) && (
                  <div className="text-xs text-teal-700 mt-0.5 truncate">
                    {m.from_warehouse_name || '—'} → {m.to_warehouse_name || '—'}
                  </div>
                )}
                <div className="text-xs text-gray-400 mt-0.5">
                  ID: {m.movement_id}
                  {m.from_movement_date && ` · ${m.from_movement_date}`}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Позиций: {m.items_count} · Всего: {m.total_quantity} шт.
                </div>
              </div>
              {openingId === m.movement_id ? (
                <span className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              ) : (
                <span className="text-indigo-500 text-xl">→</span>
              )}
            </button>
          ))}
        </div>
        <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
