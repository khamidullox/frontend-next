import { NextRequest } from 'next/server';
import { recordRecentDays } from '@/lib/shopSalesHistory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // бэкфилл до 16 дней — по одному запросу к Smartup на день

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = request.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;
  return request.nextUrl.searchParams.get('secret') === secret;
}

// Накопление истории продаж по дням (Smartup отдаёт только ~16 дней — копим у себя).
// Ежедневно достаточно перезаписать последние несколько дней (на случай поздних
// возвратов). Первичный бэкфилл — ?days=16 (запросить руками один раз).
async function run(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const daysParam = Number(request.nextUrl.searchParams.get('days'));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 16) : 3;
  try {
    const result = await recordRecentDays(days);
    return Response.json({ ok: true, days, recorded: result });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}
export async function POST(request: NextRequest) {
  return run(request);
}
