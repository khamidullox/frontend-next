import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { setSessionCash, getSession as getCheckSession } from '@/lib/sessions';
import { setCashByDocId } from '@/lib/deliveries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Менеджер задаёт сумму к получению (наличные) для документа проверки. Значение
// хранится на сессии (пробросится в доставку при создании) и, если доставка по этому
// документу уже создана, проставляется ей сразу.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  return withRole('manager', async (user) => {
    const { sessionId } = await params;
    const body = await request.json().catch(() => ({}));
    const raw = body?.amount;
    const amount = raw == null || raw === '' ? null : Math.max(0, Number(raw) || 0);

    const session = await setSessionCash(sessionId, amount);
    if (!session) return Response.json({ error: 'Сессия проверки не найдена' }, { status: 404 });

    // Проброс в уже созданные доставки этого документа (если проверка завершена).
    const docId = session.document?.doc_id;
    let deliveriesUpdated = 0;
    if (docId) {
      deliveriesUpdated = await setCashByDocId(docId, amount, user.name || user.username).catch(() => 0);
    }
    return Response.json({ data: session, deliveries_updated: deliveriesUpdated });
  });
}

// На случай, если фронту удобнее GET текущего значения (не обязателен).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  return withRole('manager', async () => {
    const { sessionId } = await params;
    const session = await getCheckSession(sessionId);
    if (!session) return Response.json({ error: 'Сессия проверки не найдена' }, { status: 404 });
    return Response.json({ cash_amount: session.cash_amount ?? null });
  });
}
