import { NextRequest } from 'next/server';
import { earliestStoredDate } from '@/lib/shopSalesHistory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.nextUrl.searchParams.get('secret') === secret;
}

// Разовая проверка: с какой даты в нашей базе реально есть накопленная история
// продаж — без нужды логиниться сессией (используем CRON_SECRET).
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const earliest = await earliestStoredDate();
  return Response.json({ earliest_stored_date: earliest });
}
