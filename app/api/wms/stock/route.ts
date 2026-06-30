import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { placeStock, setStock, moveStock, findByProduct, listByLocation, getOverview } from '@/lib/wms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// GET: ?warehouse=&overview=1 — сводка; &product= — где лежит; &location= — что в ячейке.
export async function GET(request: NextRequest) {
  return withRole('worker', async () => {
    const sp = request.nextUrl.searchParams;
    const wh = sp.get('warehouse') || '001';
    if (sp.get('overview')) return Response.json({ data: await getOverview(wh) });
    const product = sp.get('product');
    const location = sp.get('location');
    if (product) {
      const res = await findByProduct(wh, product);
      if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
      return Response.json({ data: res });
    }
    if (location) return Response.json({ data: { rows: await listByLocation(wh, location) } });
    return Response.json({ error: 'Укажите product или location' }, { status: 400 });
  });
}

// POST: { warehouse, action: 'place'|'set'|'move', ... }
export async function POST(request: NextRequest) {
  return withRole('worker', async (session) => {
    const body = await request.json().catch(() => ({}));
    const wh = String(body.warehouse || '001');
    const by = session.username;
    let res;
    if (body.action === 'move') res = await moveStock({ warehouse: wh, from: body.from, to: body.to, product: body.product, qty: body.qty, by });
    else if (body.action === 'set') res = await setStock({ warehouse: wh, location: body.location, product: body.product, qty: body.qty, by });
    else res = await placeStock({ warehouse: wh, location: body.location, product: body.product, qty: body.qty, card_number: body.card_number, by, autoCreate: !!body.autoCreate, zone: body.zone, label: body.label });
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    return Response.json({ data: res });
  });
}
