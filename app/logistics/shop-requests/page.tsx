'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminGate from '@/components/AdminGate';
import LogisticsTabs from '@/components/LogisticsTabs';
import {
  listShopRequests, updateDelivery, addDeliveriesToRoute, listDrivers, listRoutes, createShopRequest, listShops,
  Delivery, DeliveryItem, DeliveryStatus, DELIVERY_STATUS_LABEL, UserInfo, Route, Shop,
} from '@/lib/api';
import LocationPicker from '@/components/LocationPicker';
import MiniMap, { MapPoint } from '@/components/MiniMap';
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

export default function ShopRequestsManagerPage() {
  return (
    <AdminGate min="manager">
      <ShopRequestsContent />
    </AdminGate>
  );
}

function ShopRequestsContent() {
  const [items, setItems] = useState<Delivery[]>([]);
  const [drivers, setDrivers] = useState<UserInfo[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [activeRoutes, setActiveRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [onlyPicked, setOnlyPicked] = useState(false);

  // Форма создания заявки (от имени магазина) — для админа/менеджера.
  const [showForm, setShowForm] = useState(false);
  const [formShopId, setFormShopId] = useState('');
  const [formClient, setFormClient] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formItems, setFormItems] = useState<DeliveryItem[]>([]);
  const [formLat, setFormLat] = useState<number | undefined>(undefined);
  const [formLng, setFormLng] = useState<number | undefined>(undefined);
  const [formBusy, setFormBusy] = useState(false);
  const [shopSearch, setShopSearch] = useState('');
  const [showShopList, setShowShopList] = useState(false);

  const load = useCallback(async () => {
    try {
      const [reqs, drv, routes, shopList] = await Promise.all([listShopRequests(), listDrivers(), listRoutes(), listShops()]);
      setItems(reqs);
      setDrivers(drv);
      setActiveRoutes(routes.filter((r) => r.status === 'active'));
      setShops(shopList.filter((s) => s.type !== 'warehouse'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createForShop(e: React.FormEvent) {
    e.preventDefault();
    if (!formShopId || !formClient.trim() || !formAddress.trim()) return;
    setFormBusy(true); setError('');
    try {
      const created = await createShopRequest({
        shop_id: formShopId, client_name: formClient.trim(), client_phone: formPhone.trim(), address: formAddress.trim(),
        note: formNote.trim(), items: formItems, lat: formLat, lng: formLng,
      });
      setItems((prev) => [created, ...prev]);
      setFormClient(''); setFormPhone(''); setFormAddress(''); setFormNote(''); setFormItems([]);
      setFormLat(undefined); setFormLng(undefined);
      setFormShopId(''); setShopSearch('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setFormBusy(false);
    }
  }

  const routeByDriver = useMemo(() => {
    const m = new Map<string, Route>();
    for (const r of activeRoutes) m.set(r.driver_username, r);
    return m;
  }, [activeRoutes]);

  async function assign(d: Delivery, driverUsername: string) {
    setBusyId(d.id);
    setError('');
    try {
      const updated = await updateDelivery(d.id, { driver_username: driverUsername || null });
      setItems((prev) => prev.map((x) => (x.id === d.id ? updated : x)));

      // Если водитель уже в пути с активным маршрутом — присоединяем доставку сразу.
      const route = routeByDriver.get(driverUsername);
      if (route) {
        await addDeliveriesToRoute(route.id, [d.id]);
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function togglePicked(d: Delivery) {
    setBusyId(d.id);
    setError('');
    try {
      const updated = await updateDelivery(d.id, { picked: !d.picked });
      setItems((prev) => prev.map((x) => (x.id === d.id ? updated : x)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const allPending = items.filter((d) => !['delivered', 'returned'].includes(d.status));
  const pending = onlyPicked ? allPending.filter((d) => d.picked) : allPending;
  const done = items.filter((d) => ['delivered', 'returned'].includes(d.status));

  // Точки на карте: заявки (куда доставлять) — оранжевым, магазины-точки — синим.
  const mapPoints = useMemo<MapPoint[]>(() => {
    const pts: MapPoint[] = [];
    for (const d of pending) {
      if (typeof d.lat === 'number' && typeof d.lng === 'number') {
        pts.push({
          lat: d.lat, lng: d.lng, color: '#f97316',
          label: `🚚 ${d.client_name || 'Заявка'}${d.address ? '<br/>📍 ' + d.address : ''}`,
        });
      }
    }
    for (const s of shops) {
      if (typeof s.lat === 'number' && typeof s.lng === 'number') {
        pts.push({ lat: s.lat, lng: s.lng, color: '#2563eb', label: `🏪 ${s.name}` });
      }
    }
    return pts;
  }, [pending, shops]);

  return (
    <div>
      <LogisticsTabs />
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="text-xl font-bold">🏪 Заявки магазинов <span className="text-sm text-gray-400 font-normal">({pending.length})</span></h2>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer ml-2">
          <input type="checkbox" checked={onlyPicked} onChange={(e) => setOnlyPicked(e.target.checked)} />
          Только собранные
        </label>
        <button onClick={() => setShowForm((v) => !v)}
          className="ml-auto px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded-lg whitespace-nowrap">
          {showForm ? '✕ Закрыть' : '+ Создать заявку'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createForShop} className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-col gap-2">
          <div className="relative">
            <input
              value={shopSearch}
              onChange={(e) => { setShopSearch(e.target.value); setShowShopList(true); setFormShopId(''); }}
              onFocus={() => setShowShopList(true)}
              onBlur={() => setTimeout(() => setShowShopList(false), 150)}
              placeholder="🔍 Магазин — поиск по названию или городу"
              autoComplete="off"
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
            {formShopId && !showShopList && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600 text-xs">✓ выбран</span>
            )}
            {showShopList && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                {shops
                  .filter((s) => {
                    const q = shopSearch.trim().toLowerCase();
                    if (!q) return true;
                    return s.name.toLowerCase().includes(q) || (s.direction || '').toLowerCase().includes(q);
                  })
                  .slice(0, 30)
                  .map((s) => (
                    <button key={s.id} type="button"
                      onMouseDown={() => { setFormShopId(s.id); setShopSearch(s.name); setShowShopList(false); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-50 last:border-0 flex items-center justify-between gap-2">
                      <span className="truncate">🏪 {s.name}</span>
                      {s.direction && <span className="text-[10px] text-sky-600 shrink-0">{s.direction}</span>}
                    </button>
                  ))}
                {shops.filter((s) => {
                  const q = shopSearch.trim().toLowerCase();
                  if (!q) return true;
                  return s.name.toLowerCase().includes(q) || (s.direction || '').toLowerCase().includes(q);
                }).length === 0 && (
                  <div className="px-3 py-2 text-xs text-gray-400">Ничего не найдено</div>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={formClient} onChange={(e) => setFormClient(e.target.value)} autoComplete="off"
              placeholder="Имя клиента"
              className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
            <input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} autoComplete="off" type="tel"
              placeholder="Телефон клиента"
              className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          </div>
          <input value={formAddress} onChange={(e) => setFormAddress(e.target.value)} autoComplete="off"
            placeholder="Адрес доставки"
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <input value={formNote} onChange={(e) => setFormNote(e.target.value)} autoComplete="off"
            placeholder="Примечание (необязательно)"
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <ProductPicker items={formItems} onChange={setFormItems} />
          <LocationPicker lat={formLat} lng={formLng} onChange={(la, ln) => { setFormLat(la); setFormLng(ln); }} />
          <button type="submit" disabled={formBusy || !formShopId || !formClient.trim() || !formAddress.trim()}
            className="self-start px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg">
            {formBusy ? '⏳…' : '+ Создать заявку'}
          </button>
        </form>
      )}

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {/* Карта: куда доставлять (точки доставки + адреса заявок) */}
      <div className="bg-white rounded-xl shadow-sm p-3 mb-4">
        <div className="flex items-center gap-3 mb-2 text-xs text-gray-500 flex-wrap">
          <span className="font-semibold text-gray-700">🗺️ Карта доставки</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#f97316' }} /> заявки</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#2563eb' }} /> точки доставки</span>
        </div>
        {mapPoints.length > 0 ? (
          <MiniMap points={mapPoints} height={300} />
        ) : (
          <div className="text-xs text-gray-400 py-6 text-center">
            Нет координат. Укажите точку на карте при создании заявки или в справочнике точек доставки.
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Загрузка…</div>
      ) : pending.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">Заявок нет</div>
      ) : (
        <div className="flex flex-col gap-2 mb-5">
          {pending.map((d) => {
            const onActiveRoute = !!d.route_id;
            const driverHasActiveRoute = d.driver_username ? routeByDriver.has(d.driver_username) : false;
            return (
              <div key={d.id} className="bg-white rounded-xl shadow-sm p-3 flex flex-col gap-2">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                        🏪 {d.shop_name || 'Магазин'}
                      </span>
                      <span className="truncate">🚚 {d.client_name || 'Без названия'}</span>
                    </div>
                    {d.address && <div className="text-xs text-gray-500 mt-0.5">📍 {d.address}</div>}
                    {d.client_phone && (
                      <a href={`tel:${d.client_phone}`} className="text-xs text-blue-600 mt-0.5 inline-block hover:underline">📞 {d.client_phone}</a>
                    )}
                    {d.items.length > 0 && (
                      <div className="text-xs text-gray-400 mt-0.5">📦 {d.items.map((it) => `${it.name} ×${it.qty}`).join(', ')}</div>
                    )}
                    {d.note && <div className="text-xs text-gray-400 mt-0.5">📝 {d.note}</div>}
                    <div className="text-xs text-gray-400 mt-0.5">
                      {d.direction && <span className="mr-2">🧭 {d.direction}</span>}
                      {d.lat != null && d.lng != null && (
                        <a href={`https://yandex.ru/maps/?pt=${d.lng},${d.lat}&z=16&l=map`} target="_blank" rel="noopener noreferrer"
                          className="text-emerald-600 mr-2 hover:underline">📌 на карте</a>
                      )}
                      создано {fmt(d.created_at)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusClass(d.status)}`}>
                      {DELIVERY_STATUS_LABEL[d.status]}
                    </span>
                    <button onClick={() => togglePicked(d)} disabled={busyId === d.id}
                      className={`text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${
                        d.picked ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}>
                      {d.picked ? '✓ Собрано' : '📦 Собрать'}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <select value={d.driver_username || ''} disabled={busyId === d.id}
                    onChange={(e) => assign(d, e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-400">
                    <option value="">— назначить водителя —</option>
                    {drivers.map((dr) => (
                      <option key={dr.username} value={dr.username}>
                        {dr.name}{dr.car_number ? ` · ${dr.car_number}` : ''}{routeByDriver.has(dr.username) ? ' · в пути' : ''}
                      </option>
                    ))}
                  </select>
                  {onActiveRoute && (
                    <span className="text-[11px] text-emerald-600">✓ в маршруте водителя</span>
                  )}
                  {!onActiveRoute && driverHasActiveRoute && (
                    <span className="text-[11px] text-amber-600">водитель уже в пути — добавится в текущий заход</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {done.length > 0 && (
        <>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Завершённые ({done.length})</div>
          <div className="flex flex-col gap-2 opacity-70">
            {done.map((d) => (
              <div key={d.id} className="bg-white rounded-xl shadow-sm px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">🏪 {d.shop_name} · {d.client_name}</div>
                  {d.address && <div className="text-xs text-gray-400 mt-0.5 truncate">📍 {d.address}</div>}
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded-full shrink-0 ${statusClass(d.status)}`}>
                  {DELIVERY_STATUS_LABEL[d.status]}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
