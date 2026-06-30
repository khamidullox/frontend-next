import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { listLocations, createLocation, deleteLocation } from '@/lib/wms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return withRole('worker', async () => {
    const wh = request.nextUrl.searchParams.get('warehouse') || '001';
    return Response.json({ data: await listLocations(wh) });
  });
}

export async function POST(request: NextRequest) {
  return withRole('worker', async () => {
    const body = await request.json().catch(() => ({}));
    const res = await createLocation(String(body.warehouse || '001'), { code: body.code, label: body.label, zone: body.zone });
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    return Response.json({ ok: true });
  });
}

export async function DELETE(request: NextRequest) {
  return withRole('worker', async () => {
    const sp = request.nextUrl.searchParams;
    const res = await deleteLocation(sp.get('warehouse') || '001', sp.get('code') || '');
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    return Response.json({ ok: true });
  });
}
