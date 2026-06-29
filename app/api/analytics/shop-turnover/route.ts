import { NextRequest } from 'next/server';
import { getSession, ROLE_RANK } from '@/lib/auth';
import { getShopTurnover } from '@/lib/shopAnalytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET(request: NextRequest) {
  const s = await getSession();
  if (!s) return Response.json({ error: 'Не авторизован' }, { status: 401 });
  if (ROLE_RANK[s.role] < ROLE_RANK['manager']) {
    return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  }
  const sp = request.nextUrl.searchParams;
  const today = isoDate(new Date());
  let from = sp.get('from') || '';
  let to = sp.get('to') || '';
  if (!ISO_RE.test(from) || !ISO_RE.test(to)) {
    // Фолбэк — последние 7 дней по сегодня.
    const d = new Date(); d.setDate(d.getDate() - 6);
    from = isoDate(d); to = today;
  }
  if (from > to) [from, to] = [to, from];
  const shop = sp.get('shop') || '';
  try {
    const data = await getShopTurnover(from, to);
    const nameByCode = new Map(data.shops.map((s) => [s.code, s.name]));

    // По каждому товару — в каких ЕЩЁ магазинах он лежит в остатке, но продаётся слабо
    // (низкая оборачиваемость). Это «доноры» для перекидки: там есть запас, а продаж нет.
    const WEAK_TURNOVER = 0.6; // ≤ 60% продано от базы — продаётся плохо/пассивно
    const byProduct = new Map<string, { code: string; sold: number; stock: number }[]>();
    for (const r of data.rows) {
      if (r.stock <= 0) continue;
      const base = r.stock + r.sold_qty;
      const turn = base > 0 ? r.sold_qty / base : 0;
      if (turn > WEAK_TURNOVER) continue; // там продаётся хорошо — не донор
      const arr = byProduct.get(r.product_code) || [];
      arr.push({ code: r.shop_code, sold: r.sold_qty, stock: r.stock });
      byProduct.set(r.product_code, arr);
    }

    const rows = shop
      ? data.rows.filter((r) => r.shop_code === shop).map((r) => {
          const surplus = (byProduct.get(r.product_code) || [])
            .filter((x) => x.code !== shop)
            .sort((a, b) => b.stock - a.stock)
            .slice(0, 8)
            .map((x) => ({ code: x.code, name: nameByCode.get(x.code) || x.code, sold: x.sold, stock: x.stock }));
          return { ...r, surplus };
        })
      : [];
    return Response.json({ data: { from: data.from, to: data.to, updated_ms: data.updated_ms, history_from: data.history_from, shops: data.shops, rows } });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
