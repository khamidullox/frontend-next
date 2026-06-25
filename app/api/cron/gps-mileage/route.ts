import { NextRequest } from 'next/server';
import { recordGpsTick } from '@/lib/gpsMileage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Триггерится внешним cron-сервисом (cron-job.org и т.п.) раз в несколько минут —
// Vercel Hobby не даёт cron чаще раза в сутки, поэтому опрос не через vercel.json.
// Защита — секрет в query, а не сессия: вызывающий не залогинен в приложении.
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (!process.env.GPS_MILEAGE_CRON_SECRET || secret !== process.env.GPS_MILEAGE_CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await recordGpsTick();
  return Response.json({ ok: true, ...result });
}
