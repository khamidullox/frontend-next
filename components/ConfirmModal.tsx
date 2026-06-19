'use client';

import { useEffect } from 'react';

interface Props {
  message: string;
  onOk: () => void;
  onCancel: () => void;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export default function ConfirmModal({
  message, onOk, onCancel,
  okLabel = 'Удалить', cancelLabel = 'Отмена', danger = true,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') onOk();
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOk, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm text-gray-700 mb-6 leading-relaxed">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onOk}
            className={`px-4 py-2 text-sm font-semibold rounded-lg text-white transition-colors ${
              danger ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'
            }`}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
