import { NextRequest } from 'next/server';
import { scanBarcode } from '@/lib/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json().catch(() => ({}));
    const barcode = body?.barcode;

    if (!barcode) {
      return Response.json({ error: 'barcode обязателен' }, { status: 400 });
    }

    const result = await scanBarcode(sessionId, barcode);

    if (!result) {
      return Response.json({ error: 'Сессия проверки не найдена' }, { status: 404 });
    }

    return Response.json(result);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
