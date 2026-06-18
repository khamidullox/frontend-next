'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listDeliveries, updateDelivery, Delivery, DeliveryStatus,
  DELIVERY_STATUS_LABEL, DOC_TYPE_LABEL,
} from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';

function statusClass(s: DeliveryStatus): string {
  switch (s) {
    case 'delivered': return 'bg-green-100 text-green-700';
    case 'on_way': return 'bg-blue-100 text-blue-700';
    case 'returned': return 'bg-red-100 text-red-700';
    case 'assigned': return 'bg-amber-100 text-amber-700';
    default: return 'bg-gray-100 text-gray-600';
  }
}

// Какие действия доступны водителю в зависимости от текущего статуса.
function nextActions(s: DeliveryStatus): { status: DeliveryStatus; label: string; cls: string }[] {
  switch (s) {
    case 'new':
    case 'assigned':
      return [{ status: 'on_way', label: '🚚 Взять в путь', cls: 'bg-blue-500 hover:bg-blue-600' }];
    case 'on_way':
      return [
        { status: 'delivered', label: '✅ Доставлено', cls: 'bg-green-500 hover:bg-green-600' },
        { status: 'returned', label: '↩️ Возврат', cls: 'bg-red-500 hover:bg-red-600' },
      ];
    default:
      return [];
  }
}

export default function MyDeliveriesPage() {
  const { session } = useAuth();
  const [items, setItems] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function setStatus(id: string, status: DeliveryStatus) {
    setBusyId(id);
    setError('');
    try {
      const updated = await updateDelivery(id, { status });
      setItems((prev) => prev.map((d) => (d.id === id ? updated : d)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const active = items.filter((d) => d.status !== 'delivered' && d.status !== 'returned');
  const done = items.filter((d) => d.status === 'delivered' || d.status === 'returned');

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] gap-3 text-gray-500">
        <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        Загрузка…
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold">🚚 Мои доставки</h2>
        {session && (
          <p className="text-xs text-gray-400 mt-0.5">{session.name}</p>
        )}
      </div>

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {items.length === 0 && (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">Доставок пока нет</div>
      )}

      {active.length > 0 && (
        <div className="flex flex-col gap-2.5 mb-5">
          {active.map((d) => (
            <DeliveryCard key={d.id} d={d} busy={busyId === d.id} onSet={setStatus} />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <>
          <div className="text-xs text-gray-400 font-semibold mb-2 uppercase tracking-wide">Завершённые</div>
          <div className="flex flex-col gap-2 opacity-70">
            {done.map((d) => (
              <DeliveryCard key={d.id} d={d} busy={busyId === d.id} onSet={setStatus} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DeliveryCard({
  d, busy, onSet,
}: {
  d: Delivery;
  busy: boolean;
  onSet: (id: string, s: DeliveryStatus) => void;
}) {
  const actions = nextActions(d.status);
  return (
    <div className="bg-white rounded-xl shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {d.doc_type && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
              {DOC_TYPE_LABEL[d.doc_type]} № {d.doc_number || d.doc_id}
            </span>
          )}
          <div className="font-bold text-base mt-1">{d.client_name || 'Без названия'}</div>
          {d.address && <div className="text-sm text-gray-600 mt-0.5">📍 {d.address}</div>}
          {d.note && <div className="text-xs text-gray-400 mt-0.5">📝 {d.note}</div>}
          {d.address && (
            <div className="flex gap-2 mt-2">
              <a href={`https://yandex.ru/maps/?text=${encodeURIComponent(d.address)}`} target="_blank" rel="noopener noreferrer"
                className="px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100">
                🗺️ Яндекс.Карты
              </a>
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}`} target="_blank" rel="noopener noreferrer"
                className="px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-semibold hover:bg-blue-100">
                🗺️ Google Maps
              </a>
            </div>
          )}
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusClass(d.status)}`}>
          {DELIVERY_STATUS_LABEL[d.status]}
        </span>
      </div>

      {actions.length > 0 && (
        <div className="flex gap-2 flex-wrap pt-1">
          {actions.map((a) => (
            <button key={a.status} disabled={busy} onClick={() => onSet(d.id, a.status)}
              className={`flex-1 min-w-[130px] py-3 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-colors ${a.cls}`}>
              {busy ? '⏳…' : a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
