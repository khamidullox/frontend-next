'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ROLE_RANK, Role } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';

interface NavLink {
  href: string;
  label: string;
  min: Role;
}

const LINKS: NavLink[] = [
  { href: '/', label: '📦 Проверка', min: 'worker' },
  { href: '/products', label: '📚 Справочник', min: 'worker' },
  { href: '/warehouses', label: '🏬 Остатки', min: 'worker' },
  { href: '/movements', label: '🗂️ Накладные', min: 'manager' },
  { href: '/orders', label: '🧾 Заказы', min: 'manager' },
  { href: '/history', label: '📋 История', min: 'manager' },
  { href: '/transfers', label: '🔄 Перемещения', min: 'admin' },
  { href: '/receipts', label: '📥 Приёмка', min: 'admin' },
  { href: '/users', label: '👤 Пользователи', min: 'admin' },
];

export default function Nav() {
  const pathname = usePathname();
  const { session } = useAuth();

  const rank = session ? ROLE_RANK[session.role] : 0;
  const links = LINKS.filter((l) => rank >= ROLE_RANK[l.min]);

  function isActive(href: string) {
    if (href === '/') return pathname === '/' || pathname.startsWith('/session');
    return pathname.startsWith(href);
  }

  return (
    <nav className="max-w-3xl mx-auto px-3">
      <div className="flex gap-1.5 overflow-x-auto pb-2 -mb-px scrollbar-none">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`whitespace-nowrap px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
              isActive(link.href)
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-gray-300 hover:text-white hover:bg-slate-700/60'
            }`}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
