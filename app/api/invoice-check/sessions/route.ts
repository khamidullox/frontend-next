import { NextRequest } from 'next/server';
import { createSession, listSessions } from '@/lib/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const session = await createSession(body || {});

    if (!session) {
      return Response.json({ error: 'Накладная не найдена' }, { status: 404 });
    }

    return Response.json(session, { status: 201 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const sessions = await listSessions();
    return Response.json({ data: sessions });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
