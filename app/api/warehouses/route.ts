import { listWarehouseStock } from '@/lib/products';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Список складов считается прямо из 5-минутного снимка остатков (агрегаты
// дешёвые), поэтому всегда такой же свежий, как и сами остатки.
export async function GET() {
  try {
    const data = await listWarehouseStock();
    return Response.json({ data });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
