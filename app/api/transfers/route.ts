import { listTransfers } from '@/lib/transfers';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withRole('manager', async () => {
    try {
      const data = await listTransfers();
      return Response.json({ data });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
