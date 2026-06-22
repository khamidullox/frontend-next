import { NextRequest } from 'next/server';
import { setSessionStatus } from '@/lib/sessions';
import { markPickedByDocId } from '@/lib/deliveries';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  return withRole('admin', async () => {
    try {
      const { sessionId } = await params;
      const body = await request.json().catch(() => ({}));
      const status = body?.status;

      if (status !== 'active' && status !== 'finished') {
        return Response.json({ error: 'Некорректный статус' }, { status: 400 });
      }

      const session = await setSessionStatus(sessionId, status);

      if (!session) {
        return Response.json({ error: 'Сессия проверки не найдена' }, { status: 404 });
      }
      // Проверка завершена — связанные доставки по этому документу считаются собранными.
      if (status === 'finished') {
        await markPickedByDocId(session.document.doc_id).catch(() => {});
      }
      return Response.json(session);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
