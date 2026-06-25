import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { listDailyMileage, tashkentDateKey } from '@/lib/gpsMileage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return withRole('manager', async () => {
    const date = request.nextUrl.searchParams.get('date') || tashkentDateKey();
    return Response.json({ data: await listDailyMileage(date), date });
  });
}
