'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  listSessions, deleteSessionApi, setSessionStatusApi,
  SessionListItem, getSmartupLimits, SmartupLimit, DOC_TYPE_LABEL,
  listRoutes, getRoute, Route, RouteWithDeliveries, DeliveryStatus,
} from '@/lib/api';
import AdminGate from '@/components/AdminGate';
import { useAuth } from '@/components/AuthProvider';
import { useCachedList } from '@/lib/useCachedList';
import Pager from '@/components/Pager';
import ConfirmModal from '@/components/ConfirmModal';

const PAGE_SIZE = 50;

// ─── Date helpers ─────────────────────────────────────────────────────────────
function isSameDay(iso: string | null | undefined, date: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === date.getFullYear() &&
    d.getMonth() === date.getMonth() &&
    d.getDate() === date.getDate();
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function fmtDay(date: Date): string {
  const today = new Date();
  const yesterday = addDays(today, -1);
  if (isSameDay(date.toISOString(), today)) return 'Сегодня';
  if (isSameDay(date.toISOString(), yesterday)) return 'Вчера';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' });
}

function limitLabel(endpoint: string): string {
  if (endpoint.includes('movement')) return 'Накладные';
  if (endpoint.includes('order')) return 'Заказы';
  if (endpoint.includes('inventory') || endpoint.includes('product')) return 'Справочник';
  if (endpoint.includes('balance')) return 'Остатки';
  if (endpoint.includes('warehouse')) return 'Склады';
  return endpoint.split('/').pop() || endpoint;
}

function fmt(iso?: string | null) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({
  sessions, limits, date, allDates, onPrev, onNext, onToday, onToggleAll,
}: {
  sessions: SessionListItem[];
  limits: SmartupLimit[];
  date: Date;
  allDates: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onToggleAll: () => void;
}) {
  const isToday = isSameDay(new Date().toISOString(), date);
  const filtered = useMemo(
    () => allDates ? sessions : sessions.filter(s => isSameDay(s.finished_at || s.created_at, date)),
    [sessions, date, allDates],
  );

  const stats = useMemo(() => {
    const finished = filtered.filter(s => s.status === 'finished');
    const clean = finished.filter(s => s.summary.done_items === s.summary.total_items && s.summary.total_items > 0);
    const byChecker = new Map<string, number>();
    for (const s of filtered) {
      const name = s.checker_name || '—';
      byChecker.set(name, (byChecker.get(name) || 0) + 1);
    }
    return {
      total: filtered.length,
      clean: clean.length,
      withDiff: finished.length - clean.length,
      active: filtered.filter(s => s.status === 'active').length,
      checkers: [...byChecker.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [filtered]);

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
      {/* Навигация по дням */}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={onPrev}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-sm">
          ←
        </button>
        <button onClick={onToday}
          className={`flex-1 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
            isToday && !allDates ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
          }`}>
          📅 {allDates ? 'Все дни' : fmtDay(date)}
          {!allDates && (
            <span className="ml-1.5 text-xs font-normal text-gray-400">
              {date.toLocaleDateString('ru-RU')}
            </span>
          )}
        </button>
        <button onClick={onNext} disabled={isToday && !allDates}
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-30 text-gray-600 font-bold text-sm">
          →
        </button>
        <button onClick={onToggleAll}
          className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
            allDates ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
          }`}>
          Все
        </button>
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
                <span key={l.endpoint} title={l.endpoint}
                  className={`text-xs rounded-full px-2.5 py-1 ${low ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
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

// ─── Badges ───────────────────────────────────────────────────────────────────
function resultBadge(s: SessionListItem) {
  if (s.status === 'active')
    return <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-100 text-blue-700">В работе</span>;
  if (s.summary.done_items === s.summary.total_items && s.summary.total_items > 0)
    return <span className="text-xs font-semibold px-2 py-1 rounded-full bg-green-100 text-green-700">✅ Всё собрано</span>;
  return <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-700">⚠️ Расхождения</span>;
}

const DELIV_COLOR: Record<DeliveryStatus, string> = {
  new: 'bg-gray-100 text-gray-600',
  assigned: 'bg-amber-100 text-amber-700',
  on_way: 'bg-blue-100 text-blue-700',
  delivered: 'bg-green-100 text-green-700',
  returned: 'bg-red-100 text-red-700',
};
const DELIV_LABEL: Record<DeliveryStatus, string> = {
  new: 'Новая', assigned: 'Назначена', on_way: 'В пути',
  delivered: 'Доставлена', returned: 'Возврат',
};

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function HistoryPage() {
  return <AdminGate><HistoryContent /></AdminGate>;
}

function HistoryContent() {
  const { data: cachedSessions, loading, error } = useCachedList('cache:history', listSessions, 30_000);
  const { session: authSession } = useAuth();
  const isAdmin = authSession?.role === 'admin';
  const router = useRouter();

  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [confirmState, setConfirmState] = useState<{ msg: string; onOk: () => void } | null>(null);

  // Day navigation
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [allDates, setAllDates] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<'sessions' | 'routes'>('sessions');

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  // Маршруты (заходы водителей) — заменяют плоский список доставок.
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null);
  const [expandedRoutes, setExpandedRoutes] = useState<Record<string, RouteWithDeliveries>>({});
  const [expandLoading, setExpandLoading] = useState<string | null>(null);

  // Limits
  const [limits, setLimits] = useState<SmartupLimit[]>([]);

  useEffect(() => { setSessions(cachedSessions); }, [cachedSessions]);
  useEffect(() => { getSmartupLimits().then(setLimits).catch(() => {}); }, []);

  const loadRoutes = useCallback(async () => {
    setRoutesLoading(true);
    try { setRoutes(await listRoutes()); }
    catch { /* ignore */ }
    finally { setRoutesLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === 'routes' && routes.length === 0) loadRoutes();
  }, [activeTab, routes.length, loadRoutes]);

  async function toggleRoute(id: string) {
    if (expandedRouteId === id) { setExpandedRouteId(null); return; }
    setExpandedRouteId(id);
    if (!expandedRoutes[id]) {
      setExpandLoading(id);
      try {
        const full = await getRoute(id);
        setExpandedRoutes((prev) => ({ ...prev, [id]: full }));
      } catch { /* ignore */ }
      finally { setExpandLoading(null); }
    }
  }

  // Reset page + selection on date change
  useEffect(() => { setPage(1); setSelectedIds(new Set()); }, [selectedDate, allDates]);

  function syncCache(next: SessionListItem[]) {
    setSessions(next);
    try { sessionStorage.setItem('cache:history', JSON.stringify({ t: Date.now(), v: next })); }
    catch { /* overflow */ }
  }

  function handleDelete(id: string) {
    setConfirmState({
      msg: 'Удалить эту запись проверки из истории?',
      onOk: async () => {
        setConfirmState(null);
        setBusyId(id);
        setActionError('');
        try {
          await deleteSessionApi(id);
          syncCache(sessions.filter(s => s.id !== id));
          setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        } catch (e) { setActionError((e as Error).message); }
        finally { setBusyId(null); }
      },
    });
  }

  function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setConfirmState({
      msg: `Удалить ${selectedIds.size} ${selectedIds.size === 1 ? 'запись' : 'записей'} из истории?`,
      onOk: async () => {
        setConfirmState(null);
        setBulkDeleting(true);
        setActionError('');
        const ids = [...selectedIds];
        try {
          await Promise.all(ids.map(id => deleteSessionApi(id)));
          syncCache(sessions.filter(s => !ids.includes(s.id)));
          setSelectedIds(new Set());
        } catch (e) { setActionError((e as Error).message); }
        finally { setBulkDeleting(false); }
      },
    });
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
    } catch (e) { setActionError((e as Error).message); }
    finally { setBusyId(null); }
  }

  // Filtered by date
  const dateSessions = useMemo(
    () => allDates ? sessions : sessions.filter(s => isSameDay(s.finished_at || s.created_at, selectedDate)),
    [sessions, selectedDate, allDates],
  );
  const dateRoutes = useMemo(
    () => allDates ? routes : routes.filter(r => isSameDay(r.finished_at || r.started_at, selectedDate)),
    [routes, selectedDate, allDates],
  );

  const totalPages = Math.max(1, Math.ceil(dateSessions.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const shown = dateSessions.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Bulk selection helpers
  const shownIds = shown.map(s => s.id);
  const allSelected = shownIds.length > 0 && shownIds.every(id => selectedIds.has(id));
  const someSelected = shownIds.some(id => selectedIds.has(id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected;
    }
  }, [someSelected, allSelected]);

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(prev => { const n = new Set(prev); shownIds.forEach(id => n.delete(id)); return n; });
    } else {
      setSelectedIds(prev => new Set([...prev, ...shownIds]));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

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
        <h2 className="text-xl font-bold">История</h2>
        <span className="text-sm text-gray-400">{sessions.length} пров. · {routes.length || '…'} маршр.</span>
      </div>

      <Dashboard
        sessions={sessions}
        limits={limits}
        date={selectedDate}
        allDates={allDates}
        onPrev={() => setSelectedDate(d => addDays(d, -1))}
        onNext={() => setSelectedDate(d => addDays(d, 1))}
        onToday={() => { setSelectedDate(new Date()); setAllDates(false); }}
        onToggleAll={() => setAllDates(v => !v)}
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-3 bg-gray-100 rounded-xl p-1">
        <button onClick={() => setActiveTab('sessions')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
            activeTab === 'sessions' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}>
          📋 Проверки ({dateSessions.length})
        </button>
        <button onClick={() => setActiveTab('routes')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
            activeTab === 'routes' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}>
          🧭 Маршруты ({dateRoutes.length})
        </button>
      </div>

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
      {actionError && <p className="text-red-500 text-sm mb-3">{actionError}</p>}

      {/* ── Sessions ── */}
      {activeTab === 'sessions' && (
        <>
          {isAdmin && dateSessions.length > 0 && (
            <div className="flex items-center gap-3 mb-2 px-1">
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="w-4 h-4 cursor-pointer"
                />
                Выбрать все на странице
              </label>
              {selectedIds.size > 0 && (
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600
                             disabled:bg-red-300 text-white transition-colors">
                  {bulkDeleting ? '⏳ Удаляю…' : `🗑️ Удалить выбранные (${selectedIds.size})`}
                </button>
              )}
            </div>
          )}

          {dateSessions.length === 0 ? (
            <div className="bg-white rounded-xl p-8 text-center text-gray-400">
              {allDates ? 'Проверок пока нет' : 'Нет проверок за этот день'}
            </div>
          ) : (
            <>
              <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
              <div className="flex flex-col gap-2.5">
                {shown.map(s => (
                  <div
                    key={s.id}
                    className={`bg-white rounded-xl shadow-sm p-4 flex flex-col gap-2 transition-all ${
                      selectedIds.has(s.id) ? 'ring-2 ring-blue-300' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {isAdmin && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(s.id)}
                          onChange={() => toggleOne(s.id)}
                          className="mt-1 w-4 h-4 shrink-0 cursor-pointer"
                        />
                      )}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => router.push(`/session/${s.id}`)}
                        onKeyDown={e => { if (e.key === 'Enter') router.push(`/session/${s.id}`); }}
                        className="flex-1 min-w-0 cursor-pointer hover:opacity-80 transition-opacity"
                      >
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
                          onClick={() => handleToggleStatus(s)}
                          disabled={busyId === s.id}
                          className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700
                                     hover:bg-amber-200 disabled:opacity-50 transition-colors">
                          {s.status === 'finished' ? '↩️ Вернуть в работу' : '✅ Завершить'}
                        </button>
                        <button
                          onClick={() => handleDelete(s.id)}
                          disabled={busyId === s.id}
                          className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700
                                     hover:bg-red-200 disabled:opacity-50 transition-colors">
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
        </>
      )}

      {/* ── Routes ── */}
      {activeTab === 'routes' && (
        <>
          {routesLoading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-gray-500 text-sm">
              <span className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
              Загрузка…
            </div>
          ) : dateRoutes.length === 0 ? (
            <div className="bg-white rounded-xl p-8 text-center text-gray-400">
              {allDates ? 'Маршрутов пока нет' : 'Нет маршрутов за этот день'}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {dateRoutes.map(r => {
                const expanded = expandedRouteId === r.id;
                const full = expandedRoutes[r.id];
                return (
                  <div key={r.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
                    <button onClick={() => toggleRoute(r.id)} className="w-full text-left px-4 py-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold truncate">👤 {r.driver_name}{r.car_number ? ` · 🚗 ${r.car_number}` : ''}</div>
                        <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-2">
                          <span>начат {fmt(r.started_at)}</span>
                          {r.finished_at && <span>завершён {fmt(r.finished_at)}</span>}
                          <span>📦 {r.delivery_ids.length} доставок</span>
                          {r.total_km > 0 && <span>🛣️ {r.total_km * 2} км</span>}
                        </div>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full shrink-0 ${
                        r.status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {r.status === 'active' ? 'В пути' : 'Завершён'}
                      </span>
                      <span className="text-gray-300 shrink-0">{expanded ? '▲' : '▼'}</span>
                    </button>

                    {expanded && (
                      <div className="px-4 pb-3 border-t border-gray-100 pt-2">
                        {expandLoading === r.id ? (
                          <div className="text-xs text-gray-400 py-1">Загрузка…</div>
                        ) : !full ? (
                          <div className="text-xs text-gray-400 py-1">Не удалось загрузить</div>
                        ) : full.deliveries.length === 0 ? (
                          <div className="text-xs text-gray-400 py-1">Нет доставок в маршруте</div>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            {full.deliveries.map(d => (
                              <div key={d.id} className="flex items-start gap-2 text-xs py-1 border-b border-gray-50 last:border-0">
                                <div className="flex-1 min-w-0">
                                  {d.kind === 'shop_to_client' && (
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 mr-1.5">
                                      🏪 {d.shop_name}
                                    </span>
                                  )}
                                  <span className="font-medium">{d.client_name || '—'}</span>
                                  {d.address && <span className="text-gray-400"> · 📍 {d.address}</span>}
                                  {d.doc_number && <span className="text-gray-400"> · 📄 {d.doc_number}</span>}
                                </div>
                                <span className={`px-2 py-0.5 rounded-full shrink-0 ${DELIV_COLOR[d.status]}`}>
                                  {DELIV_LABEL[d.status]}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {confirmState && (
        <ConfirmModal
          message={confirmState.msg}
          onOk={confirmState.onOk}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}
