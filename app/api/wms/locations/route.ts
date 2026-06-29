import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { listLocations, createLocation, deleteLocation } from '@/lib/wms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return withRole('worker', async () => Response.json({ data: await listLocations() }));
}

export async function POST(request: NextRequest) {
  return withRole('worker', async () => {
    const body = await request.json().catch(() => ({}));
    const res = await createLocation({ code: body.code, label: body.label, zone: body.zone });
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    return Response.json({ ok: true });
  });
}

export async function DELETE(request: NextRequest) {
  return withRole('worker', async () => {
    const code = request.nextUrl.searchParams.get('code') || '';
    const res = await deleteLocation(code);
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 });
    return Response.json({ ok: true });
  });
}
