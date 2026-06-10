'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createSession, NotFoundError } from '@/lib/api';

export default function HomePage() {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = value.trim();
    if (!num) { setError('Введите номер накладной'); return; }

    setError('');
    setLoading(true);

    try {
      // Форматированный номер с ведущим нулём (0000020042) — ищем по movement_number.
      // Иначе это ID накладной (3951537 — печатается вверху бланка) — быстрый путь.
      const filters: Record<string, string> = /^0\d+$/.test(num)
        ? { movement_number: num }
        : { movement_id: num };

      const session = await createSession(filters);
      router.push(`/session/${session.id}`);
    } catch (err) {
      if (err instanceof NotFoundError) {
        setError(`Накладная "${num}" не найдена в Smartup`);
      } else if (err instanceof TypeError) {
        setError('Не удалось подключиться к серверу. Проверьте что бэкенд запущен.');
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
        {/* Icon */}
        <div className="text-6xl mb-4">🗂️</div>
        <h2 className="text-2xl font-bold mb-2">Введите ID накладной</h2>
        <p className="text-gray-500 text-sm mb-8">
          ID указан вверху бланка. Получим товары из Smartup и начнём проверку
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
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
