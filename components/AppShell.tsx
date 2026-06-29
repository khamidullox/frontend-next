'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { ROLE_RANK, Role, logout } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { useLang, TKey } from '@/lib/i18n';
import { canAccess, FeatureKey } from '@/lib/features';

// feature — если задан, видимость пункта определяется правами раздела (с учётом
// переопределений у пользователя), иначе обычной ролью (min).
interface NavLink { href: string; key: TKey; min: Role; feature?: FeatureKey }

const LINKS: NavLink[] = [
  { href: '/', key: 'nav_check', min: 'worker' },
  { href: '/products', key: 'nav_catalog', min: 'worker' },
  { href: '/warehouses', key: 'nav_stock', min: 'worker' },
  { href: '/price-tags', key: 'nav_pricetags', min: 'worker' },
  { href: '/movements', key: 'nav_movements', min: 'manager', feature: 'movements' },
  { href: '/orders', key: 'nav_orders', min: 'manager', feature: 'orders' },
  { href: '/history', key: 'nav_history', min: 'manager' },
  { href: '/logistics', key: 'nav_logistics', min: 'manager' },
  { href: '/analytics', key: 'nav_analytics', min: 'manager', feature: 'analytics' },
  { href: '/transfers', key: 'nav_transfers', min: 'admin', feature: 'transfers' },
  { href: '/receipts', key: 'nav_receipts', min: 'admin', feature: 'receipts' },
  { href: '/users', key: 'nav_users', min: 'admin' },
];

// Водитель — особая роль: видит только свои доставки.
const DRIVER_LINKS: NavLink[] = [
  { href: '/logistics/my', key: 'nav_my_deliveries', min: 'driver' },
  { href: '/logistics/my-stats', key: 'nav_my_stats', min: 'driver' },
];

// Магазин (worker) — кроме общих пунктов, видит создание заявок на доставку клиентам.
const WORKER_EXTRA_LINKS: NavLink[] = [
  { href: '/logistics/shop', key: 'nav_shop_orders', min: 'worker' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const { t } = useLang();
  const ROLE_LABEL_T: Record<Role, TKey> = {
    driver: 'role_driver', worker: 'role_worker', manager: 'role_manager', admin: 'role_admin',
  };

  // Без «обвязки»: вход и страница проверки (полный экран).
  const bare = pathname === '/login' || pathname.startsWith('/session');
  if (bare) {
    return <main className="max-w-3xl mx-auto px-4 py-4">{children}</main>;
  }

  const rank = session ? ROLE_RANK[session.role] : 0;
  // Пункт виден, если проходит по роли И (если у него есть feature) по правам раздела.
  const allowed = (l: NavLink) =>
    rank >= ROLE_RANK[l.min] &&
    (!l.feature || !session || canAccess(l.feature, session.role, session.features));
  const links = session?.role === 'driver'
    ? DRIVER_LINKS
    : session?.role === 'worker'
    ? [...LINKS.filter(allowed), ...WORKER_EXTRA_LINKS]
    : LINKS.filter(allowed);

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
        <button onClick={() => setOpen(true)} aria-label={t('menu')} className="text-2xl leading-none">☰</button>
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
              {t(l.key)}
            </Link>
          ))}
        </nav>

        {session && (
          <div className="border-t border-slate-700/70 p-3">
            <div className="px-1 mb-2 text-xs text-gray-300 truncate">
              {session.name}
              <span className="text-gray-500"> · {t(ROLE_LABEL_T[session.role])}</span>
            </div>
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className={`block px-3 py-2 mb-1.5 rounded-lg text-sm font-medium transition-colors ${
                isActive('/profile') ? 'bg-white text-slate-900' : 'text-gray-300 hover:bg-slate-700/70 hover:text-white'
              }`}
            >
              {t('nav_profile')}
            </Link>
            <button
              onClick={doLogout}
              className="w-full px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm text-gray-200 transition-colors"
            >
              {t('logout')}
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
