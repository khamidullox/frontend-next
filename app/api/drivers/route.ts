import { withRole } from '@/lib/auth';
import { listDrivers } from '@/lib/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Список водителей для выбора при назначении доставки (менеджер+).
export async function GET() {
  return withRole('manager', async () => {
    return Response.json({ data: await listDrivers() });
  });
}
