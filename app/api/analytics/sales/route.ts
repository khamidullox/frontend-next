import { NextRequest } from 'next/server';
import { getSession, ROLE_RANK } from '@/lib/auth';
import { getAnalyticsSummary, Period } from '@/lib/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// order$export за длинный период — тяжёлый запрос к Smartup (см. lib/orders.ts),
// первый заход после устаревания кэша может занять заметно больше обычных лимитов.
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
  try {
    const data = await getAnalyticsSummary(period);
    return Response.json({ data });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
