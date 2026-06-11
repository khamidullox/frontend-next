'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: '📦 Проверка' },
  { href: '/movements', label: '🗂️ Накладные' },
  { href: '/orders', label: '🧾 Заказы' },
  { href: '/history', label: '📋 История' },
];

export default function Nav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === '/') return pathname === '/' || pathname.startsWith('/session');
    return pathname.startsWith(href);
  }

  return (
    <nav className="flex gap-1 px-4 pt-3 max-w-3xl mx-auto">
      {LINKS.map((link) => (
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
    </nav>
  );
}
