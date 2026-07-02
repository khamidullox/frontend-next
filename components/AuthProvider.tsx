'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getMe, UserSession } from '@/lib/api';
import { canAccess, FeatureKey } from '@/lib/features';

// Какой раздел требует какой путь (для защиты от ручного перехода по URL менеджером,
// у которого этот раздел скрыт). Порядок важен: более длинные/специфичные пути выше.
const PATH_FEATURE: { prefix: string; feature: FeatureKey }[] = [
  { prefix: '/logistics/reports', feature: 'log_reports' },
  { prefix: '/logistics/client-addresses', feature: 'log_addresses' },
  { prefix: '/logistics/clients', feature: 'log_clients' },
  { prefix: '/logistics/mileage', feature: 'log_mileage' },
  { prefix: '/logistics/shop-requests', feature: 'log_shop_requests' },
  { prefix: '/analytics', feature: 'analytics' },
  { prefix: '/movements', feature: 'movements' },
  { prefix: '/orders', feature: 'orders' },
  { prefix: '/transfers', feature: 'transfers' },
  { prefix: '/receipts', feature: 'receipts' },
];

interface AuthCtx {
  session: UserSession | null;
  loading: boolean;
  setupNeeded: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  session: null, loading: true, setupNeeded: false, refresh: async () => {},
});

export function useAuth() {
  return useContext(Ctx);
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const refresh = useCallback(async () => {
    const me = await getMe().catch(() => ({ session: null }));
    setSession(me.session);
    setSetupNeeded(!!(me as { setup_needed?: boolean }).setup_needed);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Редирект на /login, если не авторизован (и наоборот).
  useEffect(() => {
    if (loading) return;
    if (!session && pathname !== '/login') router.replace('/login');
    if (session && pathname === '/login') router.replace('/');
    // Водитель работает только в своих разделах (свои доставки, своя касса, профиль) —
    // уводим его со всех остальных страниц.
    if (
      session?.role === 'driver' &&
      pathname !== '/login' &&
      pathname !== '/profile' &&
      pathname !== '/cash' &&
      !pathname.startsWith('/logistics/my')
    ) {
      router.replace('/logistics/my');
    }
    // Раздел скрыт у этого пользователя (права) — не пускаем по прямой ссылке.
    if (session && session.role !== 'admin') {
      const match = PATH_FEATURE.find((p) => pathname.startsWith(p.prefix));
      if (match && !canAccess(match.feature, session.role, session.features)) {
        router.replace('/');
      }
    }
  }, [loading, session, pathname, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] gap-3 text-gray-500">
        <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }

  // Не показываем защищённые страницы до редиректа.
  if (!session && pathname !== '/login') return null;

  return <Ctx.Provider value={{ session, loading, setupNeeded, refresh }}>{children}</Ctx.Provider>;
}
