import { getSession, ROLE_RANK } from '@/lib/auth';
import { getCachedCatalog } from '@/lib/products';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Отладка: товары с самым большим объёмом/весом на единицу (после конвертации litr×1000).
// Помогает найти карточки с перепутанными единицами в Smartup (например, объём указан
// в литрах, а не в м³) — такие выбросы утягивают медиану/среднее для approx-фолбэка
// вверх для всех товаров без своих данных в этой же товарной группе. Только менеджер+.
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });
  if (ROLE_RANK[s.role] < ROLE_RANK['manager']) {
    return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  }
  const catalog = await getCachedCatalog();
  // weight_approx/volume_approx проверяем независимо: товар может иметь реальный вес
  // в Smartup, но не объём (или наоборот) — раньше оба списка требовали реальности
  // ОБОИХ полей сразу и теряли ровно те карточки, где сбой только в одном из них.
  const top = (key: 'weight' | 'volume_l', approxKey: 'weight_approx' | 'volume_approx', n = 20) =>
    [...catalog]
      .filter((c) => !c[approxKey])
      .sort((a, b) => b[key] - a[key])
      .slice(0, n)
      .map((c) => ({ code: c.code, name: c.name, group: c.group, weight: c.weight, volume_l: c.volume_l, volume_m3: Math.round(c.volume_l) / 1000 }));
  return Response.json({
    top_volume: top('volume_l', 'volume_approx'),
    top_weight: top('weight', 'weight_approx'),
  });
}
