'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import AdminGate from '@/components/AdminGate';
import ConfirmModal from '@/components/ConfirmModal';
import LogisticsTabs from '@/components/LogisticsTabs';
import {
  listDeliveries, createDelivery, updateDelivery, deleteDeliveryApi, listDrivers,
  listMovements, listOrders, listTransfers, listSessions, MovementListItem, OrderListItem, TransferListItem, MOVEMENT_STATUS_LABEL,
  Delivery, DeliveryStatus, DELIVERY_STATUS_LABEL, DOC_TYPE_LABEL, UserInfo,
  autoAssign, fetchLogisticsSettings, saveLogisticsSettings, LogisticsSettings, CAP_DEFAULT_KEY,
  vehicleFamily, defaultCapacity,
  listRoutes, Route,
  listShops, Shop,
  DeliveryItem,
} from '@/lib/api';
import ProductPicker from '@/components/ProductPicker';
import { useLivePoll } from '@/lib/useLivePoll';
import { fmtDateTime as fmt } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { canAccess } from '@/lib/features';
import SplitDeliveryModal from '@/components/SplitDeliveryModal';

// Время начала захода с датой, если это не сегодня (напр. «29.06 05:41»); если сегодня —
// только время, как раньше.
function fmtTripStart(iso?: string | null) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const isToday = d.toDateString() === new Date().toDateString();
    if (isToday) return time;
    const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    return `${date} ${time}`;
  } catch { return ''; }
}

const STATUSES: DeliveryStatus[] = ['new', 'assigned', 'on_way', 'delivered', 'returned'];
const ACTIVE: DeliveryStatus[] = ['new', 'assigned', 'on_way'];

function isDone(s: DeliveryStatus) {
  return s === 'delivered' || s === 'returned';
}

function statusClass(s: DeliveryStatus): string {
  switch (s) {
    case 'delivered': return 'bg-green-100 text-green-700';
    case 'on_way': return 'bg-blue-100 text-blue-700';
    case 'returned': return 'bg-red-100 text-red-700';
    case 'assigned': return 'bg-amber-100 text-amber-700';
    default: return 'bg-gray-100 text-gray-600';
  }
}

// Категория транспорта для фильтра/подписей — точное значение поля «Транспорт» у водителя.
function vehicleCategory(transport: string | null | undefined): string {
  const t = (transport || '').trim();
  return t || 'Без типа';
}

const DEFAULT_CAP_SETTINGS: LogisticsSettings = {
  cap_by_type: {
    LABO: { kg: 600, m3: 3 },
    'Газель': { kg: 1500, m3: 9 },
    [CAP_DEFAULT_KEY]: { kg: 300, m3: 2 },
  },
  rate_by_type: {},
  point_rate_by_type: {},
  point_rate_low_load_by_type: {},
  fuel_rate_by_type: {},
  load_rate_tiers_by_type: {},
};

export default function LogisticsPage() {
  return (
    <AdminGate min="manager">
      <LogisticsContent />
    </AdminGate>
  );
}

