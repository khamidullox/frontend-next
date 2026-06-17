'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminGate from '@/components/AdminGate';
import {
  listDeliveries, createDelivery, updateDelivery, deleteDeliveryApi, listDrivers,
  Delivery, DeliveryStatus, DELIVERY_STATUS_LABEL, DOC_TYPE_LABEL, UserInfo,
} from '@/lib/api';
import Pager from '@/components/Pager';

const PAGE_SIZE = 50;
const STATUSES: DeliveryStatus[] = ['new', 'assigned', 'on_way', 'delivered', 'returned'];

function statusClass(s: DeliveryStatus): string {
  switch (s) {
    case 'delivered': return 'bg-green-100 text-green-700';
    case 'on_way': return 'bg-blue-100 text-blue-700';
    case 'returned': return 'bg-red-100 text-red-700';
    case 'assigned': return 'bg-amber-100 text-amber-700';
    default: return 'bg-gray-100 text-gray-600';
  }
}

function fmt(iso?: string | null) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

export default function LogisticsPage() {
  return (
    <AdminGate min="manager">
      <LogisticsContent />
    </AdminGate>
  );
}

function LogisticsContent() {
  const [items, setItems] = useState<Delivery[]>([]);
  const [drivers, setDrivers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | DeliveryStatus>('all');

  // Форма создания.
  const [mode, setMode] = useState<'document' | 'manual'>('document');
  const [query, setQuery] = useState('');
  const [client, setClient] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [driverUser, setDriverUser] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await listDeliveries());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { listDrivers().then(setDrivers).catch(() => {}); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createDelivery(
        mode === 'document'
          ? { query: query.trim(), client_name: client.trim(), address: address.trim(), note: note.trim(), driver_username: driverUser || undefined }
          : { client_name: client.trim(), address: address.trim(), note: note.trim(), driver_username: driverUser || undefined }
      );
      setQuery(''); setClient(''); setAddress(''); setNote(''); setDriverUser('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, p: Parameters<typeof updateDelivery>[1]) {
    setError('');
    try {
      const updated = await updateDelivery(id, p);
      setItems((prev) => prev.map((d) => (d.id === id ? updated : d)));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    if (!confirm('Удалить доставку?')) return;
    setError('');
    try {
      await deleteDeliveryApi(id);
      setItems((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const shown = items.filter((d) => filter === 'all' || d.status === filter);
  const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = shown.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xl font-bold">🚚 Логистика <span className="text-sm text-gray-400 font-normal">({items.length})</span></h2>
      </div>

      {/* Создание доставки */}
      <form onSubmit={add} className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-col gap-2">
        <div className="flex items-center gap-2 mb-1">
          <button type="button" onClick={() => setMode('document')}
            className={`text-xs px-3 py-1.5 rounded-full font-semibold ${mode === 'document' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
            Из документа
          </button>
          <button type="button" onClick={() => setMode('manual')}
            className={`text-xs px-3 py-1.5 rounded-full font-semibold ${mode === 'manual' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
            Вручную
          </button>
        </div>

        {mode === 'document' && (
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="ID накладной / заказа (напр. 3951537)"
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={client} onChange={(e) => setClient(e.target.value)}
            placeholder="Клиент / куда"
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <input value={address} onChange={(e) => setAddress(e.target.value)}
            placeholder="Адрес доставки"
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>

        <input value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Примечание (необязательно)"
          className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />

        <div className="flex items-center gap-2 flex-wrap">
          <select value={driverUser} onChange={(e) => setDriverUser(e.target.value)}
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400">
            <option value="">Водитель — назначить позже</option>
            {drivers.map((d) => (
              <option key={d.username} value={d.username}>
                {d.name}{d.car_number ? ` · ${d.car_number}` : ''}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy || (mode === 'document' && !query.trim() && !client.trim())}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg">
            {busy ? '⏳…' : '+ Создать доставку'}
          </button>
        </div>
        {drivers.length === 0 && (
          <p className="text-xs text-amber-600">Водителей пока нет — добавьте их в разделе «Пользователи» (роль «Водитель»).</p>
        )}
      </form>

      {/* Фильтр по статусу */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {(['all', ...STATUSES] as const).map((s) => (
          <button key={s} onClick={() => { setFilter(s); setPage(1); }}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              filter === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-600 border-gray-200 hover:border-slate-300'
            }`}>
            {s === 'all' ? 'Все' : DELIVERY_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {loading ? (
        <div className="text-gray-500 text-sm">Загрузка…</div>
      ) : shown.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">Доставок нет</div>
      ) : (
        <>
          <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
          <div className="flex flex-col gap-2.5">
            {pageItems.map((d) => (
              <div key={d.id} className="bg-white rounded-xl shadow-sm p-4 flex flex-col gap-2">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-base flex items-center gap-2 flex-wrap">
                      {d.doc_type && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                          {DOC_TYPE_LABEL[d.doc_type]} № {d.doc_number || d.doc_id}
                        </span>
                      )}
                      <span className="truncate">{d.client_name || 'Без названия'}</span>
                    </div>
                    {d.address && <div className="text-xs text-gray-500 mt-0.5">📍 {d.address}</div>}
                    {d.note && <div className="text-xs text-gray-400 mt-0.5">📝 {d.note}</div>}
                    <div className="text-xs text-gray-400 mt-0.5">создано {fmt(d.created_at)}{d.created_by ? ` · ${d.created_by}` : ''}</div>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusClass(d.status)}`}>
                    {DELIVERY_STATUS_LABEL[d.status]}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-gray-100">
                  <select value={d.driver_username || ''} onChange={(e) => patch(d.id, { driver_username: e.target.value || null })}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-400">
                    <option value="">— водитель —</option>
                    {drivers.map((dr) => (
                      <option key={dr.username} value={dr.username}>
                        {dr.name}{dr.car_number ? ` · ${dr.car_number}` : ''}
                      </option>
                    ))}
                  </select>
                  <select value={d.status} onChange={(e) => patch(d.id, { status: e.target.value as DeliveryStatus })}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-400">
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{DELIVERY_STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                  {d.car_number && <span className="text-xs text-gray-500">🚗 {d.car_number}{d.transport ? ` (${d.transport})` : ''}</span>}
                  <button onClick={() => remove(d.id)}
                    className="ml-auto text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700 hover:bg-red-200">
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
