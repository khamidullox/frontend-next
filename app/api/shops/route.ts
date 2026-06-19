import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { listShops, createShop } from '@/lib/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Справочник точек доставки (менеджер+).
export async function GET() {
  return withRole('manager', async () => {
    return Response.json({ data: await listShops() });
  });
}

export async function POST(request: NextRequest) {
  return withRole('manager', async () => {
    const body = await request.json().catch(() => ({}));
    const res = await createShop(body);
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    return Response.json({ data: res.shop });
  });
}
