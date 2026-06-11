'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createSession, NotFoundError } from '@/lib/api';

export default function HomePage() {
  const [value, setValue] = useState('');
  const [checker, setChecker] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // Имя проверяющего запоминаем между сессиями (localStorage доступен только на клиенте).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChecker(localStorage.getItem('checker_name') || '');
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = value.trim();
    if (!num) { setError('Введите номер накладной'); return; }

    setError('');
    setLoading(true);
    localStorage.setItem('checker_name', checker.trim());

    try {
      // Единый ввод: сервер сам определит — накладная это или заказ.
      const session = await createSession({ query: num, checker_name: checker.trim() });
      router.push(`/session/${session.id}`);
    } catch (err) {
      if (err instanceof NotFoundError) {
        setError(`Документ "${num}" не найден в Smartup`);
      } else if (err instanceof TypeError) {
        setError('Не удалось подключиться к серверу.');
      } else {
        setError((err as Error).message || 'Неизвестная ошибка');
      }
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-md text-center">
        <div className="text-6xl mb-4">🗂️</div>
        <h2 className="text-2xl font-bold mb-2">Введите ID документа</h2>
        <p className="text-gray-500 text-sm mb-8">
          Накладная, заказ или номер ТТН — определим автоматически
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            value={checker}
            onChange={e => setChecker(e.target.value)}
            placeholder="Кто проверяет (необязательно)"
            disabled={loading}
            className="border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm
                       outline-none focus:border-blue-400 transition-colors
                       disabled:bg-gray-50 disabled:text-gray-400"
          />

          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={e => { setValue(e.target.value); setError(''); }}
              placeholder="Например: 3951537"
              autoFocus
              disabled={loading}
              className="flex-1 border-2 border-gray-200 rounded-xl px-4 py-3 text-lg font-semibold
                         tracking-wider outline-none focus:border-blue-400 transition-colors
                         disabled:bg-gray-50 disabled:text-gray-400"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300
                         text-white font-semibold rounded-xl transition-colors flex items-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Загрузка...
                </>
              ) : (
                'Открыть'
              )}
            </button>
          </div>

          {error && (
            <p className="text-red-500 text-sm text-left">{error}</p>
          )}
        </form>
      </div>
    </div>
  );
}
