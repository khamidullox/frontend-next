import { NextRequest } from 'next/server';
import { deleteUser } from '@/lib/users';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  return withRole('admin', async (session) => {
    const { username } = await params;
    if (username.toLowerCase() === session.username.toLowerCase()) {
      return Response.json({ error: 'Нельзя удалить самого себя' }, { status: 400 });
    }
    await deleteUser(username);
    return Response.json({ ok: true });
  });
}
