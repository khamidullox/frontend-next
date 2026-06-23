import { NextRequest } from 'next/server';
import { getSession, ROLE_RANK } from '@/lib/auth';
import { getRawInventoryFields } from '@/lib/products';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Отладка: сырые поля товара из Smartup (litr, вес) — чтобы видеть, в каких единицах
// приходит объём. Только менеджер+.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });
  if (ROLE_RANK[s.role] < ROLE_RANK['manager']) {
    return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  }
  const { code } = await params;
  const raw = await getRawInventoryFields(code);
  if (!raw) return Response.json({ error: 'Товар не найден' }, { status: 404 });
  return Response.json({ raw });
}
