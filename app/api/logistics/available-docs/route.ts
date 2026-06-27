import { getSession } from '@/lib/auth';
import { listOpenPickedDocs } from '@/lib/deliveries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Собранные накладные/заказы/перемещения без водителя — водитель видит их у себя и
// может взять сам (claim, см. /api/logistics/shop-requests/claim — он уже общий).
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });
  if (s.role !== 'driver') return Response.json({ data: [] });
  return Response.json({ data: await listOpenPickedDocs() });
}
