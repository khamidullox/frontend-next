import { getSmartupLimits } from '@/lib/smartup';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Возвращает последние виденные лимиты Smartup (без обращения к Smartup —
// данные накапливаются из обычных запросов приложения).
export async function GET() {
  return withRole('manager', async () => Response.json({ data: getSmartupLimits() }));
}
