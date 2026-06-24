import { getSession } from '@/lib/auth';
import { listOpenShopOffers } from '@/lib/deliveries';
import { rebroadcastStaleOffers } from '@/lib/shopOffers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Открытые заявки магазина (ничьи) с координатами точки выдачи — водитель видит их
// на своей странице и может «взять» те, что рядом с ним.
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });
  if (s.role !== 'driver') return Response.json({ data: [] });
  await rebroadcastStaleOffers().catch(() => {});
  return Response.json({ data: await listOpenShopOffers() });
}
