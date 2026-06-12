import { smartupRequest } from './smartup';
import { getProductInfos } from './products';
import { CheckDocument, DocItem } from './document';
import { cached } from './cache';

// Возвраты (поставщику). return_items с product_code/quantity.
const RETURN_EXPORT_ENDPOINT = '/b/anor/mxsx/mkw/return$export';
const LIST_TTL_MS = 90 * 1000;

interface ReturnItem {
  product_code: string;
  quantity: string | number;
  return_item_id?: string;
  external_id?: string;
  [key: string]: unknown;
}

interface Return {
  return_id: string;
  return_number: string;
  return_time: string;
  warehouse_code: string | null;
  supplier_code: string | null;
  note: string | null;
  status: string;
  return_items: ReturnItem[];
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dateRangeBody(): Record<string, unknown> {
  const end = new Date();
  const begin = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  return { begin_date: fmt(begin), end_date: fmt(end) };
}

async function exportReturns(): Promise<Return[]> {
  const data = await smartupRequest<{ return?: Return[] }>(
    RETURN_EXPORT_ENDPOINT,
    dateRangeBody()
  );
  return data.return || [];
}

function getAllReturns(): Promise<Return[]> {
  return cached('returns:all', LIST_TTL_MS, exportReturns);
}

export interface ReturnListItem {
  return_id: string;
  number: string;
  date: string;
  supplier_code: string | null;
  status: string;
  items_count: number;
  total_quantity: number;
}

export async function listReturns(): Promise<ReturnListItem[]> {
  const all = await getAllReturns();
  return all
    .filter((r) => r.status !== 'C')
    .map((r) => {
      const items = r.return_items || [];
      return {
        return_id: String(r.return_id),
        number: String(r.return_number || r.return_id),
        date: r.return_time,
        supplier_code: r.supplier_code,
        status: r.status,
        items_count: items.length,
        total_quantity: items.reduce((s, it) => s + toNumber(it.quantity), 0),
      };
    })
    .sort((a, b) => b.return_id.localeCompare(a.return_id, undefined, { numeric: true }));
}

export async function getReturnDocument(returnId: string): Promise<CheckDocument | null> {
  const all = await getAllReturns();
  const key = String(returnId).trim();
  const r = all.find(
    (x) => String(x.return_id) === key || String(x.return_number ?? '') === key
  );
  if (!r) return null;

  const rawItems = r.return_items || [];
  const infos = await getProductInfos(rawItems.map((i) => i.product_code));

  const items: DocItem[] = rawItems.map((item, index) => {
    const info = infos.get(String(item.product_code).trim());
    return {
      product_code: String(item.product_code ?? '').trim(),
      product_name: info?.name || info?.short_name || '',
      quantity: toNumber(item.quantity),
      barcodes: info?.barcodes || [],
      line_id:
        String(item.return_item_id ?? '').trim() ||
        String(item.external_id ?? '').trim() ||
        `${item.product_code}-${index}`,
    };
  });

  return {
    doc_type: 'return',
    doc_id: String(r.return_id),
    doc_number: String(r.return_number || r.return_id),
    date: r.return_time,
    from_warehouse_code: r.warehouse_code,
    to_warehouse_code: null,
    client_name: r.supplier_code,
    note: r.note,
    items,
  };
}
