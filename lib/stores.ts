// Бренды/магазины для шаблонов ценников.
// Логотипы — картинки в public/stores/<id>.png (или .svg). Пока файла нет — показывается название текстом.
export interface StoreBrand {
  id: string;
  name: string;        // Отображаемое название (если нет логотипа-картинки)
  keywords: string[];  // По этим словам в названии склада подбирается шаблон по умолчанию
  logo: string;        // Путь к логотипу в /public
  footer: string;      // Слоган внизу ценника
}

// Параметры рассрочки: месячный платёж = цена × (1 + процент/100) / months.
export const INSTALLMENT = { months: 12, defaultPct: 38 };

export function monthlyInstallment(price: number, pct: number): number {
  if (!price || price <= 0) return 0;
  return Math.round((price * (1 + pct / 100)) / INSTALLMENT.months);
}

// Отредактируйте список под свои магазины. logo — положите файл в public/stores/.
export const STORES: StoreBrand[] = [
  { id: 'arzonchi',  name: 'ARZONCHI',   keywords: ['arzonchi', 'арзончи'],              logo: '/stores/arzonchi.png',  footer: 'Arzonchi super narx · NASIYA ISHONCH' },
  { id: 'chinnibaza', name: 'CHINNI BAZA', keywords: ['chinni', 'чинни'],                 logo: '/stores/chinni_baza.png', footer: 'Chinni baza · Eng arzon narx' },
  { id: 'engarzon',  name: 'Eng ARZON',  keywords: ['eng arzon', 'engarzon', 'енг арзон'], logo: '/stores/eng_arzoni.png',  footer: 'Eng arzon · MUDDATLIK' },
  { id: 'abusaxiy',  name: 'ABU-SAXIY',  keywords: ['abu', 'saxiy', 'абу'],               logo: '/stores/abu_saxiy.png',  footer: 'Abu-Saxiy · NASIYA' },
];

// Подбор шаблона по названию склада/магазина (ключевые слова). Фолбэк — первый бренд.
export function pickStoreByWarehouse(warehouseName: string): StoreBrand {
  const n = (warehouseName || '').toLowerCase();
  return STORES.find(s => s.keywords.some(k => n.includes(k))) || STORES[0];
}

export function getStore(id: string): StoreBrand {
  return STORES.find(s => s.id === id) || STORES[0];
}