function LogisticsContent() {
  const { session } = useAuth();
  const can = (k: Parameters<typeof canAccess>[0]) => !session || canAccess(k, session.role, session.features);
  const [items, setItems] = useState<Delivery[]>([]);
  const [drivers, setDrivers] = useState<UserInfo[]>([]);
  const [activeRoutes, setActiveRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hideDone, setHideDone] = useState(true);
  const [onlyPicked, setOnlyPicked] = useState(false);
  // Сворачивание секций «Без водителя» / «Собранные, без водителя» — раскрыты по умолчанию.
  const [unassignedOpen, setUnassignedOpen] = useState(false);
  const [pickedUnassignedOpen, setPickedUnassignedOpen] = useState(false);
  const [capSettings, setCapSettings] = useState<LogisticsSettings>(DEFAULT_CAP_SETTINGS);
  // Синхронный «снимок» cap_by_type — для saveCapType. Обновление state через функцию-
  // обновитель (prev => ...) НЕ гарантирует, что она выполнится до следующей строки кода
  // (это и было реальным багом: next оставался {} — начальным значением — потому что
  // обновитель setCapSettings успевал выполниться позже, уже после отправки на сервер).
  // ref читается/пишется синхронно, без этой неопределённости.
  const capByTypeRef = useRef(capSettings.cap_by_type);
  const [capType, setCapType] = useState<string>(CAP_DEFAULT_KEY);
  const capKgRef = useRef<HTMLInputElement>(null);
  const capM3Ref = useRef<HTMLInputElement>(null);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoMsg, setAutoMsg] = useState('');
  const [driverSearch, setDriverSearch] = useState('');
  // Сортировка списка водителей: по умолчанию — те, кто сейчас «в заходе», наверху.
  const [driverSort, setDriverSort] = useState<'trip' | 'load' | 'name'>('trip');
  const [assignTo, setAssignTo] = useState<UserInfo | null>(null);
  // null = режим по умолчанию (только доставочные: LABO + Газель).
  const [vehSel, setVehSel] = useState<string[] | null>(null);

  // Форма создания (свёрнута по умолчанию — основной поток через карточку водителя).
  const [showForm, setShowForm] = useState(false);
  const [mode, setMode] = useState<'document' | 'manual'>('document');
  const [query, setQuery] = useState('');
  const [client, setClient] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [formDriver, setFormDriver] = useState(''); // '' | username | '__ext__'
  const [extName, setExtName] = useState('');
  const [extCar, setExtCar] = useState('');
  const [manualWeightKg, setManualWeightKg] = useState('');
  const [manualVolM3, setManualVolM3] = useState('');
  const [manualKm, setManualKm] = useState('');
  const [fromShopId, setFromShopId] = useState('');
  const [toShopId, setToShopId] = useState('');
  const [formItems, setFormItems] = useState<DeliveryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<{ msg: string; onOk: () => void } | null>(null);

  // Заявки магазинов
  const [showShopOrders, setShowShopOrders] = useState(false);
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopsLoading, setShopsLoading] = useState(false);
  const [shopBusyId, setShopBusyId] = useState<string | null>(null);

  // Отметка последнего известного updated_at — опрос дальше читает только то, что
  // изменилось после неё, а не всю коллекцию заново (была причина исчерпания квоты
  // Firestore: до 200 чтений на каждый тик при открытой странице).
  const syncedAtRef = useRef('1970-01-01T00:00:00.000Z');

  function bumpSyncedAt(list: Delivery[]) {
    for (const d of list) if (d.updated_at > syncedAtRef.current) syncedAtRef.current = d.updated_at;
  }

  const load = useCallback(async () => {
    try {
      const fresh = await listDeliveries();
      setItems(fresh);
      bumpSyncedAt(fresh);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const changed = await listDeliveries(syncedAtRef.current);
      if (!changed.length) return;
      bumpSyncedAt(changed);
      setItems((prev) => {
        const map = new Map(prev.map((d) => [d.id, d]));
        for (const d of changed) map.set(d.id, d);
        return [...map.values()];
      });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Автообновление: видны изменения статусов от водителей без ручного F5.
  // Опрос идёт только пока вкладка видима и читает только изменённое — бережёт квоту чтений Firestore.
  useLivePoll(poll, 60_000);

  useEffect(() => { listDrivers().then(setDrivers).catch(() => {}); }, []);
  useEffect(() => { listShops().then(setShops).catch(() => {}); }, []);
  useEffect(() => {
    listRoutes().then((r) => setActiveRoutes(r.filter((x) => x.status === 'active'))).catch(() => {});
  }, []);
  const [capSettingsLoaded, setCapSettingsLoaded] = useState(false);
  const [capSettingsError, setCapSettingsError] = useState('');
  const loadCapSettings = useCallback(() => {
    setCapSettingsError('');
    fetchLogisticsSettings()
      .then((s: LogisticsSettings) => {
        setCapSettings(s);
        capByTypeRef.current = s.cap_by_type;
        setCapSettingsLoaded(true);
      })
      // Не помечаем «загружено» при сбое — иначе показали бы дефолты (300кг/2м³ и т.п.)
      // как настоящие сохранённые значения, и правка от них могла бы затереть реальные.
      .catch((e) => setCapSettingsError((e as Error).message));
  }, []);
  useEffect(() => { loadCapSettings(); }, [loadCapSettings]);

  // Список видов транспорта берётся из реальных значений поля «Транспорт» у водителей.
  const vehicleTypes = useMemo(() => {
    const set = new Set<string>();
    for (const d of drivers) {
      const t = (d.transport || '').trim();
      if (t) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [drivers]);

  // Помимо точных моделей — два общих семейства (LABO/Газель), их вместимость применяется
  // ко всем машинам этого семейства сразу, если для точной модели не задано своё значение.
  const FAMILY_TYPES = ['LABO', 'Газель'];
  const capTypeOptions = [CAP_DEFAULT_KEY, ...FAMILY_TYPES, ...vehicleTypes];
  // Если выбранный вид транспорта пропал из списка (например, изменили у водителя) — показываем «Прочие».
  const effectiveCapType = capTypeOptions.includes(capType) ? capType : CAP_DEFAULT_KEY;
  const currentCap = capSettings.cap_by_type[effectiveCapType] || { kg: 0, m3: 0 };

  const [capSaveStatus, setCapSaveStatus] = useState('');

  // Вместимость по выбранному виду транспорта — общая для всех водителей этого вида.
  // next считаем синхронно из capByTypeRef (не из обновителя setCapSettings — обновитель
  // прошлой версии кода и был реальным багом: он мог выполниться позже, чем строка с
  // saveLogisticsSettings(), и тогда отправлялся пустой объект). ref всегда актуален
  // немедленно, без этой неопределённости — и так же защищает от потери правки при
  // быстром редактировании двух разных типов подряд.
  async function saveCapType(kgVal: string, m3Val: string) {
    const kg = Math.max(0, Number(kgVal) || 0);
    const m3 = Math.max(0, Number(m3Val) || 0);
    const type = effectiveCapType;
    const next = { ...capByTypeRef.current, [type]: { kg, m3 } };
    capByTypeRef.current = next;
    setCapSettings((prev) => ({ ...prev, cap_by_type: next }));
    setCapSaveStatus('Сохраняю…');
    try {
      // saveLogisticsSettings возвращает то, что сервер перечитал из Firestore СРАЗУ
      // после записи (в том же запросе) — без отдельного GET, чтобы не оставалось
      // сомнений в таймингах при сравнении.
      const saved = await saveLogisticsSettings({ cap_by_type: next });
      const got = saved.cap_by_type[type];
      if (got?.kg === kg && got?.m3 === m3) {
        setCapSaveStatus(`✓ Сохранено (проверено) ${new Date().toLocaleTimeString('ru-RU')}`);
      } else {
        setCapSaveStatus(`⚠️ После сохранения сервер вернул другое значение: ${got?.kg ?? '—'} кг / ${got?.m3 ?? '—'} м³`);
      }
      capByTypeRef.current = saved.cap_by_type;
      setCapSettings(saved);
    } catch (e) {
      setCapSaveStatus(`⚠️ Ошибка сохранения: ${(e as Error).message}`);
    }
  }

  async function doAutoAssign() {
    setAutoAssigning(true); setAutoMsg('');
    try {
      const r = await autoAssign();
      setAutoMsg(`Назначено: ${r.assigned}, пропущено: ${r.skipped}`);
      await load();
    } catch (e) { setAutoMsg((e as Error).message); }
    finally { setAutoAssigning(false); }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const driverPart =
        formDriver === '__ext__'
          ? { external_driver: extName.trim(), external_car: extCar.trim() }
          : formDriver
          ? { driver_username: formDriver }
          : {};
      const fromShop = fromShopId ? shops.find((s) => s.id === fromShopId) : null;
      const toShop = toShopId ? shops.find((s) => s.id === toShopId) : null;
      await createDelivery({
        ...(mode === 'document' ? { query: query.trim() } : {}),
        ...(fromShop ? { from_name: fromShop.name } : {}),
        ...(toShop ? {
          shop_id: toShop.id,
          client_name: client.trim() || toShop.name,
          address: address.trim() || toShop.address,
          direction: toShop.direction,
          ...(toShop.km && !manualKm ? { km: toShop.km } : {}),
          ...(toShop.lat && toShop.lng ? { lat: toShop.lat, lng: toShop.lng } : {}),
        } : {
          client_name: client.trim(),
          address: address.trim(),
        }),
        note: note.trim(),
        ...(mode === 'manual' && formItems.length ? { items: formItems } : {}),
        ...(mode === 'manual' && manualWeightKg ? { weight_kg: Number(manualWeightKg) } : {}),
        ...(mode === 'manual' && manualVolM3 ? { volume_m3: Number(manualVolM3) } : {}),
        ...(mode === 'manual' && manualKm ? { km: Number(manualKm) } : {}),
        ...driverPart,
      });
      setQuery(''); setClient(''); setAddress(''); setNote('');
      setManualWeightKg(''); setManualVolM3(''); setManualKm(''); setFormItems([]);
      setFormDriver(''); setExtName(''); setExtCar('');
      setFromShopId(''); setToShopId('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const patch = useCallback(async (id: string, p: Parameters<typeof updateDelivery>[1]) => {
    setError('');
    try {
      const updated = await updateDelivery(id, p);
      setItems((prev) => prev.map((d) => (d.id === id ? updated : d)));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const remove = useCallback((id: string) => {
    setConfirmState({
      msg: 'Удалить доставку?',
      onOk: async () => {
        setConfirmState(null);
        setError('');
        try {
          await deleteDeliveryApi(id);
          setItems((prev) => prev.filter((d) => d.id !== id));
        } catch (err) {
          setError((err as Error).message);
        }
      },
    });
  }, []);

  // Назначить водителю существующий документ (накладная/заказ/перемещение) из модалки.
  const assignDoc = useCallback(async (
    ref: { movement_id?: string; deal_id?: string; transfer_id?: string },
    driver_username: string,
    shopMatch?: { direction: string; km: number }
  ) => {
    const created = await createDelivery({ ...ref, driver_username, ...shopMatch });
    setItems((prev) => [created, ...prev]);
  }, []);

  async function loadShops() {
    setShopsLoading(true);
    try { setShops(await listShops()); }
    catch { /* ignore */ }
    finally { setShopsLoading(false); }
  }

  async function createShopDelivery(shop: Shop) {
    setShopBusyId(shop.id);
    setError('');
    try {
      const d = await createDelivery({
        kind: 'shop_to_client',
        shop_id: shop.id,
        shop_name: shop.name,
        client_name: shop.name,
        address: shop.address,
        direction: shop.direction,
        km: shop.km,
        note: `Заявка магазина: ${shop.name}`,
      });
      setItems((prev) => [d, ...prev]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setShopBusyId(null);
    }
  }

  // Заявка на обед для точки (от базы 001 до этого магазина/склада) — отдельная от
  // обычной «+ Доставка», с фиксированным кубом 0,2 м³ и явной пометкой «Обед» в
  // названии, чтобы водитель сразу видел, что это именно обед, а не товар.
  async function createLunchDelivery(shop: Shop) {
    setShopBusyId(shop.id);
    setError('');
    try {
      const d = await createDelivery({
        kind: 'shop_to_client',
        shop_id: shop.id,
        shop_name: shop.name,
        client_name: `🍽️ Обед — ${shop.name}`,
        address: shop.address,
        direction: shop.direction,
        km: shop.km,
        volume_m3: 0.2,
        note: 'Обед',
      });
      setItems((prev) => [d, ...prev]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setShopBusyId(null);
    }
  }

  // Группировка доставок: штатные водители (по username), без водителя. Водители «со
  // стороны» (driver_name без username) видны прямо внутри карточки каждой доставки
  // (см. «🚖 Со стороны» в DeliveryRow) — отдельный блок-сводка по ним убран со страницы.
  const { byDriver, unassigned } = useMemo(() => {
    const map = new Map<string, Delivery[]>();
    const none: Delivery[] = [];
    for (const d of items) {
      if (d.driver_username) {
        const arr = map.get(d.driver_username) || [];
        arr.push(d); map.set(d.driver_username, arr);
      } else if (!d.driver_name) {
        none.push(d);
      }
    }
    return { byDriver: map, unassigned: none };
  }, [items]);

  // Направления, в которых у водителя уже есть активный груз — чтобы при ручном
  // назначении видно было, если новая доставка тянет его в другую сторону
  // (а не просто превышает вместимость, как проверялось раньше).
  const directionsByDriver = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const d of items) {
      if (!d.driver_username || !d.direction || isDone(d.status)) continue;
      const set = m.get(d.driver_username) || new Set<string>();
      set.add(d.direction);
      m.set(d.driver_username, set);
    }
    return m;
  }, [items]);

  // Категории транспорта среди водителей: [категория, кол-во].
  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of drivers) {
      const c = vehicleCategory(d.transport);
      m.set(c, (m.get(c) || 0) + 1);
    }
    return [...m.entries()];
  }, [drivers]);

  const allCats = categories.map(([c]) => c);
  // По умолчанию открыты доставочные виды транспорта: семейства LABO/Газель, а также
  // ChanGan (по подстроке в названии модели).
  const defaultCats = allCats.filter((c) => vehicleFamily(c) !== null || /chang.?an/i.test(c));
  // Активные категории фильтра: явный выбор пользователя, иначе доставочные по умолчанию.
  const selCats = vehSel ?? (defaultCats.length ? defaultCats : allCats);

  function toggleCat(c: string) {
    const base = vehSel ?? (defaultCats.length ? defaultCats : allCats);
    setVehSel(base.includes(c) ? base.filter((x) => x !== c) : [...base, c]);
  }

  // Загрузка каждого водителя (макс. доля веса/объёма/штук от вместимости, по активным
  // доставкам) — нужна только для сортировки списка; сама карточка считает то же самое
  // заново для отображения (см. DriverCard).
  const driverLoadPct = useMemo(() => {
    const m = new Map<string, number>();
    for (const dr of drivers) {
      const active = (byDriver.get(dr.username) || []).filter((d) => !isDone(d.status));
      const weightKg = active.reduce((s, d) => s + (d.total_weight || 0), 0);
      const volL = active.reduce((s, d) => s + (d.total_volume_l || 0), 0);
      const qty = active.reduce((s, d) => s + (d.total_qty || 0), 0);
      const defCap = defaultCapacity(dr.transport, capSettings);
      const capKg = dr.capacity_kg > 0 ? dr.capacity_kg : defCap.kg;
      const capM3 = dr.capacity_m3 > 0 ? dr.capacity_m3 : defCap.m3;
      const pctKg = capKg > 0 ? (weightKg / capKg) * 100 : 0;
      const pctM3 = capM3 > 0 ? (volL / (capM3 * 1000)) * 100 : 0;
      const pctPcs = weightKg === 0 && volL === 0 && defCap.pcs > 0 ? (qty / defCap.pcs) * 100 : 0;
      m.set(dr.username, Math.max(pctKg, pctM3, pctPcs));
    }
    return m;
  }, [drivers, byDriver, capSettings]);

  const shownDrivers = useMemo(() => {
    const needle = driverSearch.trim().toLowerCase();
    const cats = selCats.length ? selCats : allCats; // пустой выбор = показать всех
    const filtered = drivers.filter((d) =>
      cats.includes(vehicleCategory(d.transport)) &&
      (!needle || d.name.toLowerCase().includes(needle) || (d.car_number || '').toLowerCase().includes(needle))
    );
    const hasTrip = (username: string) => activeRoutes.some((r) => r.driver_username === username);
    return [...filtered].sort((a, b) => {
      if (driverSort === 'trip') {
        const ta = hasTrip(a.username) ? 1 : 0;
        const tb = hasTrip(b.username) ? 1 : 0;
        if (ta !== tb) return tb - ta;
        return a.name.localeCompare(b.name, 'ru');
      }
      if (driverSort === 'load') {
        const diff = (driverLoadPct.get(b.username) || 0) - (driverLoadPct.get(a.username) || 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name, 'ru');
      }
      return a.name.localeCompare(b.name, 'ru');
    });
  }, [drivers, driverSearch, selCats, allCats, driverSort, activeRoutes, driverLoadPct]);

  const visibleUnassignedAll = (hideDone ? unassigned.filter((d) => !isDone(d.status)) : unassigned)
    .filter((d) => !onlyPicked || d.picked);
  // Разделяем «без водителя» на ещё не собранные и уже собранные (готовые к выдаче
  // водителю) — два отдельных сворачиваемых блока. Как только у доставки появляется
  // водитель, она уходит из items.driver_username === '' и пропадает из обоих списков
  // сама (попадает в группу своего водителя) — отдельного сброса «собрано» не нужно,
  // флаг picked остаётся true (товар физически собран), просто список меняется.
  const visibleUnassigned = visibleUnassignedAll.filter((d) => !d.picked);
  const visiblePickedUnassigned = visibleUnassignedAll.filter((d) => d.picked);

  return (
    <div>
      <LogisticsTabs />
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xl font-bold">1️⃣ Накладные/заказы <span className="text-sm text-gray-400 font-normal">({items.length})</span></h2>
        <div className="flex items-center gap-3">
          <Link
            href="/logistics/shops"
            title="Справочник точек доставки: адреса магазинов и складов, откуда/куда возим товар"
            className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center gap-1">
            🏪 <span>Точки доставки</span>
            <span className="text-[10px] text-gray-400 font-normal">(магазины/склады)</span>
          </Link>
          {can('log_reports') && (
            <Link
              href="/logistics/reports"
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center gap-1">
              📊 Отчёты
            </Link>
          )}
          {can('log_clients') && (
            <Link
              href="/logistics/clients"
              title="Все доставки магазин → клиент: магазин, телефон, адрес/геолокация, товар. Можно выгрузить в Excel"
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center gap-1">
              👥 База клиентов
            </Link>
          )}
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
            Скрывать завершённые
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={onlyPicked} onChange={(e) => setOnlyPicked(e.target.checked)} />
            Только собранные
          </label>
        </div>
      </div>

      {/* Авто-распределение. Стоимость топлива настраивается в «Отчётах» — там же она и считается. */}
      <div className="bg-white rounded-xl shadow-sm p-3 mb-3 flex flex-wrap items-center gap-3">
        <button
          onClick={doAutoAssign} disabled={autoAssigning}
          className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-semibold rounded-lg whitespace-nowrap">
          {autoAssigning ? '⏳ Распределяю…' : '⚡ Авто-распределить'}
        </button>
        {autoMsg && <span className="text-xs text-gray-500">{autoMsg}</span>}
      </div>

      {/* Вместимость по виду транспорта — список видов берётся из карточек водителей */}
      {can('log_capacity') && (
      <div className="bg-white rounded-xl shadow-sm p-3 mb-3 flex flex-wrap items-center gap-3">
        <span className="text-xs text-gray-500 whitespace-nowrap">📦 Вместимость по умолчанию:</span>
        <select value={effectiveCapType} onChange={(e) => setCapType(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-400 max-w-[220px]">
          <option value={CAP_DEFAULT_KEY}>Прочие (по умолчанию)</option>
          {FAMILY_TYPES.map((t) => (
            <option key={t} value={t}>{t} (все модели)</option>
          ))}
          {vehicleTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        {capSettingsError ? (
          <span className="text-xs text-red-600 flex items-center gap-2">
            ⚠️ {capSettingsError}
            <button onClick={loadCapSettings} className="underline">Повторить</button>
          </span>
        ) : !capSettingsLoaded ? (
          <span className="text-xs text-gray-400">Загрузка…</span>
        ) : (
          <div key={effectiveCapType} className="flex items-center gap-1.5">
            <input ref={capKgRef} type="number" min={0} step={1} defaultValue={currentCap.kg}
              onBlur={(e) => saveCapType(e.target.value, capM3Ref.current?.value ?? String(currentCap.m3))}
              className="w-20 border border-gray-200 rounded-lg px-1.5 py-1 text-xs text-right outline-none focus:border-blue-400" />
            <span className="text-[11px] text-gray-400">кг</span>
            <input ref={capM3Ref} type="number" min={0} step={0.1} defaultValue={currentCap.m3}
              onBlur={(e) => saveCapType(capKgRef.current?.value ?? String(currentCap.kg), e.target.value)}
              className="w-16 border border-gray-200 rounded-lg px-1.5 py-1 text-xs text-right outline-none focus:border-blue-400" />
            <span className="text-[11px] text-gray-400">м³</span>
          </div>
        )}
        {capSaveStatus && (
          <span className={`text-[11px] ${capSaveStatus.startsWith('⚠️') ? 'text-red-600' : 'text-gray-400'}`}>
            {capSaveStatus}
          </span>
        )}
        <span className="text-[11px] text-gray-400 basis-full">
          Точные модели — из поля «Транспорт» у водителей; для конкретной модели можно задать свою вместимость.
          Если для модели своя вместимость не задана — берётся вместимость её семейства (LABO/Газель), иначе «Прочие».
          {vehicleTypes.length === 0 && ' Сейчас ни у одного водителя не указан транспорт.'}
        </span>
      </div>
      )}

      {/* Заявки магазинов — быстрое создание доставки В магазин из справочника */}
      {can('log_shop_requests') && (
      <div className="bg-white rounded-xl shadow-sm mb-3">
        <button
          onClick={() => { setShowShopOrders((v) => !v); if (!shops.length) loadShops(); }}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-left hover:bg-gray-50 rounded-xl transition-colors"
        >
          <span>
            📋 Заявки магазинов
            <span className="ml-1.5 text-xs font-normal text-gray-400">
              — доставка товара в точки из справочника
            </span>
          </span>
          <span className="text-gray-300 ml-2 shrink-0">{showShopOrders ? '▲' : '▼'}</span>
        </button>

        {showShopOrders && (
          <div className="border-t border-gray-100 px-4 pb-4 pt-3">
            {shopsLoading ? (
              <div className="text-xs text-gray-400 flex items-center gap-1.5">
                <span className="w-4 h-4 border-2 border-gray-200 border-t-blue-400 rounded-full animate-spin" />
                Загрузка…
              </div>
            ) : shops.length === 0 ? (
              <div className="text-xs text-gray-400">
                Точек нет.{' '}
                <Link href="/logistics/shops" className="text-blue-500 hover:underline">
                  Добавить магазины/склады →
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {shops.map((shop) => {
                  const activeCnt = items.filter(
                    (d) => !isDone(d.status) && d.client_name === shop.name
                  ).length;
                  return (
                    <div key={shop.id} className="flex items-center gap-2 py-1">
                      <span className="text-lg shrink-0">{shop.type === 'warehouse' ? '🏭' : shop.type === 'client' ? '👤' : '🏪'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{shop.name}</div>
                        <div className="text-xs text-gray-400 truncate">
                          {shop.address || '—'}
                          {shop.direction && ` · ${shop.direction}`}
                          {shop.km > 0 && ` · ${shop.km} км`}
                        </div>
                      </div>
                      {activeCnt > 0 && (
                        <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full shrink-0">
                          {activeCnt} акт.
                        </span>
                      )}
                      <button
                        onClick={() => createLunchDelivery(shop)}
                        disabled={shopBusyId === shop.id}
                        title="Заявка на обед: от базы 001 до этой точки, куб 0,2 м³"
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600
                                   disabled:bg-gray-200 disabled:text-gray-400 text-white whitespace-nowrap transition-colors"
                      >
                        {shopBusyId === shop.id ? '⏳' : '🍽️ Обед'}
                      </button>
                      <button
                        onClick={() => createShopDelivery(shop)}
                        disabled={shopBusyId === shop.id}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600
                                   disabled:bg-gray-200 disabled:text-gray-400 text-white whitespace-nowrap transition-colors"
                      >
                        {shopBusyId === shop.id ? '⏳' : '+ Доставка'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Создание доставки — свёрнуто (основной поток: назначение из карточки водителя) */}
      <button onClick={() => { setShowForm((v) => !v); if (!shops.length) loadShops(); }}
        className="mb-3 text-sm font-semibold px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700">
        {showForm ? '× Скрыть форму' : '+ Создать доставку вручную'}
      </button>

      {showForm && (
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

        {/* Откуда / куда — из справочника точек (необязательно) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-gray-400 mb-1 block">📦 Откуда (склад/точка)</label>
            <select value={fromShopId} onChange={(e) => setFromShopId(e.target.value)}
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400">
              <option value="">— не указано —</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-gray-400 mb-1 block">🏪 Куда (из справочника)</label>
            <select value={toShopId} onChange={(e) => {
              const id = e.target.value;
              setToShopId(id);
              const sh = shops.find((s) => s.id === id);
              if (sh) {
                setClient(sh.name);
                setAddress(sh.address || '');
                if (sh.km) setManualKm(String(sh.km));
              }
            }}
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400">
              <option value="">— или ввести вручную ↓ —</option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={client} onChange={(e) => setClient(e.target.value)}
            placeholder="Клиент / куда (имя)"
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <input value={address} onChange={(e) => setAddress(e.target.value)}
            placeholder="Адрес доставки"
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>

        <input value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Примечание (необязательно)"
          className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />

        {/* Товары из справочника — только для ручного режима (из документа состав уже
            приходит из накладной/заказа). Если выбраны, вес/объём посчитаются по ним
            автоматически — ручные поля ниже нужны только чтобы переопределить расчёт. */}
        {mode === 'manual' && (
          <div>
            <label className="text-[11px] text-gray-400 mb-1 block">📦 Товары из справочника (необязательно)</label>
            <ProductPicker items={formItems} onChange={setFormItems} />
          </div>
        )}

        {/* Вес / объём / км — только для ручного режима */}
        {mode === 'manual' && (
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">⚖️ Вес, кг{formItems.length > 0 ? ' (переопределить)' : ''}</label>
              <input type="number" min={0} step="0.1" value={manualWeightKg}
                onChange={(e) => setManualWeightKg(e.target.value)}
                placeholder="напр. 150"
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">📦 Объём, м³{formItems.length > 0 ? ' (переопределить)' : ''}</label>
              <input type="number" min={0} step="0.01" value={manualVolM3}
                onChange={(e) => setManualVolM3(e.target.value)}
                placeholder="напр. 0.5"
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-[11px] text-gray-400 mb-1 block">🛣️ Км до точки</label>
              <input type="number" min={0} step="1" value={manualKm}
                onChange={(e) => setManualKm(e.target.value)}
                placeholder="напр. 12"
                className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </div>
          </div>
        )}

        {/* Водитель: штатный из списка или внешний «со стороны» */}
        <select value={formDriver} onChange={(e) => setFormDriver(e.target.value)}
          className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400">
          <option value="">Без водителя (назначить позже)</option>
          {drivers.map((dr) => (
            <option key={dr.username} value={dr.username}>{dr.name}{dr.car_number ? ` · ${dr.car_number}` : ''}</option>
          ))}
          <option value="__ext__">➕ Внешний водитель…</option>
        </select>

        {formDriver === '__ext__' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input value={extName} onChange={(e) => setExtName(e.target.value)} autoComplete="off"
              placeholder="Имя внешнего водителя"
              className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
            <input value={extCar} onChange={(e) => setExtCar(e.target.value)} autoComplete="off"
              placeholder="Машина (необязательно)"
              className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          </div>
        )}

        <button type="submit" disabled={busy || (mode === 'document' && !query.trim() && !client.trim()) || (formDriver === '__ext__' && !extName.trim())}
          className="self-start px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg">
          {busy ? '⏳…' : '+ Создать доставку'}
        </button>
        <p className="text-xs text-gray-400">Без водителя — появится в «Без водителя». Со штатным/внешним — сразу назначится.</p>
      </form>
      )}

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {loading ? (
        <div className="text-gray-500 text-sm">Загрузка…</div>
      ) : (
        <>
          {/* Без водителя */}
          {visibleUnassigned.length > 0 && (
            <div className="mb-5">
              <button onClick={() => setUnassignedOpen((o) => !o)}
                className="w-full flex items-center gap-1.5 text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
                <span className="text-gray-400">{unassignedOpen ? '▾' : '▸'}</span>
                Без водителя ({visibleUnassigned.length})
              </button>
              {unassignedOpen && (
                <div className="flex flex-col gap-2">
                  {visibleUnassigned.map((d) => (
                    <DeliveryRow key={d.id} d={d} drivers={drivers} onPatch={patch} onRemove={remove} capSettings={capSettings} directionsByDriver={directionsByDriver} onReload={load} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Собранные, но ещё без водителя — готовы к выдаче */}
          {visiblePickedUnassigned.length > 0 && (
            <div className="mb-5">
              <button onClick={() => setPickedUnassignedOpen((o) => !o)}
                className="w-full flex items-center gap-1.5 text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2">
                <span className="text-gray-400">{pickedUnassignedOpen ? '▾' : '▸'}</span>
                📦 Собранные, без водителя ({visiblePickedUnassigned.length})
              </button>
              {pickedUnassignedOpen && (
                <div className="flex flex-col gap-2">
                  {visiblePickedUnassigned.map((d) => (
                    <DeliveryRow key={d.id} d={d} drivers={drivers} onPatch={patch} onRemove={remove} capSettings={capSettings} directionsByDriver={directionsByDriver} onReload={load} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Водители */}
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Водители ({shownDrivers.length}{shownDrivers.length !== drivers.length ? ` из ${drivers.length}` : ''})
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {([
                ['trip', '🧭 по заходу'],
                ['load', '📶 по загрузке'],
                ['name', '🔤 по имени'],
              ] as const).map(([key, label]) => (
                <button key={key} onClick={() => setDriverSort(key)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors whitespace-nowrap ${
                    driverSort === key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-500 border-gray-200 hover:border-slate-300'
                  }`}>
                  {label}
                </button>
              ))}
              {drivers.length > 6 && (
                <input value={driverSearch} onChange={(e) => setDriverSearch(e.target.value)}
                  placeholder="🔍 водитель / машина"
                  className="border border-gray-200 rounded-lg px-2.5 py-1 text-xs outline-none focus:border-blue-400" />
              )}
            </div>
          </div>

          {/* Фильтр по типу машины (по умолчанию — только доставочные: LABO, Газель) */}
          {categories.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {categories.map(([cat, n]) => {
                const on = selCats.includes(cat);
                return (
                  <button key={cat} onClick={() => toggleCat(cat)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-500 border-gray-200 hover:border-slate-300'
                    }`}>
                    {cat} <span className={on ? 'text-gray-300' : 'text-gray-400'}>{n}</span>
                  </button>
                );
              })}
            </div>
          )}

          {drivers.length === 0 ? (
            <div className="bg-white rounded-xl p-6 text-center text-gray-400 text-sm">
              Водителей нет. Добавьте их в разделе «Пользователи» (роль «Водитель») или загрузите из Excel.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {shownDrivers.map((dr) => (
                <DriverCard
                  key={dr.username}
                  driver={dr}
                  deliveries={byDriver.get(dr.username) || []}
                  allDrivers={drivers}
                  hideDone={hideDone}
                  onlyPicked={onlyPicked}
                  activeRoute={activeRoutes.find((r) => r.driver_username === dr.username) || null}
                  onPatch={patch}
                  onRemove={remove}
                  onAssign={() => setAssignTo(dr)}
                  capSettings={capSettings}
                  directionsByDriver={directionsByDriver}
                  onReload={load}
                />
              ))}
            </div>
          )}
        </>
      )}

      {assignTo && (
        <AssignDocModal
          driver={assignTo}
          shops={shops}
          onClose={() => setAssignTo(null)}
          onPick={assignDoc}
        />
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

// ─── Карточка водителя ──────────────────────────────────────────────────────
function DriverCard({
  driver, deliveries, allDrivers, hideDone, onlyPicked, activeRoute, onPatch, onRemove, onAssign, capSettings, directionsByDriver, onReload,
}: {
  driver: UserInfo;
  deliveries: Delivery[];
  allDrivers: UserInfo[];
  hideDone: boolean;
  onlyPicked: boolean;
  activeRoute: Route | null;
  onPatch: (id: string, p: Parameters<typeof updateDelivery>[1]) => void;
  onRemove: (id: string) => void;
  onAssign: () => void;
  capSettings: LogisticsSettings;
  directionsByDriver: Map<string, Set<string>>;
  onReload?: () => void;
}) {
  const [open, setOpen] = useState(false);

  const counts = useMemo(() => {
    const c: Record<DeliveryStatus, number> = { new: 0, assigned: 0, on_way: 0, delivered: 0, returned: 0 };
    for (const d of deliveries) c[d.status] += 1;
    return c;
  }, [deliveries]);

  const activeCount = ACTIVE.reduce((s, st) => s + counts[st], 0);
  const doneCount = counts.delivered + counts.returned;
  const shown = (hideDone ? deliveries.filter((d) => !isDone(d.status)) : deliveries).filter((d) => !onlyPicked || d.picked);
  const doneDeliveries = deliveries.filter((d) => isDone(d.status));
  const [showDone, setShowDone] = useState(false);

  // Нагрузка: только активные доставки.
  const activeDeliveries = deliveries.filter((d) => !isDone(d.status));
  const totalWeightKg = activeDeliveries.reduce((s, d) => s + (d.total_weight || 0), 0);
  const totalVolL = activeDeliveries.reduce((s, d) => s + (d.total_volume_l || 0), 0);
  const totalQty = activeDeliveries.reduce((s, d) => s + (d.total_qty || 0), 0);
  const dimsApprox = activeDeliveries.some((d) => d.dims_approx);
  const totalKm = activeDeliveries.reduce((s, d) => s + (d.km || 0), 0);
  // Вместимость: своя (если задана в «Пользователи»), иначе общий дефолт по типу машины.
  const defCap = defaultCapacity(driver.transport, capSettings);
  const capKg = driver.capacity_kg > 0 ? driver.capacity_kg : defCap.kg;
  const capM3 = driver.capacity_m3 > 0 ? driver.capacity_m3 : defCap.m3;
  const loadPctKg = capKg > 0 ? Math.min(100, (totalWeightKg / capKg) * 100) : 0;
  const loadPctM3 = capM3 > 0 ? Math.min(100, (totalVolL / (capM3 * 1000)) * 100) : 0;
  // Если у товаров нет веса/объёма — показываем загрузку по штукам.
  const noWeightVol = totalWeightKg === 0 && totalVolL === 0;
  const loadPctPcs = defCap.pcs > 0 ? Math.min(100, (totalQty / defCap.pcs) * 100) : 0;

  return (
    <div className="bg-white rounded-xl shadow-sm">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 p-3.5 text-left">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate flex items-center gap-1.5">
            {driver.name}
            {activeRoute && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 whitespace-nowrap">
                🧭 в заходе с {fmtTripStart(activeRoute.started_at)}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400 truncate flex flex-wrap items-center gap-2">
            {driver.car_number && <span>🚗 {driver.car_number}</span>}
            {driver.transport && <span>{driver.transport}</span>}
            {driver.direction && <span className="text-blue-500">{driver.direction}</span>}
            {totalKm > 0 && <span>🛣️ {totalKm * 2} км</span>}
          </div>
          {/* Загрузка машины. Если есть вес/объём — по ним; иначе по штукам. */}
          {(totalWeightKg > 0 || totalVolL > 0 || totalQty > 0) && (
            <div className="mt-1 flex flex-col gap-0.5">
              {totalWeightKg > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 w-20 shrink-0">⚖️ {dimsApprox ? '≈' : ''}{Math.round(totalWeightKg)}/{capKg} кг</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${loadPctKg > 90 ? 'bg-red-500' : loadPctKg > 70 ? 'bg-amber-400' : 'bg-green-400'}`}
                      style={{ width: `${loadPctKg}%` }} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{Math.round(loadPctKg)}%</span>
                </div>
              )}
              {totalVolL > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 w-20 shrink-0">📦 {dimsApprox ? '≈' : ''}{(totalVolL / 1000).toFixed(1)}/{capM3} м³</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${loadPctM3 > 90 ? 'bg-red-500' : loadPctM3 > 70 ? 'bg-amber-400' : 'bg-blue-400'}`}
                      style={{ width: `${loadPctM3}%` }} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{Math.round(loadPctM3)}%</span>
                </div>
              )}
              {noWeightVol && totalQty > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 w-20 shrink-0">🧺 {totalQty}/{defCap.pcs} шт</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${loadPctPcs > 90 ? 'bg-red-500' : loadPctPcs > 70 ? 'bg-amber-400' : 'bg-indigo-400'}`}
                      style={{ width: `${loadPctPcs}%` }} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-8 text-right">{Math.round(loadPctPcs)}%</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {ACTIVE.map((st) => counts[st] > 0 && (
            <span key={st} className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusClass(st)}`}>
              {DELIVERY_STATUS_LABEL[st]} {counts[st]}
            </span>
          ))}
          {doneCount > 0 && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">✓ {doneCount}</span>
          )}
          {activeCount === 0 && doneCount === 0 && (
            <span className="text-[11px] text-gray-300">нет доставок</span>
          )}
          <span className="text-gray-300 ml-1">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="px-3.5 pb-3.5 border-t border-gray-100 pt-2.5">
          <div className="flex items-center gap-2 flex-wrap mb-2.5">
            <button onClick={onAssign}
              className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg">
              + Назначить накладную / заказ
            </button>
            <span className="text-[11px] text-gray-400 ml-auto">
              Вместимость: {capKg} кг · {capM3} м³
              {driver.capacity_kg > 0 || driver.capacity_m3 > 0 ? ' (своя, из карточки пользователя)' : ` (по умолчанию для ${vehicleCategory(driver.transport)})`}
            </span>
          </div>
          {shown.length === 0 ? (
            <div className="text-xs text-gray-400 py-1">Нет {hideDone ? 'активных ' : ''}доставок</div>
          ) : (
            <div className="flex flex-col gap-2">
              {shown.map((d) => (
                <DeliveryRow key={d.id} d={d} drivers={allDrivers} onPatch={onPatch} onRemove={onRemove} compact capSettings={capSettings} directionsByDriver={directionsByDriver} onReload={onReload} />
              ))}
            </div>
          )}

          {/* Завершённые доставки — свернуты; можно раскрыть и удалить (чистка тестовых). */}
          {hideDone && doneDeliveries.length > 0 && (
            <div className="mt-2.5">
              <button onClick={() => setShowDone((v) => !v)}
                className="text-[11px] text-gray-400 hover:text-gray-600 font-semibold">
                ✓ Завершённые ({doneDeliveries.length}) {showDone ? '▲' : '▼'}
              </button>
              {showDone && (
                <div className="flex flex-col gap-2 mt-2 opacity-80">
                  {doneDeliveries.map((d) => (
                    <DeliveryRow key={d.id} d={d} drivers={allDrivers} onPatch={onPatch} onRemove={onRemove} compact capSettings={capSettings} directionsByDriver={directionsByDriver} onReload={onReload} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Строка доставки ──────────────────────────────────────────────────────────
function DeliveryRow({
  d, drivers, onPatch, onRemove, compact, capSettings, directionsByDriver, onReload,
}: {
  d: Delivery;
  drivers: UserInfo[];
  onPatch: (id: string, p: Parameters<typeof updateDelivery>[1]) => void;
  onRemove: (id: string) => void;
  compact?: boolean;
  capSettings?: LogisticsSettings;
  directionsByDriver?: Map<string, Set<string>>;
  onReload?: () => void;
}) {
  const [editAddr, setEditAddr] = useState(false);
  const [addr, setAddr] = useState(d.address);
  const [editCash, setEditCash] = useState(false);
  const [cash, setCash] = useState(d.cash_amount ? String(d.cash_amount) : '');
  const [km, setKm] = useState(String(d.km || ''));
  const [manualKg, setManualKg] = useState('');
  const [splitOpen, setSplitOpen] = useState(false);
  // Куб (м³) для ручного ввода/правки — предзаполняем текущим значением, если оно есть.
  const [manualM3, setManualM3] = useState(d.total_volume_l > 0 ? String(Math.round(d.total_volume_l / 10) / 100) : '');
  // «Со стороны» (улица): имя/машина + сумма + комментарий.
  const [extOpen, setExtOpen] = useState(false);
  const [extName, setExtName] = useState(d.external ? (d.driver_name || '') : '');
  const [extCar, setExtCar] = useState(d.external ? (d.car_number || '') : '');
  const [extCost, setExtCost] = useState(d.external_cost ? String(d.external_cost) : '');
  const [extNote, setExtNote] = useState(d.external_note || '');

  const assignedDriver = drivers.find((dr) => dr.username === d.driver_username);
  const capKg = assignedDriver
    ? (assignedDriver.capacity_kg > 0 ? assignedDriver.capacity_kg : defaultCapacity(assignedDriver.transport, capSettings || DEFAULT_CAP_SETTINGS).kg)
    : 0;
  const loadKg = d.total_weight > 0 ? d.total_weight : (Number(manualKg) || 0);
  const loadPct = capKg > 0 && loadKg > 0 ? Math.min(100, Math.round((loadKg / capKg) * 100)) : null;
  const loadColor = loadPct === null ? '' : loadPct > 90 ? 'bg-red-500' : loadPct > 70 ? 'bg-amber-400' : 'bg-green-500';

  return (
    <div className={`rounded-lg ${compact ? 'bg-gray-50' : 'bg-white shadow-sm'} p-3 flex flex-col gap-2`}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm flex items-center gap-2 flex-wrap">
            {d.doc_type && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                {DOC_TYPE_LABEL[d.doc_type]} № {d.doc_number || d.doc_id}
              </span>
            )}
            {d.from_name && d.to_name ? (
              <span className="break-words">🏬 {d.from_name} <span className="text-gray-400">→</span> {d.to_name}</span>
            ) : (
              <span className="break-words">🚚 {d.client_name || 'Без названия'}</span>
            )}
          </div>
          {/* Если есть и маршрут, и клиент — клиента покажем отдельной строкой */}
          {d.from_name && d.to_name && d.client_name && d.client_name !== d.to_name && d.client_name !== `${d.from_name} → ${d.to_name}` && (
            <div className="text-xs text-gray-500 mt-0.5">🚚 {d.client_name}</div>
          )}
          {d.address && (
            <div className="text-xs text-gray-500 mt-0.5">
              📍 {d.address}
              <a href={`https://yandex.ru/maps/?text=${encodeURIComponent(d.address)}`} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()} className="ml-2 text-blue-600 hover:underline">🗺️ Яндекс</a>
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}`} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()} className="ml-2 text-blue-600 hover:underline">Google</a>
            </div>
          )}
          {d.note && <div className="text-xs text-gray-400 mt-0.5">📝 {d.note}</div>}
          {d.cash_amount != null && d.cash_amount > 0 && (
            <div className="text-xs font-semibold text-emerald-700 mt-0.5">
              💵 К получению: {d.cash_amount.toLocaleString('ru-RU')} сум
              {d.cash_settled_at && <span className="ml-1 text-gray-400 font-normal">· сдано</span>}
            </div>
          )}
          <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
            <span>создано {fmt(d.created_at)}{d.created_by ? ` · ${d.created_by}` : ''}</span>
            <span className="font-mono text-[10px] text-gray-300 bg-gray-100 px-1.5 py-0.5 rounded select-all">#{d.id.slice(-6).toUpperCase()}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusClass(d.status)}`}>
            {DELIVERY_STATUS_LABEL[d.status]}
          </span>
          <button onClick={() => onPatch(d.id, { picked: !d.picked })}
            className={`text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${
              d.picked ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}>
            {d.picked ? '✓ Собрано' : '📦 Собрать'}
          </button>
        </div>
      </div>

      {/* км + вес + загруженность */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400">км:</span>
          <input type="number" min={0} value={km}
            onChange={(e) => setKm(e.target.value)}
            onBlur={() => onPatch(d.id, { km: Number(km) || 0 })}
            className="w-14 border border-gray-100 rounded px-1.5 py-0.5 text-[11px] text-right outline-none focus:border-blue-300"
          />
        </div>
        {/* Ручной ввод/правка куба (м³). Если у товара куб уже посчитан — поле им заполнено, можно изменить. */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400">м³:</span>
          <input type="number" min={0} step={0.01} value={manualM3}
            onChange={(e) => setManualM3(e.target.value)}
            onBlur={() => { const v = Number(manualM3); if (v >= 0 && Math.round(v * 1000) !== Math.round(d.total_volume_l)) onPatch(d.id, { total_volume_l: v * 1000 }); }}
            placeholder="—"
            title="Объём груза, м³ — ручной ввод (переопределяет авто-расчёт)"
            className="w-16 border border-gray-100 rounded px-1.5 py-0.5 text-[11px] text-right outline-none focus:border-blue-300"
          />
        </div>
        {(d.total_qty > 0 || d.total_weight > 0) && (
          <span className="text-[10px] text-gray-400">
            {d.total_qty > 0 && `${d.total_qty} шт`}
            {d.total_weight > 0 && ` · ${d.dims_approx ? '≈' : ''}${d.total_weight} кг`}
            {d.total_volume_l > 0 && ` · ${d.dims_approx ? '≈' : ''}${(d.total_volume_l / 1000).toFixed(2)} м³`}
          </span>
        )}
        {/* Загруженность машины */}
        {assignedDriver && loadPct !== null && (
          <div className="flex items-center gap-1.5 ml-auto">
            <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${loadColor}`} style={{ width: `${loadPct}%` }} />
            </div>
            <span className={`text-[10px] font-semibold ${loadPct > 90 ? 'text-red-500' : loadPct > 70 ? 'text-amber-500' : 'text-green-600'}`}>
              {loadPct}%
            </span>
            <span className="text-[10px] text-gray-400">{loadKg}/{capKg} кг</span>
          </div>
        )}
        {/* Если кг не известны — ручной ввод */}
        {assignedDriver && capKg > 0 && d.total_weight === 0 && (
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-[10px] text-gray-400">груз кг:</span>
            <input type="number" min={0} value={manualKg}
              onChange={(e) => setManualKg(e.target.value)}
              onBlur={() => { if (Number(manualKg) > 0) onPatch(d.id, { total_weight: Number(manualKg) }); }}
              placeholder="—"
              className="w-16 border border-gray-100 rounded px-1.5 py-0.5 text-[11px] text-right outline-none focus:border-blue-300"
            />
            {loadPct === null && Number(manualKg) > 0 && (
              <span className="text-[10px] text-gray-400">/ {capKg} кг</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <select value={d.driver_username || ''} onChange={(e) => onPatch(d.id, { driver_username: e.target.value || null })}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-400">
          <option value="">— назначить водителя —</option>
          {drivers.map((dr) => {
            const dirs = directionsByDriver?.get(dr.username);
            const mismatch = !!d.direction && !!dirs?.size && !dirs.has(d.direction);
            return (
              <option key={dr.username} value={dr.username}>
                {mismatch ? '⚠️ ' : ''}{dr.name}{dr.car_number ? ` · ${dr.car_number}` : ''}
                {mismatch ? ` (едет в ${[...dirs].join('/')})` : ''}
              </option>
            );
          })}
        </select>
        {(() => {
          const dirs = directionsByDriver?.get(d.driver_username || '');
          const mismatch = !!d.direction && !!dirs?.size && !dirs.has(d.direction);
          return mismatch ? (
            <span className="text-[11px] text-amber-600 bg-amber-50 rounded-full px-2 py-1 whitespace-nowrap">
              ⚠️ у водителя другой груз в {[...dirs].join('/')}, а эта доставка — в {d.direction}
            </span>
          ) : null;
        })()}
        <select value={d.status} onChange={(e) => onPatch(d.id, { status: e.target.value as DeliveryStatus })}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-400">
          {STATUSES.map((s) => (
            <option key={s} value={s}>{DELIVERY_STATUS_LABEL[s]}</option>
          ))}
        </select>
        <button onClick={() => setEditAddr((v) => !v)}
          title={d.address ? 'Изменить адрес' : 'Добавить адрес'}
          className="text-sm px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600">
          📍
        </button>
        {(d.total_qty > 0 || (d.items?.length ?? 0) > 0) && (
          <button onClick={() => setSplitOpen(true)}
            title="Разделить по частям: водителю уходит часть, что влезает в машину; остаток остаётся"
            className="text-sm font-semibold px-2.5 py-1.5 rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200">
            ✂️
          </button>
        )}
        <button onClick={() => setExtOpen((v) => !v)}
          title="Со стороны (улица): назначить водителя вручную с суммой оплаты"
          className={`text-sm font-semibold px-2.5 py-1.5 rounded-lg ${d.external ? 'bg-orange-200 text-orange-800' : 'bg-orange-100 text-orange-700 hover:bg-orange-200'}`}>
          🚖
        </button>
        <button onClick={() => setEditCash((v) => !v)}
          title="Деньги к получению с клиента (наличные) — попадёт в кассу водителя"
          className={`text-sm font-semibold px-2.5 py-1.5 rounded-lg ${d.cash_amount && d.cash_amount > 0 ? 'bg-emerald-200 text-emerald-800' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}>
          💵
        </button>
        <button onClick={() => onRemove(d.id)}
          title="Удалить доставку"
          className="ml-auto text-sm font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700 hover:bg-red-200">
          🗑️
        </button>
      </div>

      {splitOpen && (
        <SplitDeliveryModal
          delivery={d}
          drivers={drivers}
          capSettings={capSettings ?? null}
          defaultCapSettings={DEFAULT_CAP_SETTINGS}
          onClose={() => setSplitOpen(false)}
          onDone={() => { setSplitOpen(false); onReload?.(); }}
        />
      )}

      {editAddr && (
        <div className="flex items-center gap-2">
          <input value={addr} onChange={(e) => setAddr(e.target.value)} autoComplete="off"
            placeholder="Адрес доставки"
            className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-400" />
          <button onClick={() => { onPatch(d.id, { address: addr.trim() }); setEditAddr(false); }}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white">
            OK
          </button>
        </div>
      )}

      {editCash && (
        <div className="flex items-center gap-2">
          <input value={cash} onChange={(e) => setCash(e.target.value)} autoComplete="off"
            type="number" inputMode="decimal" min={0} placeholder="Сумма к получению (сум), пусто — не нужно"
            className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-emerald-400" />
          <button onClick={() => {
              const n = cash.trim() === '' ? null : Math.max(0, Number(cash) || 0);
              onPatch(d.id, { cash_amount: n && n > 0 ? n : null });
              setEditCash(false);
            }}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white">
            OK
          </button>
        </div>
      )}

      {/* Назначен «со стороны» — короткая сводка */}
      {d.external && !extOpen && (
        <div className="text-xs text-orange-700 bg-orange-50 rounded-lg px-2.5 py-1.5">
          🚖 Со стороны: <b>{d.driver_name || '—'}</b>{d.car_number ? ` · ${d.car_number}` : ''}
          {d.external_cost ? ` · 💸 ${Math.round(d.external_cost).toLocaleString('ru-RU')} сум` : ''}
          {d.external_note ? ` · 📝 ${d.external_note}` : ''}
        </div>
      )}

      {/* Форма назначения «со стороны» (улица) */}
      {extOpen && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-2.5 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input value={extName} onChange={(e) => setExtName(e.target.value)} placeholder="Имя водителя"
              className="flex-1 min-w-[120px] border border-orange-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-orange-400" />
            <input value={extCar} onChange={(e) => setExtCar(e.target.value)} placeholder="Машина (номер)"
              className="flex-1 min-w-[120px] border border-orange-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-orange-400" />
          </div>
          <div className="flex flex-wrap gap-2">
            <input type="number" min={0} value={extCost} onChange={(e) => setExtCost(e.target.value)} placeholder="Сумма, сум"
              className="w-32 border border-orange-200 rounded-lg px-2.5 py-1.5 text-xs text-right outline-none focus:border-orange-400" />
            <input value={extNote} onChange={(e) => setExtNote(e.target.value)} placeholder="Комментарий"
              className="flex-1 min-w-[140px] border border-orange-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-orange-400" />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!extName.trim()) return;
                onPatch(d.id, { external_driver: extName.trim(), external_car: extCar.trim(), external_cost: Number(extCost) || 0, external_note: extNote.trim() });
                setExtOpen(false);
              }}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white">
              Назначить со стороны
            </button>
            <button onClick={() => setExtOpen(false)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600">
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Модалка: выбор существующего документа для назначения ─────────────────────
type AssignTab = 'movement' | 'order' | 'transfer';

type DocRef = { movement_id?: string; deal_id?: string; transfer_id?: string };

function AssignDocModal({
  driver, shops, onClose, onPick,
}: {
  driver: UserInfo;
  shops: Shop[];
  onClose: () => void;
  onPick: (ref: DocRef, driverUsername: string, shopMatch?: { direction: string; km: number }) => Promise<void>;
}) {
  const [tab, setTab] = useState<AssignTab>('movement');
  const [movements, setMovements] = useState<MovementListItem[]>([]);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [transfers, setTransfers] = useState<TransferListItem[]>([]);
  // Документы с завершённой проверкой (доступно через sessions.doc_id) — считаем «собранными».
  const [pickedDocIds, setPickedDocIds] = useState<Set<string>>(new Set());
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  // Множественный выбор: id → { ref, destName (куда везём, для сопоставления с точкой доставки) }.
  const [selected, setSelected] = useState<Record<string, { ref: DocRef; destName: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(0);

  useEffect(() => {
    Promise.all([
      listMovements().catch(() => []),
      listOrders().catch(() => []),
      listTransfers().catch(() => []),
      listSessions().catch(() => []),
    ])
      .then(([m, o, t, sessions]) => {
        setMovements(m); setOrders(o); setTransfers(t);
        setPickedDocIds(new Set(sessions.filter((s) => s.status === 'finished').map((s) => s.doc_id)));
      })
      .finally(() => setLoading(false));
  }, []);

  function toggle(id: string, ref: DocRef, destName: string) {
    if (submitting) return;
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = { ref, destName };
      return next;
    });
  }

  // Ищем магазин по названию пункта назначения (нечёткое совпадение).
  function findShopMatch(destName: string): { direction: string; km: number } | undefined {
    if (!destName.trim()) return undefined;
    const norm = destName.toLowerCase().trim();
    const match = shops.find(s => {
      const sn = s.name.toLowerCase().trim();
      return sn === norm || sn.includes(norm) || norm.includes(sn);
    });
    if (!match || !match.direction) return undefined;
    return { direction: match.direction, km: match.km };
  }

  const count = Object.keys(selected).length;

  async function submit() {
    if (!count || submitting) return;
    setSubmitting(true);
    setErr('');
    setDone(0);
    const errs: string[] = [];
    for (const { ref, destName } of Object.values(selected)) {
      try {
        const shopMatch = findShopMatch(destName);
        await onPick(ref, driver.username, shopMatch);
        setDone((d) => d + 1);
      } catch (e) {
        errs.push((e as Error).message);
      }
    }
    if (errs.length) {
      setErr(`Создано с ошибками (${errs.length}): ${errs[0]}`);
      setSubmitting(false);
    } else {
      onClose();
    }
  }

  const needle = q.trim().toLowerCase();
  const shownMovements = movements.filter((m) =>
    (!needle || `${m.movement_number} ${m.from_warehouse_name || ''} ${m.to_warehouse_name || ''}`.toLowerCase().includes(needle)) &&
    (!onlyPicked || pickedDocIds.has(m.movement_id)));
  const shownOrders = orders.filter((o) =>
    (!needle || `${o.doc_number} ${o.client_name}`.toLowerCase().includes(needle)) &&
    (!onlyPicked || pickedDocIds.has(o.deal_id)));
  const shownTransfers = transfers.filter((t) =>
    (!needle || `${t.number} ${t.from_filial || ''} ${t.to_filial || ''}`.toLowerCase().includes(needle)) &&
    (!onlyPicked || pickedDocIds.has(t.transfer_id)));

  const rowCls = (id: string) =>
    `w-full text-left border rounded-lg px-3 py-2 transition-colors flex items-start gap-2.5 ${
      selected[id] ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50 hover:border-blue-300'
    } ${submitting ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`;

  const checkbox = (id: string) => (
    <span className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[11px] ${
      selected[id] ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300 bg-white'
    }`}>{selected[id] ? '✓' : ''}</span>
  );

  const tabBtn = (t: AssignTab, label: string) => (
    <button onClick={() => setTab(t)}
      className={`text-xs px-3 py-1.5 rounded-full font-semibold ${tab === t ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-4 pb-2">
          <div>
            <div className="font-bold text-base">Назначить водителю</div>
            <div className="text-xs text-gray-400">{driver.name}{driver.car_number ? ` · 🚗 ${driver.car_number}` : ''}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="px-4 flex items-center gap-2 flex-wrap">
          {tabBtn('movement', `🗂️ Накладные (${movements.length})`)}
          {tabBtn('order', `🧾 Заказы (${orders.length})`)}
          {tabBtn('transfer', `🔄 Перемещения (${transfers.length})`)}
        </div>

        <div className="px-4 pt-2 flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
            placeholder="🔍 поиск по номеру / складу / клиенту"
            className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer whitespace-nowrap">
            <input type="checkbox" checked={onlyPicked} onChange={(e) => setOnlyPicked(e.target.checked)} />
            Только собранные
          </label>
        </div>

        {err && <div className="px-4 pt-2 text-red-500 text-sm">{err}</div>}

        <div className="flex-1 overflow-y-auto p-4 pt-2 flex flex-col gap-1.5">
          {loading ? (
            <div className="text-center text-gray-400 text-sm py-6">Загрузка из Smartup…</div>
          ) : tab === 'movement' ? (
            shownMovements.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-6">Накладных не найдено</div>
            ) : shownMovements.map((m) => (
              <button key={m.movement_id} onClick={() => toggle(m.movement_id, { movement_id: m.movement_id }, m.to_warehouse_name || '')} className={rowCls(m.movement_id)}>
                {checkbox(m.movement_id)}
                <span className="min-w-0">
                  <span className="text-sm font-semibold block">№ {m.movement_number}
                    <span className="ml-2 text-[11px] font-normal text-gray-400">{MOVEMENT_STATUS_LABEL[m.status] || m.status}</span>
                    {pickedDocIds.has(m.movement_id) && <span className="ml-2 text-[11px] font-semibold text-emerald-600">✓ Собрано</span>}
                  </span>
                  <span className="text-xs text-gray-500 block">🏬 {m.from_warehouse_name || m.from_warehouse_code || '—'} → {m.to_warehouse_name || m.to_warehouse_code || '—'}</span>
                  <span className="text-[11px] text-gray-400 block">{m.items_count} поз. · {m.total_quantity} шт · {m.from_movement_date}</span>
                </span>
              </button>
            ))
          ) : tab === 'order' ? (
            shownOrders.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-6">Заказов не найдено</div>
            ) : shownOrders.map((o) => (
              <button key={o.deal_id} onClick={() => toggle(o.deal_id, { deal_id: o.deal_id }, o.client_name || '')} className={rowCls(o.deal_id)}>
                {checkbox(o.deal_id)}
                <span className="min-w-0">
                  <span className="text-sm font-semibold block">№ {o.doc_number}
                    {pickedDocIds.has(o.deal_id) && <span className="ml-2 text-[11px] font-semibold text-emerald-600">✓ Собрано</span>}
                  </span>
                  <span className="text-xs text-gray-500 block">🚚 {o.client_name || '—'}</span>
                  <span className="text-[11px] text-gray-400 block">{o.items_count} поз. · {o.total_quantity} шт · {o.date}</span>
                </span>
              </button>
            ))
          ) : (
            shownTransfers.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-6">Перемещений не найдено</div>
            ) : shownTransfers.map((t) => (
              <button key={t.transfer_id} onClick={() => toggle(t.transfer_id, { transfer_id: t.transfer_id }, t.to_filial || '')} className={rowCls(t.transfer_id)}>
                {checkbox(t.transfer_id)}
                <span className="min-w-0">
                  <span className="text-sm font-semibold block">№ {t.number}
                    {pickedDocIds.has(t.transfer_id) && <span className="ml-2 text-[11px] font-semibold text-emerald-600">✓ Собрано</span>}
                  </span>
                  <span className="text-xs text-gray-500 block">🏬 {t.from_filial || '—'} → {t.to_filial || '—'}</span>
                  <span className="text-[11px] text-gray-400 block">{t.items_count} поз. · {t.total_quantity} шт · {t.date}</span>
                </span>
              </button>
            ))
          )}
        </div>

        {/* Подвал: назначить выбранные */}
        <div className="p-3 border-t border-gray-100 flex items-center gap-3">
          <span className="text-xs text-gray-500">Выбрано: <b>{count}</b></span>
          <button onClick={submit} disabled={!count || submitting}
            className="ml-auto px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-semibold rounded-lg">
            {submitting ? `Создаю… ${done}/${count}` : `Назначить${count ? ` (${count})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
