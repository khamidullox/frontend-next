'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, setupAdmin } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import DeviceCheck from '@/components/DeviceCheck';

export default function LoginPage() {
  const { setupNeeded, refresh } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (setupNeeded) {
        await setupAdmin(username.trim(), name.trim(), password);
      } else {
        await login(username.trim(), password);
      }
      await refresh();
      router.replace('/');
    } catch (err) {
      // Сетевой сбой (fetch не дошёл) — это не «неверный пароль», а проблема связи/
      // настроек телефона. Показываем понятную подсказку вместо технической ошибки.
      if (err instanceof TypeError) {
        setError('Нет связи с сервером. Проверьте интернет и что на телефоне правильно выставлены дата и время (Настройки → Дата и время → «Автоматически»).');
      } else {
        setError((err as Error).message);
      }
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="w-12 h-12 rounded-lg mx-auto mb-2" />
          <h1 className="text-xl font-bold">TaminotWeb</h1>
          <p className="text-sm text-gray-500 mt-1">
            {setupNeeded ? 'Создайте первого администратора' : 'Вход в систему'}
          </p>
        </div>

        <DeviceCheck />

        <form onSubmit={submit} className="flex flex-col gap-3">
          {setupNeeded && (
            <input
              type="text"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Имя (как показывать)"
              autoComplete="name"
              className="border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-400"
            />
          )}
          <input
            type="text"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Логин"
            autoFocus
            autoCapitalize="none"
            autoComplete="username"
            className="border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-400"
          />
          <input
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            autoComplete={setupNeeded ? 'new-password' : 'current-password'}
            className="border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-400"
          />

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white font-semibold rounded-xl transition-colors"
          >
            {busy ? '⏳…' : setupNeeded ? 'Создать админа' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
