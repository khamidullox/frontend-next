import { NextRequest } from 'next/server';
import { getWarehouseStock } from '@/lib/products';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // первый «холодный» прогон тянет баланс+каталог из Smartup

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withRole('worker', async () => {
    try {
      const { id } = await params;
      const stock = await getWarehouseStock(id);
      return Response.json(stock);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
