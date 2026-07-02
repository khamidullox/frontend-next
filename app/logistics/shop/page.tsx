'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminGate from '@/components/AdminGate';
import { useAuth } from '@/components/AuthProvider';
import {
  listShopRequests, createShopRequest, updateDelivery,
  listIncomingDeliveries, Delivery, DeliveryItem, DeliveryStatus, DELIVERY_STATUS_LABEL,
} from '@/lib/api';
import LocationPicker from '@/components/LocationPicker';
import ProductPicker from '@/components/ProductPicker';
import { fmtDateTime as fmt } from '@/lib/format';

function statusClass(s: DeliveryStatus): string {
  switch (s) {
    case 'delivered': return 'bg-green-100 text-green-700';
    case 'on_way': return 'bg-blue-100 text-blue-700';
    case 'returned': return 'bg-red-100 text-red-700';
    case 'assigned': return 'bg-amber-100 text-amber-700';
    default: return 'bg-gray-100 text-gray-600';
  }
}

function isToday(iso: string) {
  try {
    return new Date(iso).toDateString() === new Date().toDateString();
  } catch { return false; }
}

export default function ShopRequestPage() {
  return (
    <AdminGate min="worker">
      <ShopRequestContent />
    </AdminGate>
  );
}

function ShopRequestContent() {
  const { session } = useAuth();
  const [items, setItems] = useState<Delivery[]>([]);
  const [incoming, setIncoming] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Раскрытые секции
  const [incomingOpen, setIncomingOpen] = useState(true);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const [client, setClient] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [orderItems, setOrderItems] = useState<DeliveryItem[]>([]);
  const [lat, setLat] = useState<number | undefined>(undefined);
  const [lng, setLng] = useState<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const [reqs, inc] = await Promise.all([listShopRequests(), listIncomingDeliveries()]);
      setItems(reqs);
      setIncoming(inc);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function togglePicked(d: Delivery) {
    try {
      const updated = await updateDelivery(d.id, { picked: !d.picked });
      setItems((prev) => prev.map((x) => (x.id === d.id ? updated : x)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (session && session.role === 'worker' && !session.shop_id) {
    return (
      <div className="bg-white rounded-xl p-8 text-center text-gray-400">
        Ваш аккаунт не привязан к магазину — обратитесь к администратору.
      </div>
    );
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createShopRequest({
        client_name: client.trim(), client_phone: phone.trim(),
        address: address.trim(), note: note.trim(),
        items: orderItems, lat, lng,
      });
      setClient(''); setPhone(''); setAddress(''); setNote('');
      setOrderItems([]); setLat(undefined); setLng(undefined);
      setFormOpen(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Группировка заявок магазина (shop_to_client)
  const onWay = items.filter((d) => d.status === 'on_way');
  const todayActive = items.filter((d) =>
    d.status !== 'on_way' &&
    d.status !== 'delivered' &&
    d.status !== 'returned' &&
    isToday(d.created_at)
  );
  // «Входящие в пути» — только те, что ещё не доставлены
  const incomingOnWay = incoming.filter((d) => d.status === 'on_way' || d.status === 'assigned');
  // «Доставлено» у входящих → сразу в архив
  const incomingDelivered = incoming.filter((d) => d.status === 'delivered' || d.status === 'returned');
  // Архив — завершённые заявки клиентам + доставленные входящие
  const archive = [
    ...items.filter((d) =>
      d.status === 'delivered' ||
      d.status === 'returned' ||
      (!isToday(d.created_at) && d.status !== 'on_way')
    ),
    ...incomingDelivered,
  ].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  if (loading) {
    return <div className="text-gray-400 text-sm p-4">Загрузка…</div>;
  }

  return (
    <div className="flex flex-col gap-3 pb-6">
      {error && <p className="text-red-500 text-sm">{error}</p>}

      {/* ── 1. ФОРМА создания заявки — СВЕРХУ (коллапс) ── */}
      <section className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <button
          onClick={() => setFormOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold text-blue-600 hover:bg-blue-50"
        >
          <span>+ Новая заявка клиенту</span>
          <span className="text-gray-400 text-xs">{formOpen ? '▲' : '▼'}</span>
        </button>
        {formOpen && (
          <form onSubmit={add} className="px-4 pb-4 flex flex-col gap-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={client} onChange={(e) => setClient(e.target.value)} autoComplete="off"
                placeholder="Имя клиента"
                className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" type="tel"
                placeholder="Телефон клиента"
                className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </div>
            <input value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="off"
              placeholder="Адрес доставки"
              className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
            <input value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off"
              placeholder="Примечание (необязательно)"
              className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
            <ProductPicker items={orderItems} onChange={setOrderItems} />
            <LocationPicker lat={lat} lng={lng} onChange={(la, ln) => { setLat(la); setLng(ln); }} />
            <button type="submit" disabled={busy || !client.trim() || !address.trim()}
              className="self-start px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg">
              {busy ? '⏳…' : '+ Создать заявку'}
            </button>
          </form>
        )}
      </section>

      {/* ── 2. В ПУТИ: водитель уже везёт заказ ── */}
      {(onWay.length > 0 || incomingOnWay.length > 0) && (
        <section className="bg-blue-50 border border-blue-200 rounded-2xl p-3">
          <h2 className="text-sm font-bold text-blue-700 mb-2">🚗 В пути</h2>
          <div className="flex flex-col gap-2">
            {incomingOnWay.map((d) => (
              <IncomingCard key={d.id} d={d} label="со склада" />
            ))}
            {onWay.map((d) => (
              <ShopCard key={d.id} d={d} onTogglePicked={togglePicked} />
            ))}
          </div>
        </section>
      )}

      {/* ── 3. СЕГОДНЯ: активные заявки без завершения ── */}
      {todayActive.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-gray-600 mb-2">
            📋 Сегодня · активные ({todayActive.length})
          </h2>
          <div className="flex flex-col gap-2">
            {todayActive.map((d) => (
              <ShopCard key={d.id} d={d} onTogglePicked={togglePicked} />
            ))}
          </div>
        </section>
      )}

      {/* ── 4. ВХОДЯЩИЕ со склада — только активные (коллапс) ── */}
      {incomingOnWay.length === 0 && incoming.length > incomingDelivered.length && (
        <section className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <button
            onClick={() => setIncomingOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            <span>📦 Едет к нам со склада ({incoming.length - incomingDelivered.length})</span>
            <span className="text-gray-400 text-xs">{incomingOpen ? '▲' : '▼'}</span>
          </button>
          {incomingOpen && (
            <div className="flex flex-col gap-1.5 px-3 pb-3">
              {incoming
                .filter((d) => d.status !== 'delivered' && d.status !== 'returned')
                .map((d) => <IncomingCard key={d.id} d={d} />)}
            </div>
          )}
        </section>
      )}

      {/* ── 5. АРХИВ (коллапс): завершённые заявки + доставленные входящие ── */}
      {archive.length > 0 && (
        <section className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <button
            onClick={() => setArchiveOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            <span>🗂 Архив ({archive.length})</span>
            <span className="text-gray-400 text-xs">{archiveOpen ? '▲' : '▼'}</span>
          </button>
          {archiveOpen && (
            <div className="flex flex-col gap-2 px-3 pb-3">
              {archive.map((d) =>
                d.kind === 'shop_to_client'
                  ? <ShopCard key={d.id} d={d} onTogglePicked={togglePicked} compact />
                  : <IncomingCard key={d.id} d={d} />
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ─── Карточка входящей доставки (со склада) ───────────────────────────────
function IncomingCard({ d, label }: { d: Delivery; label?: string }) {
  return (
    <div className="bg-white rounded-xl px-3 py-2.5 flex items-center gap-3 shadow-sm">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {d.doc_number ? `Накладная № ${d.doc_number}` : (d.from_name || 'Накладная')}
          {label && <span className="ml-1.5 text-[11px] text-gray-400">{label}</span>}
        </div>
        <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-2">
          {d.driver_name && <span>👤 {d.driver_name}</span>}
          {d.car_number && <span>🚗 {d.car_number}</span>}
          <span>{fmt(d.updated_at)}</span>
        </div>
      </div>
      <span className={`text-xs font-semibold px-2 py-1 rounded-full shrink-0 ${statusClass(d.status)}`}>
        {DELIVERY_STATUS_LABEL[d.status]}
      </span>
    </div>
  );
}

// ─── Карточка заявки клиенту (shop_to_client) ─────────────────────────────
function ShopCard({
  d, onTogglePicked, compact,
}: {
  d: Delivery;
  onTogglePicked: (d: Delivery) => void;
  compact?: boolean;
}) {
  return (
    <div className={`bg-white rounded-xl shadow-sm px-3 py-2.5 flex items-start gap-3 ${compact ? 'opacity-70' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className={`font-semibold truncate ${compact ? 'text-xs' : 'text-sm'}`}>
          {d.client_name || '—'}
        </div>
        {d.address && (
          <div className="text-xs text-gray-400 mt-0.5 truncate">📍 {d.address}</div>
        )}
        {d.client_phone && !compact && (
          <a href={`tel:${d.client_phone}`} className="text-xs text-blue-600 mt-0.5 inline-block hover:underline">
            📞 {d.client_phone}
          </a>
        )}
        {d.items.length > 0 && !compact && (
          <div className="text-xs text-gray-400 mt-0.5 truncate">
            📦 {d.items.map((it) => `${it.name} ×${it.qty}`).join(', ')}
          </div>
        )}
        <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-2">
          {d.driver_name && <span>👤 {d.driver_name}</span>}
          {d.lat != null && d.lng != null && (
            <a
              href={`https://yandex.ru/maps/?ll=${d.lng},${d.lat}&z=15&pt=${d.lng},${d.lat}`}
              target="_blank" rel="noopener noreferrer"
              className="text-emerald-600 hover:underline"
            >
              📌 на карте
            </a>
          )}
          <span>{fmt(d.created_at)}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusClass(d.status)}`}>
          {DELIVERY_STATUS_LABEL[d.status]}
        </span>
        {!compact && (
          <button onClick={() => onTogglePicked(d)}
            className={`text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${
              d.picked ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}>
            {d.picked ? '✓ Собрано' : '📦 Собрать'}
          </button>
        )}
      </div>
    </div>
  );
}
