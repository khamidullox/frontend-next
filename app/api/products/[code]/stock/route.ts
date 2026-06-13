import { NextRequest } from 'next/server';
import { getProductStock } from '@/lib/products';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  return withRole('worker', async () => {
    try {
      const { code } = await params;
      const stock = await getProductStock(code);
      return Response.json(stock);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
