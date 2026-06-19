'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listSessions, deleteSessionApi, setSessionStatusApi, SessionListItem, getSmartupLimits, SmartupLimit, DOC_TYPE_LABEL } from '@/lib/api';
import AdminGate from '@/components/AdminGate';
import { useAuth } from '@/components/AuthProvider';
import { useCachedList } from '@/lib/useCachedList';
import Pager from '@/components/Pager';

const PAGE_SIZE = 50;

function isToday(iso?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

// Понятное имя для endpoint лимита
function limitLabel(endpoint: string): string {
  if (endpoint.includes('movement')) return 'Накладные';
  if (endpoint.includes('order')) return 'Заказы';
  if (endpoint.includes('inventory') || endpoint.includes('product')) return 'Справочник';
  if (endpoint.includes('balance')) return 'Остатки';
  if (endpoint.includes('warehouse')) return 'Склады';
  return endpoint.split('/').pop() || endpoint;
}

function Dashboard({ sessions }: { sessions: SessionListItem[] }) {
  const [limits, setLimits] = useState<SmartupLimit[]>([]);

  useEffect(() => {
    getSmartupLimits().then(setLimits).catch(() => {});
  }, []);

  const stats = useMemo(() => {
    const today = sessions.filter(s => isToday(s.finished_at || s.created_at));
    const finished = today.filter(s => s.status === 'finished');
    const clean = finished.filter(s => s.summary.done_items === s.summary.total_items && s.summary.total_items > 0);
    const withDiff = finished.length - clean.length;
    const active = today.filter(s => s.status === 'active').length;

    const byChecker = new Map<string, number>();
    for (const s of today) {
      const name = s.checker_name || '—';
      byChecker.set(name, (byChecker.get(name) || 0) + 1);
    }
    const checkers = Array.from(byChecker.entries()).sort((a, b) => b[1] - a[1]);

    return { total: today.length, finished: finished.length, clean: clean.length, withDiff, active, checkers };
  }, [sessions]);

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <span className="font-semibold">📊 Сегодня</span>
        <span className="text-xs text-gray-400">{new Date().toLocaleDateString('ru-RU')}</span>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center mb-3">
        <div className="bg-gray-50 rounded-lg py-2">
          <div className="text-xl font-bold">{stats.total}</div>
          <div className="text-[11px] text-gray-400">всего</div>
        </div>
        <div className="bg-green-50 rounded-lg py-2">
          <div className="text-xl font-bold text-green-600">{stats.clean}</div>
          <div className="text-[11px] text-gray-400">без ошибок</div>
        </div>
        <div className="bg-amber-50 rounded-lg py-2">
          <div className="text-xl font-bold text-amber-600">{stats.withDiff}</div>
          <div className="text-[11px] text-gray-400">расхожд.</div>
        </div>
        <div className="bg-blue-50 rounded-lg py-2">
          <div className="text-xl font-bold text-blue-600">{stats.active}</div>
          <div className="text-[11px] text-gray-400">в работе</div>
        </div>
      </div>

      {stats.checkers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {stats.checkers.map(([name, n]) => (
            <span key={name} className="text-xs bg-gray-100 rounded-full px-2.5 py-1">
              👤 {name}: <strong>{n}</strong>
            </span>
          ))}
        </div>
      )}

      {limits.length > 0 && (
        <div className="border-t border-gray-100 pt-2">
          <div className="text-[11px] text-gray-400 mb-1.5">Лимиты Smartup (осталось сегодня):</div>
          <div className="flex flex-wrap gap-1.5">
            {limits.map(l => {
              const low = l.left !== null && l.left <= 20;
              return (
                <span
                  key={l.endpoint}
                  className={`text-xs rounded-full px-2.5 py-1 ${low ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}
                  title={l.endpoint}
                >
                  {limitLabel(l.endpoint)}: <strong>{l.left ?? '?'}{l.total ? `/${l.total}` : ''}</strong>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function fmt(iso?: string | null) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function resultBadge(s: SessionListItem) {
  const { summary, status } = s;
  if (status === 'active') {
    return <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-100 text-blue-700">В работе</span>;
  }
  if (summary.done_items === summary.total_items && summary.total_items > 0) {
    return <span className="text-xs font-semibold px-2 py-1 rounded-full bg-green-100 text-green-700">✅ Всё собрано</span>;
  }
  return <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-700">⚠️ Расхождения</span>;
}

export default function HistoryPage() {
  return (
    <AdminGate>
      <HistoryContent />
    </AdminGate>
  );
}

function HistoryContent() {
  const { data: cachedSessions, loading, error } = useCachedList(
    'cache:history',
    listSessions,
    30_000 // история обновляется чаще — окно «свежести» меньше
  );
  const { session: authSession } = useAuth();
  const isAdmin = authSession?.role === 'admin';
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [sessions, setSessions] = useState<SessionListItem[]>([]);

  useEffect(() => { setSessions(cachedSessions); }, [cachedSessions]);

  function syncCache(next: SessionListItem[]) {
    setSessions(next);
    try {
      sessionStorage.setItem('cache:history', JSON.stringify({ t: Date.now(), v: next }));
    } catch {
      // переполнение sessionStorage — не страшно
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Удалить эту запись проверки из истории?')) return;
    setBusyId(id);
    setActionError('');
    try {
      await deleteSessionApi(id);
      syncCache(sessions.filter(s => s.id !== id));
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleStatus(s: SessionListItem) {
    const next = s.status === 'finished' ? 'active' : 'finished';
    setBusyId(s.id);
    setActionError('');
    try {
      const updated = await setSessionStatusApi(s.id, next);
      syncCache(sessions.map(item => item.id === s.id
        ? { ...item, status: updated.status, finished_at: updated.finished_at }
        : item));
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const shown = sessions.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] gap-3 text-gray-500">
        <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        Загрузка истории...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold">История проверок</h2>
        <span className="text-sm text-gray-400">{sessions.length} шт.</span>
      </div>

      <Dashboard sessions={sessions} />

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
      {actionError && <p className="text-red-500 text-sm mb-3">{actionError}</p>}

      {sessions.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">
          Проверок пока нет
        </div>
      ) : (
        <>
        <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
        <div className="flex flex-col gap-2.5">
          {shown.map(s => (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/session/${s.id}`)}
              onKeyDown={e => { if (e.key === 'Enter') router.push(`/session/${s.id}`); }}
              className="bg-white rounded-xl shadow-sm p-4 flex flex-col gap-2 text-left cursor-pointer
                         hover:shadow-md hover:ring-2 hover:ring-blue-200 transition-all"
            >
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-base flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      s.doc_type === 'order' ? 'bg-purple-100 text-purple-700'
                      : s.doc_type === 'transfer' ? 'bg-teal-100 text-teal-700'
                      : s.doc_type === 'receipt' ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-blue-100 text-blue-700'
                    }`}>
                      {DOC_TYPE_LABEL[s.doc_type] || 'Документ'}
                    </span>
                    № {s.doc_number || s.doc_id}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {fmt(s.finished_at || s.created_at)}
                    {s.checker_name && ` · 👤 ${s.checker_name}`}
                  </div>
                  {s.client_name && (
                    <div className="text-xs text-gray-500 mt-0.5 truncate">🚚 {s.client_name}</div>
                  )}
                  <div className="text-xs text-gray-500 mt-1">
                    Собрано {s.summary.done_items} из {s.summary.total_items} позиций
                  </div>
                </div>
                {resultBadge(s)}
              </div>

              {isAdmin && (
                <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                  <button
                    onClick={e => { e.stopPropagation(); handleToggleStatus(s); }}
                    disabled={busyId === s.id}
                    className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700
                               hover:bg-amber-200 disabled:opacity-50 transition-colors"
                  >
                    {s.status === 'finished' ? '↩️ Вернуть в работу' : '✅ Завершить'}
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(s.id); }}
                    disabled={busyId === s.id}
                    className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700
                               hover:bg-red-200 disabled:opacity-50 transition-colors"
                  >
                    🗑️ Удалить
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
