import { normalizeName } from './normalize';

// Справочник «магазин ↔ код склада» из ручной таблицы соответствия (получена от
// пользователя). person_name в order$export для одной и той же точки иногда
// встречается в разных вариантах текста (другой суффикс/перестановка) — здесь
// собраны известные варианты, чтобы в аналитике они схлопывались в одно название
// вместо разных строк «по магазинам» для физически одной и той же точки.
// [варианты названия...], каноническое имя — первый элемент массива.
const RAW_ENTRIES: string[][] = [
  ['5501 Fargona Arzonchi (Muhammadumar)'],
  ['5502 Kombinat Abu-Saxiy (Javlonbek)'],
  ['5503 Kombinat Chinnichi Baza (Akramjon)'],
  ['5504 Arzonchi Mini Gastranom (Azizbek)'],
  ['5505 Oltiariq Eng Arzoni (Dilorom)'],
  ['5507 Kombinat Multibrend_2 (Muhamadrahim)'],
  ['5508 Farg`ona Eng Arzon (Sardor)'],
  ['5509 Kombinat Eng Arzoni (Dilshodjon)'],
  ['5510 Andijon Abu-Saxiy (Alisher)', '5510 Andijon Abu-Saxiy (Lutfyor)'],
  ['5512 Margilon Eng Arzon (Mustaqim)'],
  ['5513 Rishton Abu-Saxiy (Behruz)'],
  ['5514 Quva Abu-Saxiy (Raxmonali)'],
  ['5515 Oltiariq Abu-Saxiy (Muxiddin)'],
  ['5516 Kombinat Arzonchi', '5516 Kombinat Arzonchi (0027)'],
  ['7701\\1 HAIER MAGAZIN (Fargona) Sotuv', '7701 HAIER Magazin (Fargona)'],
  ['7702 ARZONCHI Sotuv (Uchkoprik)', '7702 Arzonchi (Uchko`prik)'],
  ['7703 ARZONCHI Namangan Sotuv', '7703 Arzonchi (Namangan)'],
  ['7704 ARZONCHI (Andijon) New', '7704 Arzonchi (Andijon)'],
  ['7705 ARZONCHI (Shahrisabz)', '7705 Arzonchi (Shahisabz)'],
  ['7706 ARZONCHI Toshkent (Toytepa)', '7706 Arzonchi Toshkent (Toytepa)'],
  ['7707 ARZONCHI Toshkent (Chilonzor)', '7707 Arzonchi Toshkent (Chilonzor)'],
  ['7708 Arzonchi (Quva)', '7708 Arzonchi (Quva) Muhammadbobur'],
  ['7709 Arzonchi Chust Sotuv', '7709 Chust Arzonchi (Shoxruxbek)'],
  ['7710 Chimyon Chinnichi Baza'],
];

const SHOP_NAME_MAP = new Map<string, string>();
for (const variants of RAW_ENTRIES) {
  const canonical = variants[0];
  for (const v of variants) SHOP_NAME_MAP.set(normalizeName(v), canonical);
}

// Канонизирует название магазина/точки, если оно есть в справочнике; иначе
// возвращает исходный текст без изменений (безопасный фолбэк — ничего не ломает,
// просто не дедуплицирует то, чего мы не знаем).
export function canonicalShopName(name: string): string {
  const key = normalizeName(name);
  return SHOP_NAME_MAP.get(key) || name;
}
