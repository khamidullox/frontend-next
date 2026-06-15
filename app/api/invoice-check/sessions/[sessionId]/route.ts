import { NextRequest } from 'next/server';
import { getSession, deleteSession } from '@/lib/sessions';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  return withRole('worker', async () => {
    try {
      const { sessionId } = await params;
      const session = await getSession(sessionId);

      if (!session) {
        return Response.json({ error: 'Сессия проверки не найдена' }, { status: 404 });
      }
      return Response.json(session);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  return withRole('admin', async () => {
    try {
      const { sessionId } = await params;
      const ok = await deleteSession(sessionId);

      if (!ok) {
        return Response.json({ error: 'Сессия проверки не найдена' }, { status: 404 });
      }
      return Response.json({ ok: true });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
