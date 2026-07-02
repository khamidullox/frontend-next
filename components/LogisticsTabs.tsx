'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { canAccess, FeatureKey } from '@/lib/features';

const TABS: { href: string; label: string; feature?: FeatureKey }[] = [
  { href: '/logistics', label: '1️⃣ Накладные/заказы' },
  { href: '/logistics/shop-requests', label: '2️⃣ Заявки магазинов', feature: 'log_shop_requests' },
  { href: '/logistics/map', label: '3️⃣ Карта' },
  { href: '/logistics/client-addresses', label: '4️⃣ Адреса клиентов', feature: 'log_addresses' },
  { href: '/logistics/mileage', label: '5️⃣ Пробег GPS', feature: 'log_mileage' },
  { href: '/logistics/history', label: '📋 История заявок' },
];

// Навигация между разделами логистики (для менеджера/админа).
export default function LogisticsTabs() {
  const pathname = usePathname();
  const { session } = useAuth();
  const tabs = TABS.filter((t) => !t.feature || !session || canAccess(t.feature, session.role, session.features));
  return (
    <div className="flex gap-1 mb-3 bg-gray-100 rounded-xl p-1 flex-wrap">
      {tabs.map((t) => (
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
