'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminGate from '@/components/AdminGate';
import { useAuth } from '@/components/AuthProvider';
import { listShopRequests, createShopRequest, updateDelivery, listIncomingDeliveries, Delivery, DeliveryItem, DeliveryStatus, DELIVERY_STATUS_LABEL } from '@/lib/api';
import LocationPicker from '@/components/LocationPicker';
import ProductPicker from '@/components/ProductPicker';

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
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
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

  const [client, setClient] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [orderItems, setOrderItems] = useState<DeliveryItem[]>([]);
  const [lat, setLat] = useState<number | undefined>(undefined);
  const [lng, setLng] = useState<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      setItems(await listShopRequests());
      setIncoming(await listIncomingDeliveries());
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
        client_name: client.trim(), client_phone: phone.trim(), address: address.trim(), note: note.trim(),
        items: orderItems, lat, lng,
      });
      setClient(''); setPhone(''); setAddress(''); setNote(''); setOrderItems([]); setLat(undefined); setLng(undefined);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {incoming.length > 0 && (
        <div className="mb-4">
          <h2 className="text-sm font-bold text-gray-600 mb-2">📦 Едет к нам со склада</h2>
          <div className="flex flex-col gap-1.5">
            {incoming.map((d) => (
              <div key={d.id} className="bg-white rounded-xl shadow-sm px-4 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {d.doc_number ? `Накладная № ${d.doc_number}` : (d.from_name || 'Накладная')}
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
            ))}
          </div>
        </div>
      )}

      <div className="mb-4">
        <h2 className="text-xl font-bold">🚚 Заказы клиентам</h2>
        <p className="text-xs text-gray-400 mt-0.5">Доставка от вашего магазина до покупателя — водитель заберёт по пути</p>
      </div>

      <form onSubmit={add} className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-col gap-2">
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

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {loading ? (
        <div className="text-gray-500 text-sm">Загрузка…</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">Заявок пока нет</div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((d) => (
            <div key={d.id} className="bg-white rounded-xl shadow-sm px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{d.client_name || '—'}</div>
                {d.address && <div className="text-xs text-gray-400 mt-0.5 truncate">📍 {d.address}</div>}
                {d.client_phone && <div className="text-xs text-gray-400 mt-0.5">📞 {d.client_phone}</div>}
                {d.items.length > 0 && (
                  <div className="text-xs text-gray-400 mt-0.5 truncate">
                    📦 {d.items.map((it) => `${it.name} ×${it.qty}`).join(', ')}
                  </div>
                )}
                <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-2">
                  {d.driver_name && <span>👤 {d.driver_name}</span>}
                  {d.lat != null && d.lng != null && <span className="text-emerald-600">📌 на карте</span>}
                  <span>{fmt(d.created_at)}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusClass(d.status)}`}>
                  {DELIVERY_STATUS_LABEL[d.status]}
                </span>
                <button onClick={() => togglePicked(d)}
                  className={`text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${
                    d.picked ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}>
                  {d.picked ? '✓ Собрано' : '📦 Собрать'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
