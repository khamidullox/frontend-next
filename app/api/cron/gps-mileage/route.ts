import { NextRequest } from 'next/server';
import { recordGpsTick } from '@/lib/gpsMileage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Триггерится внешним cron-сервисом (cron-job.org и т.п.) раз в несколько минут —
// Vercel Hobby не даёт cron чаще раза в сутки, поэтому опрос не через vercel.json.
// Защита — секрет: принимаем общий CRON_SECRET (как у остальных cron) или отдельный
// GPS_MILEAGE_CRON_SECRET, чтобы не заводить второй секрет.
function isAuthorized(request: NextRequest): boolean {
  const cron = process.env.CRON_SECRET;
  const gps = process.env.GPS_MILEAGE_CRON_SECRET;
  if (!cron && !gps) return true; // секрет не задан — не ограничиваем
  const q = request.nextUrl.searchParams.get('secret');
  const auth = request.headers.get('authorization');
  if (cron && (q === cron || auth === `Bearer ${cron}`)) return true;
  if (gps && (q === gps || auth === `Bearer ${gps}`)) return true;
  return false;
}

async function run(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await recordGpsTick();
    return Response.json({ ok: true, ...result });
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
