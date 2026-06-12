import { getProductCatalog } from '@/lib/products';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getProductCatalog();
    return Response.json({ data });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
