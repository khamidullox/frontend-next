import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { placeStock, setStock, moveStock, findByProduct, listByLocation } from '@/lib/wms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET: ?product=<штрихкод/код> — где лежит; ?location=<ячейка> — что в ячейке.
export async function GET(request: NextRequest) {
  return withRole('worker', async () => {
    const sp = request.nextUrl.searchParams;
    const product = sp.get('product');
    const location = sp.get('location');
    if (product) {
      const res = await findByProduct(product);
      if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
      return Response.json({ data: res });
    }
    if (location) return Response.json({ data: { rows: await listByLocation(location) } });
    return Response.json({ error: 'Укажите product или location' }, { status: 400 });
  });
}

// POST: { action: 'place'|'set'|'move', ... }
export async function POST(request: NextRequest) {
  return withRole('worker', async (session) => {
    const body = await request.json().catch(() => ({}));
    const by = session.username;
    let res;
    if (body.action === 'move') {
      res = await moveStock({ from: body.from, to: body.to, product: body.product, qty: body.qty, by });
    } else if (body.action === 'set') {
      res = await setStock({ location: body.location, product: body.product, qty: body.qty, by });
    } else {
      res = await placeStock({ location: body.location, product: body.product, qty: body.qty, card_number: body.card_number, by });
    }
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    return Response.json({ data: res });
  });
}
