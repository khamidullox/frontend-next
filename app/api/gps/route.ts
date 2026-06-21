import { getCachedGpsLocations } from '@/lib/gps';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withRole('driver', async () => {
    const { locations, updated_at } = await getCachedGpsLocations();
    return Response.json({ ok: true, locations, updated_at });
  });
}
