import { NextRequest } from 'next/server';
import { finishSession } from '@/lib/sessions';
import { withRole, ROLE_RANK } from '@/lib/auth';
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
      // «Собрано» создаёт только сторона отгрузки (менеджер/админ). Магазин (worker)
      // просто проверяет свою входящую накладную — для него доставку НЕ заводим.
      if (ROLE_RANK[session.role] >= ROLE_RANK['manager']) {
        try {
          const r = await createOrMarkPickedFromSession(sessionId, session.username);
          if (r.error) console.error('[finish] auto-pick failed for session', sessionId, r.error);
        } catch (e) {
          console.error('[finish] auto-pick threw for session', sessionId, (e as Error).message);
        }
      }
      return Response.json(finished);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
