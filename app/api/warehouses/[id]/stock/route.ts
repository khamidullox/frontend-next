import { NextRequest } from 'next/server';
import { getWarehouseStock } from '@/lib/products';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const stock = await getWarehouseStock(id);
    return Response.json(stock);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
