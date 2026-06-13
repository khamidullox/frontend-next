'use client';

// Простая пагинация «← Назад · Стр. X из N · Вперёд →» с прокруткой вверх.
export default function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  const go = (p: number) => {
    onChange(Math.min(totalPages, Math.max(1, p)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return (
    <div className="flex items-center justify-center gap-3 my-3">
      <button
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ← Назад
      </button>
      <span className="text-sm text-gray-500">Стр. {page} из {totalPages}</span>
      <button
        onClick={() => go(page + 1)}
        disabled={page >= totalPages}
        className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Вперёд →
      </button>
    </div>
  );
}
