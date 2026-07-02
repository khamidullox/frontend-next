import { getSession } from '@/lib/auth';
import { getDriverCashBalance } from '@/lib/deliveries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Личная касса водителя: сколько наличных он должен сдать и по каким доставкам.
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });
  if (s.role !== 'driver') return Response.json({ error: 'Только для водителя' }, { status: 403 });
  const data = await getDriverCashBalance(s.username);
  return Response.json({ data });
}
