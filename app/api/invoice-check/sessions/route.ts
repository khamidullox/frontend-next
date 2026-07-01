import { NextRequest } from 'next/server';
import { createSession, listSessions } from '@/lib/sessions';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return withRole('worker', async (user) => {
    try {
      const body = await request.json().catch(() => ({}));
      // Кто проверяет — берём из авторизации (учёт ответственного).
      const session = await createSession({ ...(body || {}), checker_name: user.name });

      if (!session) return Response.json({ error: 'Накладная не найдена' }, { status: 404 });
      if ('conflict' in session && session.conflict) {
        return Response.json({ existing: session.existing }, { status: 409 });
      }
      return Response.json(session, { status: 201 });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}

export async function GET() {
  return withRole('manager', async () => {
    try {
      const sessions = await listSessions();
      return Response.json({ data: sessions });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
