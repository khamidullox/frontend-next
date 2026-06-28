import { listShops } from '@/lib/shops';
import { haversineKm } from '@/lib/geo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Временная проверка расчёта км: координаты магазина 5504 и складов-баз (001/002),
// и расстояние по прямой между ними (как считает приложение).
export async function GET() {
  const shops = await listShops();
  const find = (q: string) => shops.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()))
    .map((s) => ({ name: s.name, lat: s.lat ?? null, lng: s.lng ?? null, km_field: s.km, type: s.type }));

  const dest = find('5504')[0];
  const bases = [...find('001'), ...find('002'), ...find('основной'), ...find('ёрдамчи'), ...find('ердамчи')];

  const pairs = dest && dest.lat != null && dest.lng != null
    ? bases.filter((b) => b.lat != null && b.lng != null).map((b) => ({
        from: b.name, to: dest.name,
        straight_km: Math.round(haversineKm(b.lat as number, b.lng as number, dest.lat as number, dest.lng as number) * 100) / 100,
      }))
    : [];

  return Response.json({ dest, bases, pairs }, { headers: { 'cache-control': 'no-store' } });
}
