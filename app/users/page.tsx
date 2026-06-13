'use client';

import { useEffect, useState, useCallback } from 'react';
import { listUsers, createUser, deleteUserApi, UserInfo, Role, ROLE_LABEL } from '@/lib/api';
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

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h2 className="text-xl font-bold">👤 Пользователи <span className="text-sm text-gray-400 font-normal">({users.length})</span></h2>
        {users.length > 0 && (
          <button
            onClick={() => exportUsersExcel(users).catch(e => setError((e as Error).message))}
            className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg"
          >
            📥 Excel
          </button>
        )}
      </div>

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
              <button onClick={() => remove(u.username)}
                className="text-red-400 hover:text-red-600 text-sm px-2 py-1">Удалить</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
