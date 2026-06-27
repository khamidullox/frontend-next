import { NextRequest } from 'next/server';
import { finishSession } from '@/lib/sessions';
import { withRole } from '@/lib/auth';
import { createOrMarkPickedFromSession } from '@/lib/deliveries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  return withRole('worker', async (session) => {
    try {
      const { sessionId } = await params;
      const finished = await finishSession(sessionId);

      if (!finished) {
        return Response.json({ error: 'Сессия проверки не найдена' }, { status: 404 });
      }
      // Сразу заводим доставку без водителя (или отмечаем «собрано», если уже была
      // создана вручную) — чтобы она появилась в «Собранные, без водителя» на /logistics
      // без необходимости назначать водителя через AssignDocModal.
      await createOrMarkPickedFromSession(sessionId, session.username).catch(() => {});
      return Response.json(finished);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
