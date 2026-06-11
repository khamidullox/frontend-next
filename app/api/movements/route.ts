import { listMovements } from '@/lib/movement';
import { getCachedList } from '@/lib/listCache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIST_TTL_MS = 10 * 60 * 1000;

export async function GET() {
  try {
    const movements = await getCachedList('movements', listMovements, LIST_TTL_MS);
    return Response.json({ data: movements });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
