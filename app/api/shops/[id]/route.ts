import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { updateShop, deleteShop } from '@/lib/shops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRole('manager', async () => {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const res = await updateShop(id, body);
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    return Response.json({ data: res.shop });
  });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRole('manager', async () => {
    const { id } = await params;
    const ok = await deleteShop(id);
    if (!ok) return Response.json({ error: 'Точка не найдена' }, { status: 404 });
    return Response.json({ ok: true });
  });
}
