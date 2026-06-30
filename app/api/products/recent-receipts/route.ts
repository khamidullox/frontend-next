import { getSession } from '@/lib/auth';
import { getRecentlyReceivedCodes } from '@/lib/receipts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Коды товаров с недавней приёмкой — для пометки «новинка» в остатках склада.
// Окно «новинки» — 4 дня (товар считается новинкой 3–4 дня после прихода).
export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });
  return Response.json({ codes: await getRecentlyReceivedCodes(4) });
}
