'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ADMIN_PASSWORD, setAdminUnlocked } from '@/lib/admin';

export default function UnlockPage() {
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pass === ADMIN_PASSWORD) {
      setAdminUnlocked(true);
      router.push('/movements');
    } else {
      setError('Неверный пароль');
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-sm text-center">
        <div className="text-5xl mb-4">🔐</div>
        <h2 className="text-xl font-bold mb-2">Доступ к разделам</h2>
        <p className="text-gray-500 text-sm mb-6">
          Введите пароль, чтобы открыть списки и историю
        </p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="password"
            value={pass}
            onChange={e => { setPass(e.target.value); setError(''); }}
            placeholder="Пароль"
            autoFocus
            className="border-2 border-gray-200 rounded-xl px-4 py-3 text-center text-lg
                       outline-none focus:border-blue-400 transition-colors"
          />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            className="py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
          >
            Открыть
          </button>
        </form>
      </div>
    </div>
  );
}
