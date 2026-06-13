import { listWarehouseStock } from '@/lib/products';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Список складов считается прямо из снимка остатков (агрегаты дешёвые).
// Пользователь видит свои привязанные склады (7 основных + свой); если складов
// не задано (админ/менеджер) — основные.
export async function GET() {
  return withRole('worker', async (user) => {
    try {
      const data = await listWarehouseStock(user.warehouses);
      return Response.json({ data });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
