'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminGate from '@/components/AdminGate';
import LogisticsTabs from '@/components/LogisticsTabs';
import {
  listShopRequests, updateDelivery, addDeliveriesToRoute, listDrivers, listRoutes, createShopRequest, listShops,
  listDeliveries, resolveDeliveryPoint, ROLE_LABEL,
  Delivery, DeliveryItem, DeliveryStatus, DELIVERY_STATUS_LABEL, UserInfo, Route, Shop,
} from '@/lib/api';
import { haversineKm } from '@/lib/geo';
import LocationPicker from '@/components/LocationPicker';
import MiniMap, { MapPoint } from '@/components/MiniMap';
import ProductPicker from '@/components/ProductPicker';
import { fmtDateTime as fmt } from '@/lib/format';
import { useLivePoll } from '@/lib/useLivePoll';

// Водитель «по пути», если маршрут проходит не дальше этого от точки выдачи.
const NEARBY_KM = 10;
// Авто-назначения для заявок магазина нет — только рассылка водителям рядом (см. API).
// Если за это время никто не взял заказ — подсвечиваем его логисту, чтобы не пропустил.
const UNCLAIMED_ALERT_MIN = 15;

function statusClass(s: DeliveryStatus): string {
  switch (s) {
    case 'delivered': return 'bg-green-100 text-green-700';
    case 'on_way': return 'bg-blue-100 text-blue-700';
    case 'returned': return 'bg-red-100 text-red-700';
    case 'assigned': return 'bg-amber-100 text-amber-700';
    default: return 'bg-gray-100 text-gray-600';
  }
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
  const [allShops, setAllShops] = useState<Shop[]>([]);
  const [allDeliveries, setAllDeliveries] = useState<Delivery[]>([]);
  const [activeRoutes, setActiveRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [onlyPicked, setOnlyPicked] = useState(false);
  // Заявка, для которой сейчас открыт выбор произвольного времени отсрочки (id или null).
  const [deferPickerId, setDeferPickerId] = useState<string | null>(null);
  const [deferTimeVal, setDeferTimeVal] = useState('');

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

  // Редактирование уже созданной заявки (открыта одна за раз).
  const [editId, setEditId] = useState<string | null>(null);
  const [editClient, setEditClient] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editItems, setEditItems] = useState<DeliveryItem[]>([]);
  const [editLat, setEditLat] = useState<number | undefined>(undefined);
  const [editLng, setEditLng] = useState<number | undefined>(undefined);
  const [editBusy, setEditBusy] = useState(false);

  // Водители/маршруты/магазины меняются редко (завели нового водителя, добавили точку) —
  // обновляем их раз в 5 минут отдельным таймером, а не на каждом тике опроса заявок:
  // раньше всё это (плюс все доставки) перечитывалось каждые 30 сек, что на одной
  // открытой весь день вкладке давало сотни тысяч чтений Firestore в день.
  const loadStatic = useCallback(async () => {
    try {
      const [drv, routes, shopList] = await Promise.all([listDrivers(), listRoutes(), listShops()]);
      setDrivers(drv);
      setActiveRoutes(routes.filter((r) => r.status === 'active'));
      setShops(shopList.filter((s) => s.type !== 'warehouse'));
      setAllShops(shopList);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // Доставки — читаем инкрементально (только изменённые с прошлого опроса), как на
  // главной странице логиста, вместо полного перечитывания до 200 штук каждый раз.
  const deliveriesSyncedAtRef = useRef('1970-01-01T00:00:00.000Z');
  function bumpDeliveriesSyncedAt(list: Delivery[]) {
    for (const d of list) if (d.updated_at > deliveriesSyncedAtRef.current) deliveriesSyncedAtRef.current = d.updated_at;
  }

  const load = useCallback(async () => {
    try {
      const [reqs, deliveries] = await Promise.all([listShopRequests(), listDeliveries()]);
      setItems(reqs);
      bumpDeliveriesSyncedAt(deliveries);
      setAllDeliveries(deliveries);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const pollDeliveries = useCallback(async () => {
    try {
      const changed = await listDeliveries(deliveriesSyncedAtRef.current);
      if (!changed.length) return;
      bumpDeliveriesSyncedAt(changed);
      setAllDeliveries((prev) => {
        const map = new Map(prev.map((d) => [d.id, d]));
        for (const d of changed) map.set(d.id, d);
        return [...map.values()];
      });
    } catch { /* ignore */ }
  }, []);

  const pollItems = useCallback(async () => {
    try {
      setItems(await listShopRequests());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadStatic(); load(); }, [loadStatic, load]);
  useLivePoll(loadStatic, 5 * 60_000);
  useLivePoll(pollItems, 45_000);
  useLivePoll(pollDeliveries, 45_000);

  // Тикает раз в минуту, чтобы «никто не взял уже N мин» обновлялось само, пока
  // страница открыта (без этого подсветка появлялась бы только послеload()).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

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

  // Координаты остановок активного маршрута каждого водителя (для подбора «по пути»).
  const routeStopsByDriver = useMemo(() => {
    const byId = new Map(allDeliveries.map((d) => [d.id, d]));
    const m = new Map<string, [number, number][]>();
    for (const r of activeRoutes) {
      const stops: [number, number][] = [];
      for (const id of r.delivery_ids || []) {
        const d = byId.get(id);
        if (!d) continue;
        const p = resolveDeliveryPoint(d, allShops);
        if (p) stops.push([p.lat, p.lng]);
      }
      m.set(r.driver_username, stops);
    }
    return m;
  }, [activeRoutes, allDeliveries, allShops]);

  // Точка выдачи заявки (где водитель забирает товар): координаты магазина → ручные координаты.
  function pickupPoint(d: Delivery): [number, number] | null {
    const shop = allShops.find((s) => s.id === d.shop_id);
    if (shop?.lat != null && shop?.lng != null) return [shop.lat, shop.lng];
    if (d.lat != null && d.lng != null) return [d.lat, d.lng];
    return null;
  }

  // Водители в пути, чей маршрут проходит близко к точке выдачи — отсортированы по близости.
  function suggestionsFor(d: Delivery): { username: string; name: string; car: string | null; km: number }[] {
    const target = pickupPoint(d);
    if (!target) return [];
    const out: { username: string; name: string; car: string | null; km: number }[] = [];
    for (const dr of drivers) {
      const stops = routeStopsByDriver.get(dr.username);
      if (!stops || !stops.length) continue;
      let min = Infinity;
      for (const s of stops) {
        const km = haversineKm(target[0], target[1], s[0], s[1]);
        if (km < min) min = km;
      }
      if (min <= NEARBY_KM) out.push({ username: dr.username, name: dr.name, car: dr.car_number || null, km: Math.round(min) });
    }
    return out.sort((a, b) => a.km - b.km).slice(0, 3);
  }

  // Сколько минут заявка висит без водителя (авто-назначения нет — только рассылка
  // GPS-водителям рядом, см. API). Используется и для текста причины, и для подсветки.
  function minutesUnclaimed(d: Delivery): number {
    return Math.floor((now - new Date(d.created_at).getTime()) / 60_000);
  }

  // Отложено логистом («забрать только завтра») — пока не наступило, не считаем
  // зависшей, даже если формально давно висит без водителя.
  function isDeferred(d: Delivery): boolean {
    return !!d.defer_until && new Date(d.defer_until).getTime() > now;
  }

  // Почему заявка ещё не назначена — текст для менеджера (раньше просто молча висела «Новый»).
  function reasonFor(d: Delivery): string | null {
    if (d.driver_username) return null;
    if (isDeferred(d)) return `Отложено до ${fmt(d.defer_until!)} — не подсвечиваем как зависшую`;
    if (!pickupPoint(d)) return 'Нет координат точки выдачи — рассылка водителям не сработает, назначьте вручную';
    const mins = minutesUnclaimed(d);
    if (mins >= UNCLAIMED_ALERT_MIN) return `Никто не взял уже ${mins} мин — назначьте вручную`;
    if (suggestionsFor(d).length) return null; // вместо причины покажем подсказки
    return 'Заявка разослана водителям рядом — ждём, кто возьмёт';
  }

  // Завтра в 08:30 — стандартная отсрочка по одной кнопке.
  function tomorrow830(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(8, 30, 0, 0);
    return d.toISOString();
  }

  // Для <input type="datetime-local"> — без таймзоны, в локальном времени браузера.
  function toLocalInputValue(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function setDefer(d: Delivery, until: string | null) {
    setBusyId(d.id);
    try {
      const updated = await updateDelivery(d.id, { defer_until: until });
      setItems((prev) => prev.map((x) => (x.id === d.id ? updated : x)));
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

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

  function startEdit(d: Delivery) {
    setEditId(d.id);
    setEditClient(d.client_name || '');
    setEditPhone(d.client_phone || '');
    setEditAddress(d.address || '');
    setEditNote(d.note || '');
    setEditItems(d.items || []);
    setEditLat(d.lat ?? undefined);
    setEditLng(d.lng ?? undefined);
  }

  function cancelEdit() {
    setEditId(null);
  }

  async function saveEdit(d: Delivery) {
    setEditBusy(true);
    setError('');
    try {
      const updated = await updateDelivery(d.id, {
        client_name: editClient.trim(),
        client_phone: editPhone.trim(),
        address: editAddress.trim(),
        note: editNote.trim(),
        items: editItems,
        lat: editLat ?? null,
        lng: editLng ?? null,
      });
      setItems((prev) => prev.map((x) => (x.id === d.id ? updated : x)));
      setEditId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEditBusy(false);
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

  const staleCount = pending.filter((d) => !d.driver_username && !isDeferred(d) && minutesUnclaimed(d) >= UNCLAIMED_ALERT_MIN).length;

  return (
    <div>
      <LogisticsTabs />
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="text-xl font-bold">🏪 Заявки магазинов <span className="text-sm text-gray-400 font-normal">({pending.length})</span></h2>
        {staleCount > 0 && (
          <span className="text-xs font-bold px-2 py-1 rounded-full bg-red-100 text-red-700 animate-pulse">
            ⚠️ {staleCount} никто не взял
          </span>
        )}
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
            const suggestions = !d.driver_username ? suggestionsFor(d) : [];
            const reason = reasonFor(d);
            const deferred = isDeferred(d);
            const stale = !d.driver_username && !deferred && minutesUnclaimed(d) >= UNCLAIMED_ALERT_MIN;
            return (
              <div key={d.id} className={`rounded-xl shadow-sm p-3 flex flex-col gap-2 ${
                stale ? 'bg-red-50 ring-2 ring-red-300' : deferred ? 'bg-sky-50 ring-1 ring-sky-200' : 'bg-white'
              }`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                        🏪 {d.shop_name || 'Магазин'}
                      </span>
                      <span className="truncate">🚚 {d.client_name || 'Без названия'}</span>
                      {deferred && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 whitespace-nowrap">
                          📅 отложено до {fmt(d.defer_until!)}
                        </span>
                      )}
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
                    <button onClick={() => (editId === d.id ? cancelEdit() : startEdit(d))}
                      className="text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap bg-blue-50 text-blue-700 hover:bg-blue-100">
                      {editId === d.id ? '✕ Отмена' : '✏️ Изменить'}
                    </button>
                    {!d.driver_username && (
                      deferred ? (
                        <button onClick={() => setDefer(d, null)} disabled={busyId === d.id}
                          className="text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap bg-sky-50 text-sky-700 hover:bg-sky-100">
                          ↩ Вернуть сейчас
                        </button>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button onClick={() => setDefer(d, tomorrow830())} disabled={busyId === d.id}
                            title="Забрать можно завтра — не подсвечивать как зависшую заявку"
                            className="text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap bg-gray-100 text-gray-600 hover:bg-gray-200">
                            📅 На завтра
                          </button>
                          <button
                            onClick={() => {
                              if (deferPickerId === d.id) { setDeferPickerId(null); return; }
                              setDeferPickerId(d.id);
                              setDeferTimeVal(toLocalInputValue(tomorrow830()));
                            }}
                            disabled={busyId === d.id}
                            title="Указать своё время"
                            className="text-[11px] font-semibold px-1.5 py-1 rounded-full whitespace-nowrap bg-gray-100 text-gray-600 hover:bg-gray-200">
                            🕓
                          </button>
                        </div>
                      )
                    )}
                  </div>
                </div>

                {deferPickerId === d.id && (
                  <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg p-2">
                    <input type="datetime-local" value={deferTimeVal} onChange={(e) => setDeferTimeVal(e.target.value)}
                      className="flex-1 border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-blue-400" />
                    <button
                      onClick={async () => {
                        if (!deferTimeVal) return;
                        await setDefer(d, new Date(deferTimeVal).toISOString());
                        setDeferPickerId(null);
                      }}
                      disabled={busyId === d.id || !deferTimeVal}
                      className="text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                      ✓ Отложить
                    </button>
                    <button onClick={() => setDeferPickerId(null)}
                      className="text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap bg-gray-100 text-gray-500 hover:bg-gray-200">
                      ✕
                    </button>
                  </div>
                )}

                {editId === d.id && (
                  <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 flex flex-col gap-2">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input value={editClient} onChange={(e) => setEditClient(e.target.value)} autoComplete="off"
                        placeholder="Имя клиента"
                        className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
                      <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} autoComplete="off" type="tel"
                        placeholder="Телефон клиента"
                        className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
                    </div>
                    <input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} autoComplete="off"
                      placeholder="Адрес доставки"
                      className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
                    <input value={editNote} onChange={(e) => setEditNote(e.target.value)} autoComplete="off"
                      placeholder="Примечание (необязательно)"
                      className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
                    <ProductPicker items={editItems} onChange={setEditItems} />
                    <LocationPicker lat={editLat} lng={editLng} onChange={(la, ln) => { setEditLat(la); setEditLng(ln); }} />
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(d)} disabled={editBusy || !editClient.trim() || !editAddress.trim()}
                        className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg">
                        {editBusy ? '⏳…' : '💾 Сохранить'}
                      </button>
                      <button onClick={cancelEdit} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold rounded-lg">
                        Отмена
                      </button>
                    </div>
                  </div>
                )}

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

                {suggestions.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] text-gray-400">🚗 рядом по пути:</span>
                    {suggestions.map((s) => (
                      <button key={s.username} onClick={() => assign(d, s.username)} disabled={busyId === d.id}
                        className="text-[11px] font-semibold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap">
                        {s.name}{s.car ? ` · ${s.car}` : ''} · ~{s.km} км
                      </button>
                    ))}
                  </div>
                )}
                {reason && (
                  <div className={`text-[11px] rounded-lg px-2 py-1 font-semibold ${
                    stale ? 'text-red-700 bg-red-100' : 'text-amber-600 bg-amber-50'
                  }`}>⚠️ {reason}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {done.length > 0 && (
        <>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Завершённые ({done.length})</div>
          <div className="flex flex-col gap-2 opacity-70">
            {done.map((d) => {
              const ev = d.history?.[d.history.length - 1];
              const who = ev ? `${ev.by}${ev.role ? ` (${ROLE_LABEL[ev.role as keyof typeof ROLE_LABEL] || ev.role})` : ''}` : '';
              return (
                <div key={d.id} className="bg-white rounded-xl shadow-sm px-4 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">🏪 {d.shop_name} · {d.client_name}</div>
                    {d.address && <div className="text-xs text-gray-400 mt-0.5 truncate">📍 {d.address}</div>}
                    {d.status === 'returned' && d.return_note && (
                      <div className="text-xs text-red-600 mt-0.5">↩️ Причина: {d.return_note}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusClass(d.status)}`}>
                      {DELIVERY_STATUS_LABEL[d.status]}
                    </span>
                    {ev && (
                      <span className="text-[10px] text-gray-400 whitespace-nowrap" title="Кто и когда поставил этот статус">
                        {who} · {fmt(ev.at)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
