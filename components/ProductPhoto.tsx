'use client';

import { useState, useEffect } from 'react';

interface Props {
  code: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  zoomable?: boolean;
}

const SIZE: Record<string, string> = {
  sm: 'w-12 h-12',
  md: 'w-28 h-28',
  lg: 'w-80 h-80',
};

export default function ProductPhoto({ code, size = 'md', className = '', zoomable = false }: Props) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const src = `/api/products/${encodeURIComponent(code)}/photo?v=3`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (failed) {
    return (
      <div className={`${SIZE[size]} ${className} flex items-center justify-center bg-gray-100 rounded-xl text-3xl shrink-0`}>
        📷
      </div>
    );
  }

  return (
    <>
      <div
        className={`${SIZE[size]} ${className} bg-gray-100 rounded-xl overflow-hidden flex items-center justify-center shrink-0 ${zoomable ? 'cursor-zoom-in' : ''}`}
        onClick={() => zoomable && !failed && setOpen(true)}
      >
        <img
          src={src}
          alt=""
          loading="lazy"
          className="w-full h-full object-contain"
          onError={() => setFailed(true)}
        />
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setOpen(false)}
        >
          <div className="relative max-w-2xl w-full" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setOpen(false)}
              className="absolute -top-10 right-0 text-white text-2xl leading-none hover:text-gray-300"
            >
              ✕
            </button>
            <img
              src={src}
              alt=""
              className="w-full max-h-[80vh] object-contain rounded-xl bg-white"
            />
          </div>
        </div>
      )}
    </>
  );
}
