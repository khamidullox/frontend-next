'use client';

import { useState } from 'react';

interface Props {
  code: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE: Record<string, string> = {
  sm: 'w-12 h-12',
  md: 'w-28 h-28',
  lg: 'w-48 h-48',
};

export default function ProductPhoto({ code, size = 'md', className = '' }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={`${SIZE[size]} ${className} flex items-center justify-center bg-gray-100 rounded-xl text-3xl shrink-0`}>
        📷
      </div>
    );
  }

  return (
    <div className={`${SIZE[size]} ${className} bg-gray-100 rounded-xl overflow-hidden flex items-center justify-center shrink-0`}>
      <img
        src={`/api/products/${encodeURIComponent(code)}/photo`}
        alt=""
        loading="lazy"
        className="w-full h-full object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  );
}
