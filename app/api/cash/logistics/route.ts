import { withRole } from '@/lib/auth';
import { listDriverCashBalances, listCashSettlements } from '@/lib/deliveries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Касса → Логистика: сколько наличных на руках у каждого водителя (не сдано) + история сдач.
export async function GET() {
  return withRole('manager', async () => {
    const [data, history] = await Promise.all([
      listDriverCashBalances(),
      listCashSettlements(100),
    ]);
    const total = data.reduce((s, d) => s + d.total, 0);
    return Response.json({ data, total, history });
  });
}
