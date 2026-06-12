import { smartupRequest } from './smartup';
import { getProductInfos } from './products';
import { CheckDocument, DocItem } from './document';
import { cached } from './cache';

// Межфилиальные перемещения (между складами/филиалами).
// В отличие от внутренних накладных, тут заполнены филиалы «откуда → куда».
const TRANSFER_EXPORT_ENDPOINT = '/b/anor/mxsx/mfm/movement$export';
const LIST_TTL_MS = 90 * 1000;

interface TransferItem {
  product_code: string;
  quantity: string | number;
  movement_unit_id?: string;
  external_id?: string;
  [key: string]: unknown;
}

interface Transfer {
  movement_id: string;
  from_filial_code: string | null;
  to_filial_code: string | null;
  from_warehouse_code: string | null;
  to_warehouse_code: string | null;
  from_time: string;
  to_time: string;
  delivery_number: string | null;
  barcode: string | null;
  note: string | null;
  status: string;
  movement_items: TransferItem[];
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// Smartup требует диапазон дат; берём широкое окно (лимит day_range 30).
function dateRangeBody(): Record<string, unknown> {
  const end = new Date();
  const begin = new Date(Date.now() - 25 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  return { begin_date: fmt(begin), end_date: fmt(end) };
}

async function exportTransfers(): Promise<Transfer[]> {
  const data = await smartupRequest<{ movement?: Transfer[] }>(
    TRANSFER_EXPORT_ENDPOINT,
    dateRangeBody()
  );
  return data.movement || [];
}

function getAllTransfers(): Promise<Transfer[]> {
  return cached('transfers:all', LIST_TTL_MS, exportTransfers);
}

export interface TransferListItem {
  transfer_id: string;
  number: string;
  date: string;
  from_filial: string | null;
  to_filial: string | null;
  status: string;
  items_count: number;
  total_quantity: number;
}

// Статусы межфилиального перемещения: C-завершено (показываем остальные)
export async function listTransfers(): Promise<TransferListItem[]> {
  const all = await getAllTransfers();
  return all
    .filter((t) => t.status !== 'C')
    .map((t) => {
      const items = t.movement_items || [];
      return {
        transfer_id: String(t.movement_id),
        number: String(t.delivery_number || t.movement_id),
        date: t.from_time,
        from_filial: t.from_filial_code,
        to_filial: t.to_filial_code,
        status: t.status,
        items_count: items.length,
        total_quantity: items.reduce((s, it) => s + toNumber(it.quantity), 0),
      };
    })
    .sort((a, b) => b.transfer_id.localeCompare(a.transfer_id, undefined, { numeric: true }));
}

export async function getTransferDocument(transferId: string): Promise<CheckDocument | null> {
  const all = await getAllTransfers();
  const key = String(transferId).trim();
  const t = all.find(
    (x) => String(x.movement_id) === key || String(x.delivery_number ?? '') === key
  );
  if (!t) return null;

  const rawItems = t.movement_items || [];
  const infos = await getProductInfos(rawItems.map((i) => i.product_code));

  const items: DocItem[] = rawItems.map((item, index) => {
    const info = infos.get(String(item.product_code).trim());
    return {
      product_code: String(item.product_code ?? '').trim(),
      product_name: info?.name || info?.short_name || '',
      quantity: toNumber(item.quantity),
      barcodes: info?.barcodes || [],
      line_id:
        String(item.movement_unit_id ?? '').trim() ||
        String(item.external_id ?? '').trim() ||
        `${item.product_code}-${index}`,
    };
  });

  const route =
    [t.from_filial_code, t.to_filial_code].filter(Boolean).join(' → ') || null;

  return {
    doc_type: 'transfer',
    doc_id: String(t.movement_id),
    doc_number: String(t.delivery_number || t.movement_id),
    date: t.from_time,
    from_warehouse_code: t.from_filial_code,
    to_warehouse_code: t.to_filial_code,
    client_name: route,
    note: t.note,
    items,
  };
}
