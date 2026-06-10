import { NextRequest } from 'next/server';
import { getSession } from '@/lib/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
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
}
