'use client';

import { useEffect, useState, useCallback } from 'react';
import { listUsers, createUser, deleteUserApi, setUserPassword, UserInfo, Role, ROLE_LABEL } from '@/lib/api';
import AdminGate from '@/components/AdminGate';
import { loadXLSX } from '@/lib/xlsx';

async function exportUsersExcel(users: UserInfo[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const XLSX: any = await loadXLSX();
  const rows = users.map((u, i) => ({
    '№': i + 1,
    'Логин': u.username,
    'Имя': u.name,
    'Роль': ROLE_LABEL[u.role],
    'Создан': u.created_at ? new Date(u.created_at).toLocaleString('ru-RU') : '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 5 }, { wch: 18 }, { wch: 24 }, { wch: 14 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Пользователи');
  XLSX.writeFile(wb, 'polzovateli.xlsx');
}

// Скачать шаблон для заполнения (Логин/Имя/Роль/Пароль).
async function downloadTemplate() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const XLSX: any = await loadXLSX();
  const ws = XLSX.utils.json_to_sheet([
    { 'Логин': 'ivan', 'Имя': 'Иван', 'Роль': 'Кладовщик', 'Пароль': '1234' },
    { 'Логин': 'manager1', 'Имя': 'Менеджер', 'Роль': 'Менеджер', 'Пароль': '1234' },
  ]);
  ws['!cols'] = [{ wch: 18 }, { wch: 24 }, { wch: 14 }, { wch: 14 }];
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
  return 'worker';
}

export default function UsersPage() {
  return (
    <AdminGate min="admin">
      <UsersContent />
    </AdminGate>
  );
}

function UsersContent() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('worker');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

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

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createUser({ username: username.trim(), name: name.trim(), role, password });
      setUsername(''); setName(''); setPassword(''); setRole('worker');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(u: string) {
    if (!confirm(`Удалить пользователя ${u}?`)) return;
    setError('');
    try {
      await deleteUserApi(u);
      await load();
    } catch (err) {
      setError((err as Error).message);
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
      let ok = 0;
      const errs: string[] = [];
      for (const r of rows) {
        const username = pick(r, ['логин', 'login', 'username']).trim();
        const password = pick(r, ['пароль', 'password']).trim();
        if (!username && !password) continue;
        const name = pick(r, ['имя', 'name', 'фио']).trim();
        const role = parseRole(pick(r, ['роль', 'role']));
        try {
          await createUser({ username, name, role, password });
          ok++;
        } catch (err) {
          errs.push(`${username || '—'}: ${(err as Error).message}`);
        }
      }
      await load();
      setImportMsg(`Создано: ${ok}${errs.length ? ` · Пропущено/ошибок: ${errs.length}` : ''}`);
      if (errs.length) setError(errs.slice(0, 10).join('; '));
    } catch (err) {
      setImportMsg('');
      setError((err as Error).message);
    }
  }

  async function changePass(u: string) {
    const pass = prompt(`Новый пароль для ${u} (минимум 4 символа):`);
    if (!pass) return;
    setError('');
    try {
      await setUserPassword(u, pass);
      alert('Пароль изменён');
    } catch (err) {
      setError((err as Error).message);
    }
  }

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
            <button onClick={() => exportUsersExcel(users).catch(e => setError((e as Error).message))}
              className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg">
              📥 Выгрузить
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-400 mb-3">
        Колонки в Excel: <b>Логин</b>, <b>Имя</b>, <b>Роль</b> (Кладовщик/Менеджер/Админ), <b>Пароль</b>. Нажми «Шаблон» для примера.
      </p>
      {importMsg && <p className="text-sm text-blue-600 mb-3">{importMsg}</p>}

      {/* Добавление */}
      <form onSubmit={add} className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-col gap-2">
        <div className="font-semibold text-sm mb-1">Добавить пользователя</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={username} onChange={(e) => setUsername(e.target.value)}
            placeholder="Логин (латиница)" autoCapitalize="none"
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Имя"
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400">
            <option value="worker">Кладовщик</option>
            <option value="manager">Менеджер</option>
            <option value="admin">Админ</option>
          </select>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>
        <button type="submit" disabled={busy}
          className="self-start mt-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg">
          {busy ? '⏳…' : 'Добавить'}
        </button>
      </form>

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {/* Список */}
      {loading ? (
        <div className="text-gray-500 text-sm">Загрузка…</div>
      ) : (
        <div className="flex flex-col gap-2">
          {users.map((u) => (
            <div key={u.username} className="bg-white rounded-lg shadow-sm px-3 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{u.name} <span className="text-gray-400">@{u.username}</span></div>
                <div className="text-xs text-gray-400">{ROLE_LABEL[u.role]}</div>
              </div>
              <button onClick={() => changePass(u.username)}
                className="text-blue-500 hover:text-blue-700 text-sm px-2 py-1">Сменить пароль</button>
              <button onClick={() => remove(u.username)}
                className="text-red-400 hover:text-red-600 text-sm px-2 py-1">Удалить</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
