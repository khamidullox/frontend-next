import { smartupRequest } from '@/lib/smartup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Временный диагностический эндпоинт: проверяем, действительно ли movement$export
// (накладные) отдаёт полную историю без ограничения ~7 дней, как у order$export.
export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) return Response.json({ error: 'forbidden' }, { status: 403 });

  const data = await smartupRequest<{ movement?: { movement_number: string; from_movement_date: string }[] }>(
    '/b/anor/mxsx/mkw/movement$export',
    {}
  );
  const list = data.movement || [];
  const dates = list.map((m) => m.from_movement_date).filter(Boolean).sort();
  return Response.json({
    count: list.length,
    earliest: dates[0] || null,
    latest: dates[dates.length - 1] || null,
  });
}
