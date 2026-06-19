import { withRole } from '@/lib/auth';
import { autoAssignDeliveries } from '@/lib/deliveries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return withRole('manager', async (session) => {
    const result = await autoAssignDeliveries(session.name || session.username);
    return Response.json({ data: result });
  });
}
