// Привязка «код склада → розничный магазин (рабочая зона)» из ручной таблицы
// соответствия пользователя, подтверждённой по реальным заказам Smartup
// (warehouse_code в позициях заказа = код склада магазина). Ключ — код склада
// (как в order_products.warehouse_code и в балансе после id→code), значение —
// {code: код магазина-рабочей-зоны, name: его название}.
//
// Центральные склады (001/002/003/005/006/008/7776, 07, 707, Asos, 004B …) сюда
// НЕ входят — оттуда отгружают опт/VIP/онлайн, а не розничные точки.

export interface ShopRef {
  code: string; // код магазина (ведущее число рабочей зоны: 5502, 7703 …)
  name: string;
}

// warehouseCode → ShopRef. Коды складов взяты из таблицы соответствия как есть
// (обратите внимание: «08» ≠ «008» — первый это склад магазина 5502, второй —
// центральный; сравнение строгое по строке, так что они не путаются).
const WAREHOUSE_TO_SHOP: Record<string, ShopRef> = {
  '5501': { code: '5501', name: '5501 Fargona Arzonchi' },
  '08':   { code: '5502', name: '5502 Kombinat Abu-Saxiy' },
  '5503': { code: '5503', name: '5503 Kombinat Chinnichi Baza' },
  '5504': { code: '5504', name: '5504 Arzonchi Mini Gastranom' },
  '5505': { code: '5505', name: '5505 Oltiariq Eng Arzoni' },
  '12':   { code: '5507', name: '5507 Kombinat Multibrend_2' },
  '18':   { code: '5508', name: '5508 Farg`ona Eng Arzon' },
  '19':   { code: '5509', name: '5509 Kombinat Eng Arzoni' },
  '21':   { code: '5510', name: '5510 Andijon Abu-Saxiy' },
  '24':   { code: '5512', name: '5512 Margilon Eng Arzon' },
  '26':   { code: '5513', name: '5513 Rishton Abu-Saxiy' },
  '13':   { code: '5514', name: '5514 Quva Abu-Saxiy' },
  '28':   { code: '5515', name: '5515 Oltiariq Abu-Saxiy' },
  '29':   { code: '5516', name: '5516 Kombinat Arzonchi' },
  '7701': { code: '7701', name: '7701 HAIER Magazin (Fargona)' },
  '7702': { code: '7702', name: '7702 Arzonchi (Uchko`prik)' },
  '7703': { code: '7703', name: '7703 Arzonchi (Namangan)' },
  '7704': { code: '7704', name: '7704 Arzonchi (Andijon)' },
  '7705': { code: '7705', name: '7705 Arzonchi (Shahrisabz)' },
  '7706': { code: '7706', name: '7706 Arzonchi Toshkent (Toytepa)' },
  '7707': { code: '7707', name: '7707 Arzonchi Toshkent (Chilonzor)' },
  '7708': { code: '7708', name: '7708 Arzonchi (Quva)' },
  '7709': { code: '7709', name: '7709 Arzonchi Chust' },
  '7710': { code: '7710', name: '7710 Chimyon Chinnichi Baza' },
};

// Магазин по коду склада. Поддерживает суффикс «-N» (напр. 7703-2 — второй склад той
// же точки): отбрасываем «-<цифры>» и ищем по базовому коду. null — это не розничная
// точка (центральный/служебный склад).
export function shopForWarehouseCode(warehouseCode: string): ShopRef | null {
  const code = String(warehouseCode || '').trim();
  if (!code) return null;
  if (WAREHOUSE_TO_SHOP[code]) return WAREHOUSE_TO_SHOP[code];
  const base = code.replace(/-\d+$/, '');
  return WAREHOUSE_TO_SHOP[base] || null;
}

// Все магазины (для выпадающего списка), отсортированы по коду.
export const SHOP_LIST: ShopRef[] = Object.values(WAREHOUSE_TO_SHOP)
  .filter((s, i, arr) => arr.findIndex((x) => x.code === s.code) === i)
  .sort((a, b) => a.code.localeCompare(b.code));
