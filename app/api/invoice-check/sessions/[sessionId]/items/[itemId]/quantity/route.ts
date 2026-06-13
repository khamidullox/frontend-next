import { NextRequest } from 'next/server';
import { setItemQuantity } from '@/lib/sessions';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; itemId: string }> }
) {
  return withRole('worker', async () => {
    try {
      const { sessionId, itemId } = await params;
      const body = await request.json().catch(() => ({}));
      const { quantity } = body || {};

      if (quantity === undefined || quantity === null) {
        return Response.json({ error: 'quantity обязателен' }, { status: 400 });
      }

      const result = await setItemQuantity(sessionId, itemId, quantity);

      if (!result) {
        return Response.json({ error: 'Сессия проверки не найдена' }, { status: 404 });
      }
      if ('error' in result) {
        return Response.json({ error: result.error }, { status: 400 });
      }
      return Response.json(result);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
