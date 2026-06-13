'use client';

import { usePathname, useRouter } from 'next/navigation';
import Nav from './Nav';
import { logout, ROLE_LABEL } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';

// На странице проверки (сканирование) и логина шапку прячем.
export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, refresh } = useAuth();

  if (pathname.startsWith('/session') || pathname === '/login') return null;

  async function doLogout() {
    await logout();
    await refresh();        // сбросить сессию в провайдере
    router.replace('/login');
  }

  return (
    <header className="bg-slate-900 text-white shadow-lg print:hidden">
      <div className="max-w-3xl mx-auto px-4 pt-3 pb-2 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="w-7 h-7 rounded-md" />
        <h1 className="text-lg font-semibold tracking-wide">TaminotWeb</h1>
        {session && (
          <div className="ml-auto flex items-center gap-2.5 min-w-0">
            <span className="text-xs text-gray-300 truncate hidden xs:block sm:block">
              {session.name}
              <span className="text-gray-500"> · {ROLE_LABEL[session.role]}</span>
            </span>
            <button
              onClick={doLogout}
              title="Выйти"
              className="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm text-gray-200 transition-colors"
            >
              Выйти
            </button>
          </div>
        )}
      </div>
      <Nav />
    </header>
  );
}
