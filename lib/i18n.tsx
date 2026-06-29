'use client';

import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { setMyLanguage, Language } from '@/lib/api';

// Общий словарь интерфейса (шапка/меню, общие для всех страниц элементы).
// Перевод конкретных страниц (формы, таблицы) добавляется сюда постепенно —
// см. README-комментарий в app/profile/page.tsx про текущий охват.
const DICT = {
  nav_check: { ru: '📦 Проверка', uz: '📦 Tekshirish' },
  nav_catalog: { ru: '📚 Справочник', uz: '📚 Katalog' },
  nav_stock: { ru: '🏬 Остатки', uz: '🏬 Qoldiqlar' },
  nav_pricetags: { ru: '🏷️ Ценники', uz: '🏷️ Narx yorliqlari' },
  nav_wms: { ru: '📦 WMS склад', uz: '📦 WMS ombor' },
  nav_movements: { ru: '🗂️ Накладные', uz: '🗂️ Nakladlar' },
  nav_orders: { ru: '🧾 Заказы', uz: '🧾 Buyurtmalar' },
  nav_history: { ru: '📋 История', uz: '📋 Tarix' },
  nav_logistics: { ru: '🚚 Логистика', uz: '🚚 Logistika' },
  nav_analytics: { ru: '📊 Аналитика', uz: '📊 Analitika' },
  nav_transfers: { ru: '🔄 Перемещения', uz: '🔄 Koʻchirishlar' },
  nav_receipts: { ru: '📥 Приёмка', uz: '📥 Qabul qilish' },
  nav_users: { ru: '👤 Пользователи', uz: '👤 Foydalanuvchilar' },
  nav_my_deliveries: { ru: '🚚 Мои доставки', uz: '🚚 Mening yetkazmalarim' },
  nav_my_stats: { ru: '📊 Мои расчёты', uz: '📊 Mening hisoblarim' },
  nav_shop_orders: { ru: '🚚 Заказы клиентам', uz: '🚚 Mijozlarga buyurtmalar' },
  nav_profile: { ru: '⚙️ Профиль', uz: '⚙️ Profil' },
  menu: { ru: 'Меню', uz: 'Menyu' },
  logout: { ru: 'Выйти', uz: 'Chiqish' },
  role_driver: { ru: 'Водитель', uz: 'Haydovchi' },
  role_worker: { ru: 'Магазин', uz: 'Doʻkon' },
  role_manager: { ru: 'Менеджер', uz: 'Menejer' },
  role_admin: { ru: 'Админ', uz: 'Admin' },
  profile_title: { ru: 'Профиль', uz: 'Profil' },
  profile_language: { ru: 'Язык интерфейса', uz: 'Interfeys tili' },
  profile_saved: { ru: 'Сохранено', uz: 'Saqlandi' },
  profile_name: { ru: 'Имя', uz: 'Ism' },
  profile_login: { ru: 'Логин', uz: 'Login' },
  profile_role: { ru: 'Роль', uz: 'Rol' },
} as const;

export type TKey = keyof typeof DICT;

const LangCtx = createContext<{ lang: Language; setLang: (l: Language) => void; t: (key: TKey) => string }>({
  lang: 'ru',
  setLang: () => {},
  t: (key) => DICT[key].ru,
});

export function useLang() {
  return useContext(LangCtx);
}

export default function LanguageProvider({ children }: { children: React.ReactNode }) {
  const { session, refresh } = useAuth();
  const [override, setOverride] = useState<Language | null>(null);
  const lang: Language = override || session?.language || 'ru';

  const setLang = useCallback((l: Language) => {
    setOverride(l);
    setMyLanguage(l).then(refresh).catch(() => setOverride(null));
  }, [refresh]);

  const t = useCallback((key: TKey) => DICT[key][lang] || DICT[key].ru, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}
