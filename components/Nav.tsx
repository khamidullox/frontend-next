'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { logout, ROLE_LABEL, ROLE_RANK, Role } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';

interface NavLink {
  href: string;
  label: string;
  min: Role; // минимальная роль
}

const LINKS: NavLink[] = [
  { href: '/', label: '📦 Проверка', min: 'worker' },
  { href: '/products', label: '📚 Справочник', min: 'worker' },
  { href: '/warehouses', label: '🏬 Остатки', min: 'worker' },
  { href: '/movements', label: '🗂️ Накладные', min: 'manager' },
  { href: '/orders', label: '🧾 Заказы', min: 'manager' },
  { href: '/transfers', label: '🔄 Перемещения', min: 'manager' },
  { href: '/receipts', label: '📥 Приёмка', min: 'manager' },
  { href: '/history', label: '📋 История', min: 'manager' },
  { href: '/users', label: '👤 Пользователи', min: 'admin' },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { session } = useAuth();

  const rank = session ? ROLE_RANK[session.role] : 0;
  const links = LINKS.filter((l) => rank >= ROLE_RANK[l.min]);

  function isActive(href: string) {
    if (href === '/') return pathname === '/' || pathname.startsWith('/session');
    return pathname.startsWith(href);
  }

  async function doLogout() {
    await logout();
    router.replace('/login');
    router.refresh();
  }

  return (
    <nav className="flex items-center gap-1 px-4 pt-3 max-w-3xl mx-auto flex-wrap">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
            isActive(link.href)
              ? 'bg-gray-100 text-slate-900'
              : 'text-gray-300 hover:text-white hover:bg-slate-800'
          }`}
        >
          {link.label}
        </Link>
      ))}
      {session && (
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-400 hidden sm:inline">
            {session.name} · {ROLE_LABEL[session.role]}
          </span>
          <button
            onClick={doLogout}
            title="Выйти"
            className="px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            🚪
          </button>
        </div>
      )}
    </nav>
  );
}
