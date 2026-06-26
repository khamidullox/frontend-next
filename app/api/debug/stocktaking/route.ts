import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth';
import { smartupRequest } from '@/lib/smartup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Разовая проверка: есть ли в Smartup инвентаризации (stocktaking) по складам наших
// магазинов и насколько свежие. По каждой возвращаем номер/дату/склад/статус/число
// позиций — чтобы понять, можно ли брать «Доступно нач.» из инвентаризации.
interface RawStItem { product_code?: string }
interface RawSt {
  stocktaking_id?: string; stocktaking_number?: string; stocktaking_date?: string;
  warehouse_code?: string; status?: string; filial_code?: string;
  stocktaking_items?: RawStItem[];
}

const dd = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

export async function GET(request: NextRequest) {
  return withRole('manager', async () => {
    const daysBack = Number(request.nextUrl.searchParams.get('days')) || 120;
    const begin = new Date(); begin.setDate(begin.getDate() - daysBack);
    const end = new Date();

    const data = await smartupRequest<{ stocktaking?: RawSt[] }>(
      '/b/anor/mxsx/mkw/stocktaking$export',
      { begin_stocktaking_date: dd(begin), end_stocktaking_date: dd(end) },
    );
    const list = data.stocktaking || [];

    const rows = list.map((s) => ({
      stocktaking_id: s.stocktaking_id,
      number: s.stocktaking_number,
      date: s.stocktaking_date,
      warehouse_code: s.warehouse_code,
      status: s.status,
      filial_code: s.filial_code,
      items: (s.stocktaking_items || []).length,
    })).sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const byWarehouse: Record<string, number> = {};
    for (const r of rows) byWarehouse[String(r.warehouse_code)] = (byWarehouse[String(r.warehouse_code)] || 0) + 1;

    return Response.json({ window_days: daysBack, total: rows.length, by_warehouse: byWarehouse, recent: rows.slice(0, 40) });
  });
}
