import { NextRequest } from 'next/server';
import { getSession, ROLE_RANK } from '@/lib/auth';
import { getOverallTurnover } from '@/lib/shopAnalytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET(request: NextRequest) {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });
  if (ROLE_RANK[s.role] < ROLE_RANK['manager']) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  let from = sp.get('from') || '';
  let to = sp.get('to') || '';
  if (!ISO_RE.test(from) || !ISO_RE.test(to)) {
    const d = new Date(); d.setDate(d.getDate() - 6);
    from = isoDate(d); to = isoDate(new Date());
  }
  if (from > to) [from, to] = [to, from];
  try {
    return Response.json({ data: await getOverallTurnover(from, to) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
