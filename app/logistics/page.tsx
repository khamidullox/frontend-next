'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AdminGate from '@/components/AdminGate';
import {
  listDeliveries, createDelivery, updateDelivery, deleteDeliveryApi, listDrivers,
  listMovements, listOrders, listTransfers, MovementListItem, OrderListItem, TransferListItem, MOVEMENT_STATUS_LABEL,
  Delivery, DeliveryStatus, DELIVERY_STATUS_LABEL, DOC_TYPE_LABEL, UserInfo,
} from '@/lib/api';

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

function fmt(iso?: string | null) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

// Категория транспорта для фильтра. LABO/Газель — доставочные, остальное — служебные.
function vehicleCategory(transport: string | null | undefined): string {
  const t = (transport || '').toLowerCase();
  if (t.includes('labo')) return 'LABO';
  if (t.includes('gaz') || t.includes('газел') || t.includes('33021')) return 'Газель';
  if (!t.trim()) return 'Без типа';
  return 'Служебная';
}
const DELIVERY_CATS = ['LABO', 'Газель'];

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
  const [hideDone, setHideDone] = useState(true);
  const [driverSearch, setDriverSearch] = useState('');
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
      const driverPart =
        formDriver === '__ext__'
          ? { external_driver: extName.trim(), external_car: extCar.trim() }
          : formDriver
          ? { driver_username: formDriver }
          : {};
      await createDelivery({
        ...(mode === 'document' ? { query: query.trim() } : {}),
        client_name: client.trim(),
        address: address.trim(),
        note: note.trim(),
        ...driverPart,
      });
      setQuery(''); setClient(''); setAddress(''); setNote('');
      setFormDriver(''); setExtName(''); setExtCar('');
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

  const remove = useCallback(async (id: string) => {
    if (!confirm('Удалить доставку?')) return;
    setError('');
    try {
      await deleteDeliveryApi(id);
      setItems((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // Назначить водителю существующий документ (накладная/заказ/перемещение) из модалки.
  const assignDoc = useCallback(async (
    ref: { movement_id?: string; deal_id?: string; transfer_id?: string },
    driver_username: string
  ) => {
    const created = await createDelivery({ ...ref, driver_username });
    setItems((prev) => [created, ...prev]);
  }, []);

  // Группировка доставок: штатные водители (по username), внешние (по имени), без водителя.
  const { byDriver, external, unassigned } = useMemo(() => {
    const map = new Map<string, Delivery[]>();
    const ext = new Map<string, Delivery[]>();
    const none: Delivery[] = [];
    for (const d of items) {
      if (d.driver_username) {
        const arr = map.get(d.driver_username) || [];
        arr.push(d); map.set(d.driver_username, arr);
      } else if (d.driver_name) {
        const arr = ext.get(d.driver_name) || [];
        arr.push(d); ext.set(d.driver_name, arr);
      } else {
        none.push(d);
      }
    }
    return { byDriver: map, external: ext, unassigned: none };
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
  const defaultCats = allCats.filter((c) => DELIVERY_CATS.includes(c));
  // Активные категории фильтра: явный выбор пользователя, иначе доставочные по умолчанию.
  const selCats = vehSel ?? (defaultCats.length ? defaultCats : allCats);

  function toggleCat(c: string) {
    const base = vehSel ?? (defaultCats.length ? defaultCats : allCats);
    setVehSel(base.includes(c) ? base.filter((x) => x !== c) : [...base, c]);
  }

  const shownDrivers = useMemo(() => {
    const needle = driverSearch.trim().toLowerCase();
    const cats = selCats.length ? selCats : allCats; // пустой выбор = показать всех
    return drivers.filter((d) =>
      cats.includes(vehicleCategory(d.transport)) &&
      (!needle || d.name.toLowerCase().includes(needle) || (d.car_number || '').toLowerCase().includes(needle))
    );
  }, [drivers, driverSearch, selCats, allCats]);

  const visibleUnassigned = hideDone ? unassigned.filter((d) => !isDone(d.status)) : unassigned;

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xl font-bold">🚚 Логистика <span className="text-sm text-gray-400 font-normal">({items.length})</span></h2>
        <div className="flex items-center gap-3">
          <Link href="/logistics/shops" className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700">
            🏪 Точки доставки
          </Link>
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
            Скрывать завершённые
          </label>
        </div>
      </div>

      {/* Создание доставки — свёрнуто (основной поток: назначение из карточки водителя) */}
      <button onClick={() => setShowForm((v) => !v)}
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
              <div className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">
                Без водителя ({visibleUnassigned.length})
              </div>
              <div className="flex flex-col gap-2">
                {visibleUnassigned.map((d) => (
                  <DeliveryRow key={d.id} d={d} drivers={drivers} onPatch={patch} onRemove={remove} />
                ))}
              </div>
            </div>
          )}

          {/* Внешние водители (со стороны, без аккаунта) */}
          {external.size > 0 && (
            <div className="mb-5">
              <div className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-2">
                Внешние водители ({external.size})
              </div>
              <div className="flex flex-col gap-2">
                {[...external.entries()].map(([name, ds]) => {
                  const shown = hideDone ? ds.filter((d) => !isDone(d.status)) : ds;
                  if (!shown.length) return null;
                  const car = ds.find((d) => d.car_number)?.car_number;
                  return (
                    <div key={name} className="bg-white rounded-xl shadow-sm p-3">
                      <div className="font-semibold text-sm mb-2">
                        🧑‍✈️ {name}
                        {car && <span className="text-xs text-gray-400 font-normal"> · 🚗 {car}</span>}
                      </div>
                      <div className="flex flex-col gap-2">
                        {shown.map((d) => (
                          <DeliveryRow key={d.id} d={d} drivers={drivers} onPatch={patch} onRemove={remove} compact />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Водители */}
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Водители ({shownDrivers.length}{shownDrivers.length !== drivers.length ? ` из ${drivers.length}` : ''})
            </div>
            {drivers.length > 6 && (
              <input value={driverSearch} onChange={(e) => setDriverSearch(e.target.value)}
                placeholder="🔍 водитель / машина"
                className="border border-gray-200 rounded-lg px-2.5 py-1 text-xs outline-none focus:border-blue-400" />
            )}
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
                  onPatch={patch}
                  onRemove={remove}
                  onAssign={() => setAssignTo(dr)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {assignTo && (
        <AssignDocModal
          driver={assignTo}
          onClose={() => setAssignTo(null)}
          onPick={assignDoc}
        />
      )}
    </div>
  );
}

// ─── Карточка водителя ──────────────────────────────────────────────────────
function DriverCard({
  driver, deliveries, allDrivers, hideDone, onPatch, onRemove, onAssign,
}: {
  driver: UserInfo;
  deliveries: Delivery[];
  allDrivers: UserInfo[];
  hideDone: boolean;
  onPatch: (id: string, p: Parameters<typeof updateDelivery>[1]) => void;
  onRemove: (id: string) => void;
  onAssign: () => void;
}) {
  const [open, setOpen] = useState(false);

  const counts = useMemo(() => {
    const c: Record<DeliveryStatus, number> = { new: 0, assigned: 0, on_way: 0, delivered: 0, returned: 0 };
    for (const d of deliveries) c[d.status] += 1;
    return c;
  }, [deliveries]);

  const activeCount = ACTIVE.reduce((s, st) => s + counts[st], 0);
  const doneCount = counts.delivered + counts.returned;
  const shown = hideDone ? deliveries.filter((d) => !isDone(d.status)) : deliveries;

  return (
    <div className="bg-white rounded-xl shadow-sm">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 p-3.5 text-left">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{driver.name}</div>
          <div className="text-xs text-gray-400 truncate">
            {driver.car_number && <>🚗 {driver.car_number}</>}
            {driver.transport && <span className="text-gray-400"> · {driver.transport}</span>}
          </div>
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
          <button onClick={onAssign}
            className="mb-2.5 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg">
            + Назначить накладную / заказ
          </button>
          {shown.length === 0 ? (
            <div className="text-xs text-gray-400 py-1">Нет {hideDone ? 'активных ' : ''}доставок</div>
          ) : (
            <div className="flex flex-col gap-2">
              {shown.map((d) => (
                <DeliveryRow key={d.id} d={d} drivers={allDrivers} onPatch={onPatch} onRemove={onRemove} compact />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Строка доставки ──────────────────────────────────────────────────────────
function DeliveryRow({
  d, drivers, onPatch, onRemove, compact,
}: {
  d: Delivery;
  drivers: UserInfo[];
  onPatch: (id: string, p: Parameters<typeof updateDelivery>[1]) => void;
  onRemove: (id: string) => void;
  compact?: boolean;
}) {
  const [editAddr, setEditAddr] = useState(false);
  const [addr, setAddr] = useState(d.address);

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
              <span className="truncate">🏬 {d.from_name} <span className="text-gray-400">→</span> {d.to_name}</span>
            ) : (
              <span className="truncate">🚚 {d.client_name || 'Без названия'}</span>
            )}
          </div>
          {/* Если есть и маршрут, и клиент — клиента покажем отдельной строкой */}
          {d.from_name && d.to_name && d.client_name && d.client_name !== `${d.from_name} → ${d.to_name}` && (
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
          <div className="text-xs text-gray-400 mt-0.5">создано {fmt(d.created_at)}{d.created_by ? ` · ${d.created_by}` : ''}</div>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusClass(d.status)}`}>
          {DELIVERY_STATUS_LABEL[d.status]}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <select value={d.driver_username || ''} onChange={(e) => onPatch(d.id, { driver_username: e.target.value || null })}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-400">
          <option value="">— назначить водителя —</option>
          {drivers.map((dr) => (
            <option key={dr.username} value={dr.username}>
              {dr.name}{dr.car_number ? ` · ${dr.car_number}` : ''}
            </option>
          ))}
        </select>
        <select value={d.status} onChange={(e) => onPatch(d.id, { status: e.target.value as DeliveryStatus })}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-blue-400">
          {STATUSES.map((s) => (
            <option key={s} value={s}>{DELIVERY_STATUS_LABEL[s]}</option>
          ))}
        </select>
        <button onClick={() => setEditAddr((v) => !v)}
          className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600">
          📍 {d.address ? 'адрес' : '+ адрес'}
        </button>
        <button onClick={() => onRemove(d.id)}
          className="ml-auto text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700 hover:bg-red-200">
          🗑️
        </button>
      </div>

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
    </div>
  );
}

// ─── Модалка: выбор существующего документа для назначения ─────────────────────
type AssignTab = 'movement' | 'order' | 'transfer';

type DocRef = { movement_id?: string; deal_id?: string; transfer_id?: string };

function AssignDocModal({
  driver, onClose, onPick,
}: {
  driver: UserInfo;
  onClose: () => void;
  onPick: (ref: DocRef, driverUsername: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<AssignTab>('movement');
  const [movements, setMovements] = useState<MovementListItem[]>([]);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [transfers, setTransfers] = useState<TransferListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  // Множественный выбор: id документа → ссылка на него.
  const [selected, setSelected] = useState<Record<string, DocRef>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(0);

  useEffect(() => {
    Promise.all([
      listMovements().catch(() => []),
      listOrders().catch(() => []),
      listTransfers().catch(() => []),
    ])
      .then(([m, o, t]) => { setMovements(m); setOrders(o); setTransfers(t); })
      .finally(() => setLoading(false));
  }, []);

  function toggle(id: string, ref: DocRef) {
    if (submitting) return;
    setSelected((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = ref;
      return next;
    });
  }

  const count = Object.keys(selected).length;

  async function submit() {
    if (!count || submitting) return;
    setSubmitting(true);
    setErr('');
    setDone(0);
    const errs: string[] = [];
    for (const ref of Object.values(selected)) {
      try {
        await onPick(ref, driver.username);
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
    !needle || `${m.movement_number} ${m.from_warehouse_name || ''} ${m.to_warehouse_name || ''}`.toLowerCase().includes(needle));
  const shownOrders = orders.filter((o) =>
    !needle || `${o.doc_number} ${o.client_name}`.toLowerCase().includes(needle));
  const shownTransfers = transfers.filter((t) =>
    !needle || `${t.number} ${t.from_filial || ''} ${t.to_filial || ''}`.toLowerCase().includes(needle));

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

        <div className="px-4 pt-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off"
            placeholder="🔍 поиск по номеру / складу / клиенту"
            className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>

        {err && <div className="px-4 pt-2 text-red-500 text-sm">{err}</div>}

        <div className="flex-1 overflow-y-auto p-4 pt-2 flex flex-col gap-1.5">
          {loading ? (
            <div className="text-center text-gray-400 text-sm py-6">Загрузка из Smartup…</div>
          ) : tab === 'movement' ? (
            shownMovements.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-6">Накладных не найдено</div>
            ) : shownMovements.map((m) => (
              <button key={m.movement_id} onClick={() => toggle(m.movement_id, { movement_id: m.movement_id })} className={rowCls(m.movement_id)}>
                {checkbox(m.movement_id)}
                <span className="min-w-0">
                  <span className="text-sm font-semibold block">№ {m.movement_number}
                    <span className="ml-2 text-[11px] font-normal text-gray-400">{MOVEMENT_STATUS_LABEL[m.status] || m.status}</span>
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
              <button key={o.deal_id} onClick={() => toggle(o.deal_id, { deal_id: o.deal_id })} className={rowCls(o.deal_id)}>
                {checkbox(o.deal_id)}
                <span className="min-w-0">
                  <span className="text-sm font-semibold block">№ {o.doc_number}</span>
                  <span className="text-xs text-gray-500 block">🚚 {o.client_name || '—'}</span>
                  <span className="text-[11px] text-gray-400 block">{o.items_count} поз. · {o.total_quantity} шт · {o.date}</span>
                </span>
              </button>
            ))
          ) : (
            shownTransfers.length === 0 ? (
              <div className="text-center text-gray-400 text-sm py-6">Перемещений не найдено</div>
            ) : shownTransfers.map((t) => (
              <button key={t.transfer_id} onClick={() => toggle(t.transfer_id, { transfer_id: t.transfer_id })} className={rowCls(t.transfer_id)}>
                {checkbox(t.transfer_id)}
                <span className="min-w-0">
                  <span className="text-sm font-semibold block">№ {t.number}</span>
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
