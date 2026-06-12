'use client';

import { usePathname } from 'next/navigation';
import Nav from './Nav';

// На странице проверки (сканирование) шапку прячем — чтобы освободить
// место под список и закреплённый сканер.
export default function AppHeader() {
  const pathname = usePathname();
  if (pathname.startsWith('/session')) return null;

  return (
    <header className="bg-slate-900 text-white shadow-lg print:hidden">
      <div className="max-w-3xl mx-auto px-6 pt-4 flex items-center gap-3">
        <span className="text-2xl">📦</span>
        <h1 className="text-lg font-semibold tracking-wide">Проверка накладной</h1>
      </div>
      <Nav />
    </header>
  );
}
