import { listWarehouseStock } from '@/lib/products';
import { withRole, ROLE_RANK } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Список складов считается прямо из снимка остатков (агрегаты дешёвые).
// Пользователь видит свои привязанные склады (7 основных + свой); если складов
// не задано (админ/менеджер) — основные.
// ?for=tags (ценники): менеджер/админ видят ВСЕ склады, магазин — только свои без основных.
export async function GET(req: Request) {
  return withRole('worker', async (user) => {
    try {
      const forParam = new URL(req.url).searchParams.get('for');
      let data;
      if (forParam === 'tags') {
        if (ROLE_RANK[user.role] >= ROLE_RANK.manager) {
          data = await listWarehouseStock(undefined, { all: true });
        } else {
          // home_warehouse (свой склад магазина) хранится отдельно от user.warehouses
          // и не попадает в allowed автоматически — добавляем его явно, иначе
          // excludeMain уберёт все основные и список окажется пустым.
          const allowed = [...(user.warehouses || [])];
          if (user.home_warehouse && !allowed.includes(user.home_warehouse)) {
            allowed.push(user.home_warehouse);
          }
          data = await listWarehouseStock(allowed.length ? allowed : undefined, { excludeMain: true });
        }
      } else if (forParam === 'all') {
        // Все склады (для выбора при настройке пользователя) — менеджер/админ.
        data = ROLE_RANK[user.role] >= ROLE_RANK.manager
          ? await listWarehouseStock(undefined, { all: true })
          : await listWarehouseStock(user.warehouses);
      } else {
        data = await listWarehouseStock(user.warehouses);
      }
      return Response.json({ data });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
