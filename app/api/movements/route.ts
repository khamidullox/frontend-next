import { listMovements } from '@/lib/movement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const movements = await listMovements();
    return Response.json({ data: movements });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
