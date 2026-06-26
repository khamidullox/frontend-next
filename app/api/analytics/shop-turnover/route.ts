import { NextRequest } from 'next/server';
import { getSession, ROLE_RANK } from '@/lib/auth';
import { getShopTurnover } from '@/lib/shopAnalytics';
import { Period } from '@/lib/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PERIODS: Period[] = ['today', '7d', '15d', '30d'];

export async function GET(request: NextRequest) {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });
  if (ROLE_RANK[s.role] < ROLE_RANK['manager']) {
    return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  }
  const periodParam = request.nextUrl.searchParams.get('period') || 'today';
  const period = PERIODS.includes(periodParam as Period) ? (periodParam as Period) : 'today';
  const shop = request.nextUrl.searchParams.get('shop') || '';
  try {
    const data = await getShopTurnover(period);
    // Список магазинов (с итогами) — всегда; строки — только выбранного магазина, чтобы
    // не слать на клиент полотно по всем 24 точкам сразу.
    const rows = shop ? data.rows.filter((r) => r.shop_code === shop) : [];
    return Response.json({ data: { period: data.period, updated_ms: data.updated_ms, shops: data.shops, rows } });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
