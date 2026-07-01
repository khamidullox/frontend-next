import { getSmartupLimitsFromFirestore } from '@/lib/smartup';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Возвращает лимиты Smartup из Firestore (+ in-memory этого instance).
// Данные накапливаются автоматически из обычных запросов приложения — без
// дополнительных вызовов к Smartup.
export async function GET() {
  return withRole('manager', async () => {
    const data = await getSmartupLimitsFromFirestore();
    return Response.json({ data });
  });
}
