'use client';

import { useRouter } from 'next/navigation';
import { listSessions, SessionListItem } from '@/lib/api';
import AdminGate from '@/components/AdminGate';
import { useCachedList } from '@/lib/useCachedList';

function fmt(iso?: string | null) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function resultBadge(s: SessionListItem) {
  const { summary, status } = s;
  if (status === 'active') {
    return <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-100 text-blue-700">В работе</span>;
  }
  if (summary.done_items === summary.total_items && summary.total_items > 0) {
    return <span className="text-xs font-semibold px-2 py-1 rounded-full bg-green-100 text-green-700">✅ Всё собрано</span>;
  }
  return <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-700">⚠️ Расхождения</span>;
}

export default function HistoryPage() {
  return (
    <AdminGate>
      <HistoryContent />
    </AdminGate>
  );
}

function HistoryContent() {
  const { data: sessions, loading, error } = useCachedList(
    'cache:history',
    listSessions,
    30_000 // история обновляется чаще — окно «свежести» меньше
  );
  const router = useRouter();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] gap-3 text-gray-500">
        <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        Загрузка истории...
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-bold">История проверок</h2>
        <span className="text-sm text-gray-400">{sessions.length} шт.</span>
      </div>

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {sessions.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">
          Проверок пока нет
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {sessions.map(s => (
            <button
              key={s.id}
              onClick={() => router.push(`/session/${s.id}`)}
              className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-4 text-left
                         hover:shadow-md hover:ring-2 hover:ring-blue-200 transition-all"
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base flex items-center gap-2">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    s.doc_type === 'order' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {s.doc_type === 'order' ? 'Заказ' : 'Накладная'}
                  </span>
                  № {s.doc_number || s.doc_id}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {fmt(s.finished_at || s.created_at)}
                  {s.checker_name && ` · 👤 ${s.checker_name}`}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Собрано {s.summary.done_items} из {s.summary.total_items} позиций
                </div>
              </div>
              {resultBadge(s)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
