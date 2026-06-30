import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { bulkPlace } from '@/lib/wms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Массовая раскладка из Excel: { warehouse, rows: [{product, location, qty, zone, label}] }
export async function POST(request: NextRequest) {
  return withRole('worker', async (session) => {
    const body = await request.json().catch(() => ({}));
    const wh = String(body.warehouse || '001');
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return Response.json({ error: 'Нет строк для импорта' }, { status: 400 });
    const res = await bulkPlace(wh, rows, session.username);
    return Response.json({ data: res });
  });
}
