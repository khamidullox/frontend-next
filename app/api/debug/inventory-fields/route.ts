import { withRole } from '@/lib/auth';
import { smartupRequest } from '@/lib/smartup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const INVENTORY_EXPORT_ENDPOINT = '/b/anor/mxsx/mr/inventory$export';

// ВРЕМЕННЫЙ отладочный роут: показывает реальные поля товара из Smartup,
// чтобы понять, есть ли там вес/объём/единицы измерения (для логистики).
// Доступ — только админ. После изучения удалить.
export async function GET() {
  return withRole('admin', async () => {
    try {
      const data = await smartupRequest<{ inventory?: Record<string, unknown>[] }>(
        INVENTORY_EXPORT_ENDPOINT,
        {}
      );
      const list = data.inventory || [];
      const first = list[0] || {};

      // Ищем поля, похожие на вес/объём/единицы.
      const weightish = Object.keys(first).filter((k) =>
        /weight|volume|massa|hajm|ogirlik|netto|gross|measure|unit|pack|brutto|ves|obyom|kg|m3/i.test(k)
      );

      return Response.json({
        total: list.length,
        all_keys: Object.keys(first),
        weight_volume_candidates: weightish,
        // Полный первый товар — чтобы увидеть вложенные структуры (measures/units).
        sample: first,
      });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  });
}
