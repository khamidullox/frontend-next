import { NextRequest } from 'next/server';
import { getProductStock } from '@/lib/products';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const stock = await getProductStock(code);
    return Response.json(stock);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
