'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { listUsers, createUser, deleteUserApi, updateUser, listAllWarehouses, listShops, WarehouseSummary, Shop, UserInfo, Role, ROLE_LABEL } from '@/lib/api';
import AdminGate from '@/components/AdminGate';
import { loadXLSX } from '@/lib/xlsx';
import Pager from '@/components/Pager';
import { whCode } from '@/lib/warehouse';

const PAGE_SIZE = 50;

function parseWarehouses(v: string): string[] {
  return String(v || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

async function exportUsersExcel(users: UserInfo[], shops: Shop[], whList: WarehouseSummary[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const XLSX: any = await loadXLSX();
  const shopName = (id: string) => shops.find((s) => s.id === id)?.name || '';
  const whName = (id: string) => whList.find((w) => w.warehouse_id === id)?.warehouse_name || id;
  const rows = users.map((u, i) => ({
    '№': i + 1,
    'Логин': u.username,
    'Имя': u.name,
    'Роль': ROLE_LABEL[u.role],
    'Склады': u.warehouses.map(whName).join(', '),
    'Магазин': u.shop_id ? shopName(u.shop_id) : '',
    'Свой склад': u.home_warehouse ? whName(u.home_warehouse) : '',
    'Машина': u.car_number,
    'Транспорт': u.transport,
    'Создан': u.created_at ? new Date(u.created_at).toLocaleString('ru-RU') : '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 5 }, { wch: 18 }, { wch: 24 }, { wch: 14 }, { wch: 16 }, { wch: 28 }, { wch: 16 }, { wch: 18 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Пользователи');
  XLSX.writeFile(wb, 'polzovateli.xlsx');
}

// Скачать шаблон для заполнения (Логин/Имя/Роль/Пароль/Склады/Магазин/Машина/Транспорт).
async function downloadTemplate() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const XLSX: any = await loadXLSX();
  const ws = XLSX.utils.json_to_sheet([
    { 'Логин': 'ivan', 'Имя': 'Иван', 'Роль': 'Кладовщик', 'Пароль': '1234', 'Склады': '001,002', 'Магазин': '', 'Машина': '', 'Транспорт': '' },
    { 'Логин': 'magazin1', 'Имя': 'Продавец', 'Роль': 'Магазин', 'Пароль': '1234', 'Склады': '', 'Магазин': '7704 Склад Arzonchi (Andijon)', 'Машина': '', 'Транспорт': '' },
    { 'Логин': 'manager1', 'Имя': 'Менеджер', 'Роль': 'Менеджер', 'Пароль': '1234', 'Склады': '', 'Магазин': '', 'Машина': '', 'Транспорт': '' },
    { 'Логин': '40100uaa', 'Имя': 'Зулфиқоров Шарифжон', 'Роль': 'Водитель', 'Пароль': '1234', 'Склады': '', 'Магазин': '', 'Машина': '40 100 UAA', 'Транспорт': 'Chevrolet COBALT' },
  ]);
  ws['!cols'] = [{ wch: 18 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 28 }, { wch: 16 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Шаблон');
  XLSX.writeFile(wb, 'shablon_polzovateli.xlsx');
}

// Гибкий разбор колонок (любой регистр/синонимы).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick(row: Record<string, any>, keys: string[]): string {
  for (const k of Object.keys(row)) {
    if (keys.includes(k.trim().toLowerCase())) return String(row[k] ?? '');
  }
  return '';
}

function parseRole(v: string): Role {
  const s = v.trim().toLowerCase();
  if (s.startsWith('адм') || s === 'admin') return 'admin';
  if (s.startsWith('менедж') || s === 'manager') return 'manager';
  if (s.startsWith('водит') || s === 'driver') return 'driver';
  return 'worker';
}

export default function UsersPage() {
  return (
    <AdminGate min="admin">
      <UsersContent />
    </AdminGate>
  );
}

// ─── Раскрывающийся выбор складов ──────────────────────────────────────────────
function WarehousePicker({
  all, selected, onChange,
}: {
  all: WarehouseSummary[];
  selected: string[];
  onChange: (codes: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((w) => w.warehouse_name.toLowerCase().includes(needle)) : all;
  }, [all, q]);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id]);
  }

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm
                   bg-white hover:border-blue-300 transition-colors">
        <span className="text-gray-700">
          🏬 Склады: <b>{selected.length ? `выбрано ${selected.length}` : 'все'}</b>
        </span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-2 border-gray-100 rounded-lg p-2 mt-1 bg-gray-50/50">
          <div className="flex items-center gap-2 mb-2">
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск склада…"
              className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-blue-400 bg-white" />
            {selected.length > 0 && (
              <button type="button" onClick={() => onChange([])}
                className="text-xs px-2 py-1.5 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-600 whitespace-nowrap">
                Очистить
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-52 overflow-y-auto">
            {filtered.map((w) => {
              const on = selected.includes(w.warehouse_id);
              return (
                <button type="button" key={w.warehouse_id} onClick={() => toggle(w.warehouse_id)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    on ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                  }`}>
                  {w.warehouse_name}
                </button>
              );
            })}
            {filtered.length === 0 && <span className="text-xs text-gray-400 px-1">Ничего не найдено</span>}
          </div>
          <div className="text-[11px] text-gray-400 mt-1.5">Пусто = доступны все склады</div>
        </div>
      )}
    </div>
  );
}

function UsersContent() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('worker');
  const [password, setPassword] = useState('');
  const [carNumber, setCarNumber] = useState('');
  const [transport, setTransport] = useState('');
  const [capM3, setCapM3] = useState('');
  const [capKg, setCapKg] = useState('');
  const [direction, setDirection] = useState('');
  const [selectedWh, setSelectedWh] = useState<string[]>([]);
  const [whList, setWhList] = useState<WarehouseSummary[]>([]);
  const whName = useCallback((id: string) => whList.find((w) => w.warehouse_id === id)?.warehouse_name || id, [whList]);
  const [shopList, setShopList] = useState<Shop[]>([]);
  const [shopId, setShopId] = useState('');
  const [homeWh, setHomeWh] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [editUser, setEditUser] = useState<UserInfo | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await listUsers());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { listAllWarehouses().then(setWhList).catch(() => {}); }, []);
  useEffect(() => { listShops().then(setShopList).catch(() => {}); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createUser({
        username: username.trim(), name: name.trim(), role, password,
        warehouses: selectedWh,
        car_number: role === 'driver' ? carNumber.trim() : undefined,
        transport: role === 'driver' ? transport.trim() : undefined,
        capacity_m3: role === 'driver' ? Number(capM3) || 0 : undefined,
        capacity_kg: role === 'driver' ? Number(capKg) || 0 : undefined,
        direction: role === 'driver' ? direction.trim() : undefined,
        shop_id: role === 'worker' ? shopId : undefined,
        home_warehouse: role === 'worker' ? homeWh : undefined,
      });
      setUsername(''); setName(''); setPassword(''); setRole('worker'); setSelectedWh([]);
      setCarNumber(''); setTransport(''); setCapM3(''); setCapKg(''); setDirection(''); setShopId(''); setHomeWh('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const [importMsg, setImportMsg] = useState('');

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setImportMsg('Загрузка…');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const XLSX: any = await loadXLSX();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
      // Сопоставление магазина из Excel (по названию или id) с точкой из справочника.
      const matchShopId = (raw: string): string => {
        const q = raw.trim().toLowerCase();
        if (!q) return '';
        const byId = shopList.find((s) => s.id.toLowerCase() === q);
        if (byId) return byId.id;
        const byName = shopList.find((s) => s.name.toLowerCase() === q)
          || shopList.find((s) => s.name.toLowerCase().includes(q) || q.includes(s.name.toLowerCase()));
        return byName?.id || '';
      };
      // Коды складов из Excel («001,002» или номер из названия типа «5502») →
      // настоящий warehouse_id (см. lib/warehouse.ts — код в названии часто не совпадает
      // с реальным кодом Smartup у складов точек/магазинов).
      const matchWhId = (raw: string): string => {
        const byId = whList.find((w) => w.warehouse_id === raw);
        if (byId) return byId.warehouse_id;
        const byName = whList.find((w) => w.warehouse_name === raw);
        if (byName) return byName.warehouse_id;
        const byCode = whList.find((w) => whCode(w.warehouse_name) === raw);
        return byCode?.warehouse_id || raw;
      };
      // Текущие логины — для решения создать/обновить.
      const existing = new Set(users.map((u) => u.username.toLowerCase()));
      let created = 0, updated = 0;
      const errs: string[] = [];
      for (const r of rows) {
        const username = pick(r, ['логин', 'login', 'username']).trim();
        const password = pick(r, ['пароль', 'password']).trim();
        if (!username && !password) continue;
        const name = pick(r, ['имя', 'name', 'фио', "ma'sul xodim", 'masul xodim']).trim();
        const role = parseRole(pick(r, ['роль', 'role']));
        const warehouses = parseWarehouses(pick(r, ['склады', 'склад', 'warehouses', 'warehouse'])).map(matchWhId);
        const car_number = pick(r, ['машина', 'номер машины', 'гос номер', 'госномер', 'номер', 'davlat raqami', 'car', 'car_number']).trim();
        const transport = pick(r, ['транспорт', 'transport', 'rusumi', 'тип транспорта', 'модель']).trim();
        const shop_id = matchShopId(pick(r, ['магазин', 'магазин (для заказы клиентам)', 'shop', 'do\'kon', 'dokon', 'магазин название']));
        try {
          if (existing.has(username.toLowerCase())) {
            // Обновляем существующего: имя, склады, машина, транспорт, магазин и пароль (если задан).
            await updateUser(username, {
              name: name || undefined,
              warehouses,
              car_number, transport,
              shop_id,
              ...(password ? { password } : {}),
            });
            updated++;
          } else {
            await createUser({ username, name, role, password, warehouses, car_number, transport, shop_id });
            created++;
          }
        } catch (err) {
          errs.push(`${username || '—'}: ${(err as Error).message}`);
        }
      }
      await load();
      setImportMsg(`Создано: ${created} · Обновлено: ${updated}${errs.length ? ` · Ошибок: ${errs.length}` : ''}`);
      if (errs.length) setError(errs.slice(0, 10).join('; '));
    } catch (err) {
      setImportMsg('');
      setError((err as Error).message);
    }
  }

  // Фильтр по поиску (логин/имя), затем пагинация.
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((u) =>
      u.username.toLowerCase().includes(needle) || u.name.toLowerCase().includes(needle)
    );
  }, [users, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const shownUsers = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-xl font-bold">👤 Пользователи <span className="text-sm text-gray-400 font-normal">({users.length})</span></h2>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg cursor-pointer">
            📤 Загрузить из Excel
            <input type="file" accept=".xlsx,.xls" onChange={onImportFile} className="hidden" />
          </label>
          <button onClick={() => downloadTemplate().catch(e => setError((e as Error).message))}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg">
            Шаблон
          </button>
          {users.length > 0 && (
            <button onClick={() => exportUsersExcel(users, shopList, whList).catch(e => setError((e as Error).message))}
              className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg">
              📥 Выгрузить
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400 mb-3">
        Колонки в Excel: <b>Логин</b>, <b>Имя</b>, <b>Роль</b> (Магазин/Водитель/Менеджер/Админ), <b>Пароль</b>, <b>Склады</b> (коды через запятую, напр. 001,002), <b>Магазин</b> (название точки — для роли «Магазин»), для водителей — <b>Машина</b> и <b>Транспорт</b>. Существующие логины <b>обновляются</b> (пароль меняется только если указан). Нажми «Шаблон» для примера.
      </p>
      {importMsg && <p className="text-sm text-blue-600 mb-3">{importMsg}</p>}

      {/* Добавление */}
      <form onSubmit={add} className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-col gap-2">
        <div className="font-semibold text-sm mb-1">Добавить пользователя</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={username} onChange={(e) => setUsername(e.target.value)}
            placeholder="Логин (латиница)" autoCapitalize="none" autoComplete="off"
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Имя" autoComplete="off"
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400">
            <option value="worker">Магазин</option>
            <option value="driver">Водитель</option>
            <option value="manager">Менеджер</option>
            <option value="admin">Админ</option>
          </select>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль" autoComplete="new-password"
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>

        {/* Данные водителя */}
        {role === 'driver' && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={carNumber} onChange={(e) => setCarNumber(e.target.value)}
                placeholder="Номер машины (напр. 01A123BC)"
                className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
              <input value={transport} onChange={(e) => setTransport(e.target.value)}
                placeholder="Транспорт (Газель, Спринтер…)"
                className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input type="number" min={0} step="0.1" value={capM3} onChange={(e) => setCapM3(e.target.value)}
                placeholder="Объём, м³"
                className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
              <input type="number" min={0} value={capKg} onChange={(e) => setCapKg(e.target.value)}
                placeholder="Вес, кг"
                className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
              <input value={direction} onChange={(e) => setDirection(e.target.value)}
                placeholder="Город (напр. Фергана)"
                title="Город, который обслуживает водитель — для автораспределения"
                className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </div>
          </div>
        )}

        {/* Привязка к магазину (для раздела «Заказы клиентам») */}
        {role === 'worker' && (
          <div>
            <label className="text-xs text-gray-500 mb-1 block">🏪 Магазин (для «Заказы клиентам»)</label>
            <select value={shopId} onChange={(e) => setShopId(e.target.value)}
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400">
              <option value="">— не привязан —</option>
              {shopList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {shopList.length === 0 && <p className="text-xs text-amber-500 mt-1">Сначала добавьте точки в разделе Логистика → Точки доставки</p>}
          </div>
        )}

        {/* Свой склад — используется по умолчанию в «Печать ценников» и др. */}
        {role === 'worker' && (
          <div>
            <label className="text-xs text-gray-500 mb-1 block">🏬 Свой склад (по умолчанию в ценниках)</label>
            <select value={homeWh} onChange={(e) => setHomeWh(e.target.value)}
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400">
              <option value="">— не выбран —</option>
              {whList.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_name}</option>)}
            </select>
          </div>
        )}

        {/* Прикреплённые склады */}
        {role !== 'driver' && whList.length > 0 && (
          <WarehousePicker all={whList} selected={selectedWh} onChange={setSelectedWh} />
        )}

        <button type="submit" disabled={busy}
          className="self-start mt-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg">
          {busy ? '⏳…' : 'Добавить'}
        </button>
      </form>

      {/* Поиск */}
      <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        placeholder="🔍 Поиск по логину или имени…" autoComplete="off"
        className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm mb-3 outline-none focus:border-blue-400" />

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {/* Список */}
      {loading ? (
        <div className="text-gray-500 text-sm">Загрузка…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">
          {search ? 'Никого не найдено' : 'Пользователей пока нет'}
        </div>
      ) : (
        <>
        <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
        <div className="flex flex-col gap-2">
          {shownUsers.map((u) => (
            <div key={u.username} className="bg-white rounded-lg shadow-sm px-3 py-2.5 flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{u.name} <span className="text-gray-400">@{u.username}</span></div>
                <div className="text-xs text-gray-400">
                  {ROLE_LABEL[u.role]}
                  {u.role === 'driver' ? (
                    (u.car_number || u.transport) && (
                      <span className="text-teal-600">
                        {' · 🚗 '}{[u.car_number, u.transport].filter(Boolean).join(' · ')}
                      </span>
                    )
                  ) : (
                    <>
                      {' · '}
                      <span className="text-teal-600">
                        {u.warehouses.length ? `Склады: ${u.warehouses.map(whName).join(', ')}` : 'Склады: все'}
                      </span>
                      {u.role === 'worker' && u.home_warehouse && (
                        <span className="text-violet-600">{' · 🏬 свой: '}{whName(u.home_warehouse)}</span>
                      )}
                    </>
                  )}
                </div>
              </div>
              <button onClick={() => setEditUser(u)}
                className="text-blue-600 hover:text-blue-800 text-sm font-medium px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors">
                Изменить
              </button>
            </div>
          ))}
        </div>
        <Pager page={safePage} totalPages={totalPages} onChange={setPage} />
        </>
      )}

      {editUser && (
        <EditUserModal
          user={editUser}
          allWh={whList}
          allShops={shopList}
          onClose={() => setEditUser(null)}
          onSaved={() => { setEditUser(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── Модалка редактирования пользователя ───────────────────────────────────────
function EditUserModal({
  user, allWh, allShops, onClose, onSaved,
}: {
  user: UserInfo;
  allWh: WarehouseSummary[];
  allShops: Shop[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isDriver = user.role === 'driver';
  const isWorker = user.role === 'worker';
  const [editName, setEditName] = useState(user.name);
  const [password, setPassword] = useState('');
  const [wh, setWh] = useState<string[]>(user.warehouses);
  const [shopId, setShopId] = useState(user.shop_id || '');
  const [homeWh, setHomeWh] = useState(user.home_warehouse || '');
  const [car, setCar] = useState(user.car_number);
  const [transport, setTransport] = useState(user.transport);
  const [capM3, setCapM3] = useState(String(user.capacity_m3 || ''));
  const [capKg, setCapKg] = useState(String(user.capacity_kg || ''));
  const [direction, setDirection] = useState(user.direction || '');
  const [gpsUserId, setGpsUserId] = useState(user.gps_user_id || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [kmStats, setKmStats] = useState<{ total_km: number; delivery_count: number } | null>(null);

  useEffect(() => {
    if (!isDriver) return;
    fetch(`/api/users/${encodeURIComponent(user.username)}`).then((r) => r.json()).then((d) => {
      if (d.total_km !== undefined) setKmStats(d);
    }).catch(() => {});
  }, [isDriver, user.username]);

  async function save() {
    setBusy(true);
    setErr('');
    try {
      const patch: { name?: string; password?: string; warehouses?: string[]; car_number?: string; transport?: string; capacity_m3?: number; capacity_kg?: number; direction?: string; shop_id?: string; home_warehouse?: string; gps_user_id?: string } = {};
      if (editName.trim() && editName.trim() !== user.name) patch.name = editName.trim();
      if (password.trim()) patch.password = password.trim();
      if (isDriver) {
        patch.car_number = car.trim();
        patch.transport = transport.trim();
        patch.capacity_m3 = Number(capM3) || 0;
        patch.capacity_kg = Number(capKg) || 0;
        patch.direction = direction.trim();
        patch.gps_user_id = gpsUserId.trim();
      } else {
        patch.warehouses = wh;
        if (isWorker) { patch.shop_id = shopId; patch.home_warehouse = homeWh; }
      }
      await updateUser(user.username, patch);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  async function del() {
    setBusy(true);
    setErr('');
    try {
      await deleteUserApi(user.username);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="font-bold text-lg">{user.name}</div>
            <div className="text-xs text-gray-400">@{user.username} · {ROLE_LABEL[user.role]}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="flex flex-col gap-3">
          {/* Имя */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Имя</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)}
              placeholder="Полное имя"
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          </div>

          {/* Пароль */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Новый пароль (оставьте пустым — без изменений)</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Минимум 4 символа" autoComplete="new-password"
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          </div>

          {/* Профиль водителя / склады */}
          {isDriver ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Номер машины</label>
                <input value={car} onChange={(e) => setCar(e.target.value)}
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Транспорт</label>
                <input value={transport} onChange={(e) => setTransport(e.target.value)}
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Объём, м³</label>
                <input type="number" min={0} step="0.1" value={capM3} onChange={(e) => setCapM3(e.target.value)}
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Вес, кг</label>
                <input type="number" min={0} value={capKg} onChange={(e) => setCapKg(e.target.value)}
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">Город (обслуживаемый)</label>
                <input value={direction} onChange={(e) => setDirection(e.target.value)}
                  placeholder="напр. Фергана, Маргилан"
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">GPS ID (gps16888.com user_id)</label>
                <input value={gpsUserId} onChange={(e) => setGpsUserId(e.target.value)}
                  placeholder="UUID из платформы GPS"
                  className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-blue-400" />
              </div>
              {kmStats !== null && (
                <div className="sm:col-span-2 bg-blue-50 rounded-xl px-4 py-3 flex items-center gap-4">
                  <div className="text-center">
                    <div className="text-xl font-bold text-blue-700">{kmStats.total_km} км</div>
                    <div className="text-[10px] text-blue-400">пробег (доставлено)</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-blue-700">{kmStats.delivery_count}</div>
                    <div className="text-[10px] text-blue-400">доставок</div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {isWorker && (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">🏪 Магазин (для «Заказы клиентам»)</label>
                  <select value={shopId} onChange={(e) => setShopId(e.target.value)}
                    className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400">
                    <option value="">— не привязан —</option>
                    {allShops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  {allShops.length === 0 && <p className="text-xs text-amber-500 mt-1">Нет точек — добавьте в Логистика → Точки доставки</p>}
                </div>
              )}
              {isWorker && (
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">🏬 Свой склад (по умолчанию в ценниках)</label>
                  <select value={homeWh} onChange={(e) => setHomeWh(e.target.value)}
                    className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400">
                    <option value="">— не выбран —</option>
                    {allWh.map((w) => <option key={w.warehouse_id} value={w.warehouse_id}>{w.warehouse_name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Склады</label>
                <WarehousePicker all={allWh} selected={wh} onChange={setWh} />
              </div>
            </div>
          )}

          {err && <p className="text-red-500 text-sm">{err}</p>}

          <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
            <button onClick={save} disabled={busy}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg">
              {busy ? '⏳…' : 'Сохранить'}
            </button>
            <button onClick={onClose} disabled={busy}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg">
              Отмена
            </button>

            {confirmDel ? (
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-xs text-gray-500">Удалить?</span>
                <button onClick={del} disabled={busy}
                  className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-lg">
                  Да
                </button>
                <button onClick={() => setConfirmDel(false)} disabled={busy}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm rounded-lg">
                  Нет
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmDel(true)} disabled={busy}
                className="ml-auto px-3 py-2 text-red-500 hover:text-red-700 text-sm font-medium">
                🗑️ Удалить
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
