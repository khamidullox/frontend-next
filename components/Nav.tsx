'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isAdminUnlocked, setAdminUnlocked } from '@/lib/admin';

// Видны всем (без пароля)
const PUBLIC_LINKS = [
  { href: '/', label: '📦 Проверка' },
  { href: '/products', label: '📚 Справочник' },
];

const ADMIN_LINKS = [
  { href: '/movements', label: '🗂️ Накладные' },
  { href: '/orders', label: '🧾 Заказы' },
  { href: '/history', label: '📋 История' },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [unlocked, setUnlocked] = useState(false);

  // Перечитываем флаг при каждой смене страницы (после /unlock).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUnlocked(isAdminUnlocked());
  }, [pathname]);

  function isActive(href: string) {
    if (href === '/') return pathname === '/' || pathname.startsWith('/session');
    return pathname.startsWith(href);
  }

  function lock() {
    setAdminUnlocked(false);
    setUnlocked(false);
    router.push('/');
  }

  const links = unlocked ? [...PUBLIC_LINKS, ...ADMIN_LINKS] : PUBLIC_LINKS;

  return (
    <nav className="flex items-center gap-1 px-4 pt-3 max-w-3xl mx-auto">
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
      {unlocked && (
        <button
          onClick={lock}
          title="Закрыть разделы"
          className="ml-auto px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          🔒
        </button>
      )}
    </nav>
  );
}
