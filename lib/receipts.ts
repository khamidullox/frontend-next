import { smartupRequest } from './smartup';
import { getProductInfos, getWarehouseCodeMap } from './products';
import { CheckDocument, DocItem } from './document';
import { cached } from './cache';

// Приёмка / поступления товара на склад (Receipts to warehouse).
const INPUT_EXPORT_ENDPOINT = '/b/anor/mxsx/mkw/input$export';
const LIST_TTL_MS = 90 * 1000;

interface InputItem {
  product_code: string;
  quantity: string | number;
  input_item_id?: string;
  external_id?: string;
  [key: string]: unknown;
}

interface Input {
  input_id: string;
  input_number: string;
  input_time: string;
  status: string;
  warehouse_code: string | null;
  note: string | null;
  supplier_codes?: { supplier_code?: string }[];
  input_items: InputItem[];
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
  return { begin_input_date: fmt(begin), end_input_date: fmt(end) };
}

async function exportInputs(): Promise<Input[]> {
  const data = await smartupRequest<{ input?: Input[] }>(INPUT_EXPORT_ENDPOINT, dateRangeBody());
  return data.input || [];
}

function getAllInputs(): Promise<Input[]> {
  return cached('receipts:all', LIST_TTL_MS, exportInputs);
}

export interface ReceiptListItem {
  receipt_id: string;
  number: string;
  date: string;
  warehouse_name: string | null;
  status: string;
  items_count: number;
  total_quantity: number;
}

export async function listReceipts(): Promise<ReceiptListItem[]> {
  const [all, whMap] = await Promise.all([getAllInputs(), getWarehouseCodeMap()]);
  return all
    .map((r) => {
      const items = r.input_items || [];
      const code = r.warehouse_code ? String(r.warehouse_code).trim() : '';
      return {
        receipt_id: String(r.input_id),
        number: String(r.input_number || r.input_id),
        date: r.input_time,
        warehouse_name: code ? whMap.get(code) || code : null,
        status: r.status,
        items_count: items.length,
        total_quantity: items.reduce((s, it) => s + toNumber(it.quantity), 0),
      };
    })
    .sort((a, b) => b.receipt_id.localeCompare(a.receipt_id, undefined, { numeric: true }));
}

// Коды товаров, по которым была приёмка в загруженном окне (~последние 25 дней).
// Используется для пометки «новинка» в остатках склада. Дата приёмки из Smartup
// приходит в нестандартном формате — если не парсится, позицию оставляем (окно
// и так ограничено выгрузкой), лучше показать лишнюю новинку, чем пропустить.
export async function getRecentlyReceivedCodes(days = 30): Promise<string[]> {
  const all = await getAllInputs();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const codes = new Set<string>();
  for (const r of all) {
    const t = new Date(r.input_time).getTime();
    if (Number.isFinite(t) && t < cutoff) continue;
    for (const it of r.input_items || []) {
      const c = String(it.product_code ?? '').trim();
      if (c) codes.add(c);
    }
  }
  return [...codes];
}

export async function getReceiptDocument(receiptId: string): Promise<CheckDocument | null> {
  const all = await getAllInputs();
  const key = String(receiptId).trim();
  const r = all.find(
    (x) => String(x.input_id) === key || String(x.input_number ?? '') === key
  );
  if (!r) return null;

  const rawItems = r.input_items || [];
  const [infos, whMap] = await Promise.all([
    getProductInfos(rawItems.map((i) => i.product_code)),
    getWarehouseCodeMap(),
  ]);

  const items: DocItem[] = rawItems.map((item, index) => {
    const info = infos.get(String(item.product_code).trim());
    return {
      product_code: String(item.product_code ?? '').trim(),
      product_name: info?.name || info?.short_name || '',
      quantity: toNumber(item.quantity),
      barcodes: info?.barcodes || [],
      line_id:
        String(item.input_item_id ?? '').trim() ||
        String(item.external_id ?? '').trim() ||
        `${item.product_code}-${index}`,
    };
  });

  const code = r.warehouse_code ? String(r.warehouse_code).trim() : '';
  const whName = code ? whMap.get(code) || code : null;

  return {
    doc_type: 'receipt',
    doc_id: String(r.input_id),
    doc_number: String(r.input_number || r.input_id),
    date: r.input_time,
    from_warehouse_code: null,
    to_warehouse_code: r.warehouse_code,
    client_name: whName ? `Поступление на ${whName}` : null,
    note: r.note,
    items,
  };
}
