'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAdminUnlocked } from '@/lib/admin';

// Оборачивает страницы, скрытые в киоск-режиме. Если не разблокировано —
// перенаправляет на главную (сканер).
export default function AdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (isAdminUnlocked()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOk(true);
    } else {
      router.replace('/');
    }
  }, [router]);

  if (!ok) return null;
  return <>{children}</>;
}
