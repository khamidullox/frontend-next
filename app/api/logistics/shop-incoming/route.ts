import { getSession } from '@/lib/auth';
import { listIncomingForShop } from '@/lib/deliveries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Доставки склад → магазин, идущие в магазин текущего воркера — видно, что и кто едет.
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });
  if (!s.shop_id) return Response.json({ data: [] });
  return Response.json({ data: await listIncomingForShop(s.shop_id) });
}
