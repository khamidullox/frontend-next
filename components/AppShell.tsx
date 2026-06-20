'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ROLE_RANK, ROLE_LABEL, Role, logout } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';

interface NavLink { href: string; label: string; min: Role }

const LINKS: NavLink[] = [
  { href: '/', label: '📦 Проверка', min: 'worker' },
  { href: '/products', label: '📚 Справочник', min: 'worker' },
  { href: '/warehouses', label: '🏬 Остатки', min: 'worker' },
  { href: '/price-tags', label: '🏷️ Ценники', min: 'worker' },
  { href: '/movements', label: '🗂️ Накладные', min: 'manager' },
  { href: '/orders', label: '🧾 Заказы', min: 'manager' },
  { href: '/history', label: '📋 История', min: 'manager' },
  { href: '/logistics', label: '🚚 Логистика', min: 'manager' },
  { href: '/transfers', label: '🔄 Перемещения', min: 'admin' },
  { href: '/receipts', label: '📥 Приёмка', min: 'admin' },
  { href: '/users', label: '👤 Пользователи', min: 'admin' },
];

// Водитель — особая роль: видит только свои доставки.
const DRIVER_LINKS: NavLink[] = [
  { href: '/logistics/my', label: '🚚 Мои доставки', min: 'driver' },
];

// Магазин (worker) — кроме общих пунктов, видит создание заявок на доставку клиентам.
const WORKER_EXTRA_LINKS: NavLink[] = [
  { href: '/logistics/shop', label: '🚚 Заказы клиентам', min: 'worker' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, refresh } = useAuth();
  const [open, setOpen] = useState(false);

  // Без «обвязки»: вход и страница проверки (полный экран).
  const bare = pathname === '/login' || pathname.startsWith('/session');
  if (bare) {
    return <main className="max-w-3xl mx-auto px-4 py-4">{children}</main>;
  }

  const rank = session ? ROLE_RANK[session.role] : 0;
  const links = session?.role === 'driver'
    ? DRIVER_LINKS
    : session?.role === 'worker'
    ? [...LINKS.filter((l) => rank >= ROLE_RANK[l.min]), ...WORKER_EXTRA_LINKS]
    : LINKS.filter((l) => rank >= ROLE_RANK[l.min]);

  function isActive(href: string) {
    if (href === '/') return pathname === '/' || pathname.startsWith('/session');
    return pathname.startsWith(href);
  }

  async function doLogout() {
    await logout();
    await refresh();
    router.replace('/login');
  }

  return (
    <div className="md:flex md:min-h-screen print:block print:min-h-0">
      {/* Верхняя полоса на телефоне */}
      <div className="md:hidden sticky top-0 z-30 bg-slate-900 text-white flex items-center gap-3 px-4 h-14 print:hidden">
        <button onClick={() => setOpen(true)} aria-label="Меню" className="text-2xl leading-none">☰</button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="w-6 h-6 rounded" />
        <span className="font-semibold tracking-wide">TaminotWeb</span>
      </div>

      {/* Затемнение под выезжающим меню (моб.) */}
      {open && <div className="md:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />}

      {/* Боковое меню */}
      <aside
        className={`bg-slate-900 text-white w-64 flex-shrink-0 flex flex-col z-50 print:hidden
                    fixed inset-y-0 left-0 transition-transform duration-200
                    md:sticky md:top-0 md:h-screen md:translate-x-0
                    ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="px-5 py-4 flex items-center gap-2 border-b border-slate-700/70">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="w-7 h-7 rounded-md" />
          <span className="text-lg font-semibold tracking-wide">TaminotWeb</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-3 flex flex-col gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive(l.href) ? 'bg-white text-slate-900' : 'text-gray-300 hover:bg-slate-700/70 hover:text-white'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {session && (
          <div className="border-t border-slate-700/70 p-3">
            <div className="px-1 mb-2 text-xs text-gray-300 truncate">
              {session.name}
              <span className="text-gray-500"> · {ROLE_LABEL[session.role]}</span>
            </div>
            <button
              onClick={doLogout}
              className="w-full px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm text-gray-200 transition-colors"
            >
              Выйти
            </button>
          </div>
        )}
      </aside>

      {/* Контент */}
      <main className="flex-1 min-w-0">
        <div className="max-w-3xl mx-auto px-4 py-4 print:p-0 print:m-0 print:max-w-none">{children}</div>
      </main>
    </div>
  );
}
