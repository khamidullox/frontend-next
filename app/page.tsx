'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createSession, NotFoundError, AlreadyCheckedError, SessionListItem, DOC_TYPE_LABEL } from '@/lib/api';

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export default function HomePage() {
  const [value, setValue] = useState('');
  const [checker, setChecker] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [alreadyChecked, setAlreadyChecked] = useState<SessionListItem | null>(null);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChecker(localStorage.getItem('checker_name') || '');
  }, []);

  async function doCreate(force = false) {
    const num = value.trim();
    if (!num) { setError('Введите номер накладной'); return; }

    setError('');
    setLoading(true);
    localStorage.setItem('checker_name', checker.trim());

    try {
      const session = await createSession({ query: num, checker_name: checker.trim(), ...(force ? { force: true } : {}) });
      router.push(`/session/${session.id}`);
    } catch (err) {
      if (err instanceof AlreadyCheckedError) {
        setAlreadyChecked(err.existing);
        setLoading(false);
      } else if (err instanceof NotFoundError) {
        setError(`Документ "${num}" не найден в Smartup`);
        setLoading(false);
        inputRef.current?.focus();
      } else if (err instanceof TypeError) {
        setError('Не удалось подключиться к серверу.');
        setLoading(false);
        inputRef.current?.focus();
      } else {
        setError((err as Error).message || 'Неизвестная ошибка');
        setLoading(false);
        inputRef.current?.focus();
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    doCreate(false);
  }

  // ── Экран «уже собрано» ──────────────────────────────────────────────────────
  if (alreadyChecked) {
    const ex = alreadyChecked;
    const docLabel = DOC_TYPE_LABEL[ex.doc_type] || 'Документ';
    const pct = ex.summary.total_items > 0
      ? Math.round((ex.summary.done_items / ex.summary.total_items) * 100)
      : 0;

    return (
      <div className="flex items-center justify-center min-h-[70vh] px-3">
        <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-8 w-full max-w-md text-center">
          <div className="text-5xl mb-3">✅</div>
          <h2 className="text-xl font-bold mb-1">Уже собрано</h2>
          <p className="text-gray-500 text-sm mb-5">
            {docLabel} <span className="font-semibold text-gray-700">#{ex.doc_number || ex.doc_id}</span> уже был проверен
          </p>

          <div className="bg-gray-50 rounded-xl px-4 py-3 text-left text-sm space-y-1.5 mb-6">
            {ex.checker_name && (
              <div className="flex justify-between">
                <span className="text-gray-500">Проверил</span>
                <span className="font-medium">{ex.checker_name}</span>
              </div>
            )}
            {ex.finished_at && (
              <div className="flex justify-between">
                <span className="text-gray-500">Дата</span>
                <span className="font-medium">{fmtDate(ex.finished_at)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500">Итог</span>
              <span className="font-medium">
                <span className="text-green-600">{ex.summary.done_items}</span>
                <span className="text-gray-400">/{ex.summary.total_items}</span>
                <span className="text-gray-400 ml-1">({pct}%)</span>
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => router.push(`/session/${ex.id}`)}
              className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors"
            >
              Посмотреть результат
            </button>
            <button
              onClick={() => { setAlreadyChecked(null); doCreate(true); }}
              disabled={loading}
              className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300
                         text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Загрузка...</>
              ) : '🔄 Собрать второй раз'}
            </button>
            <button
              onClick={() => { setAlreadyChecked(null); setValue(''); setTimeout(() => inputRef.current?.focus(), 50); }}
              className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold rounded-xl transition-colors"
            >
              ← Назад
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Стандартная форма ввода ───────────────────────────────────────────────────
  return (
    <div className="flex items-center justify-center min-h-[70vh] px-3">
      <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-10 w-full max-w-md text-center">
        <div className="text-6xl mb-4">🗂️</div>
        <h2 className="text-2xl font-bold mb-2">Введите ID документа</h2>
        <p className="text-gray-500 text-sm mb-8">
          Накладная, заказ, перемещение, возврат или ТТН — определим автоматически
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text"
            value={checker}
            onChange={e => setChecker(e.target.value)}
            placeholder="Кто проверяет (необязательно)"
            disabled={loading}
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 text-sm
                       outline-none focus:border-blue-400 transition-colors
                       disabled:bg-gray-50 disabled:text-gray-400"
          />

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={e => { setValue(e.target.value); setError(''); }}
              placeholder="Например: 3951537"
              autoFocus
              disabled={loading}
              className="flex-1 min-w-0 w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg font-semibold
                         tracking-wider outline-none focus:border-blue-400 transition-colors
                         disabled:bg-gray-50 disabled:text-gray-400"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300
                         text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 shrink-0"
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
