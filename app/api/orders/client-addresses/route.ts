import { withRole } from '@/lib/auth';
import { listClientAddressStatus } from '@/lib/orders';
import { getCachedList } from '@/lib/listCache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIST_TTL_MS = 10 * 60 * 1000;

export async function GET() {
  return withRole('manager', async () => {
    const data = await getCachedList('client_addresses', listClientAddressStatus, LIST_TTL_MS);
    return Response.json({ data });
  });
}
