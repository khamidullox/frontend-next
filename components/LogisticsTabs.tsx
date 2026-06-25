'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/logistics', label: '1️⃣ Накладные/заказы' },
  { href: '/logistics/shop-requests', label: '2️⃣ Заявки магазинов' },
  { href: '/logistics/map', label: '3️⃣ Карта' },
  { href: '/logistics/client-addresses', label: '4️⃣ Адреса клиентов' },
];

// Навигация между тремя разделами логистики (для менеджера/админа).
export default function LogisticsTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 mb-3 bg-gray-100 rounded-xl p-1 flex-wrap">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`flex-1 min-w-[120px] text-center py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors ${
            pathname === t.href ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
