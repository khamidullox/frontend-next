import { smartupRequest } from './smartup';
import { getProductInfos } from './products';
import { CheckDocument, DocItem } from './document';

const ORDER_EXPORT_ENDPOINT = '/b/trade/txs/tdeal/order$export';
const TRADE_PROJECT = 'trade';

function normalizeCode(value: unknown): string {
  return String(value ?? '').trim();
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

interface RawOrderProduct {
  external_id?: string | null;
  product_unit_id?: string;
  product_code?: string;
  product_name?: string;
  product_barcode?: string;
  order_quant?: string | number;
}

interface RawOrder {
  deal_id: string;
  external_id: string | null;
  filial_code: string;
  deal_time?: string;
  delivery_date?: string;
  delivery_number?: string;
  invoice_number?: string;
  person_name?: string;
  person_code?: string;
  room_name?: string;
  note?: string | null;
  deal_note?: string | null;
  status?: string;
  order_products?: RawOrderProduct[];
}

function formatSmartupDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

async function exportOrders(body: Record<string, unknown>): Promise<RawOrder[]> {
  const data = await smartupRequest<{ order?: RawOrder[] }>(
    ORDER_EXPORT_ENDPOINT,
    body,
    2,
    TRADE_PROJECT
  );
  return data.order || [];
}

// Один заказ по deal_id (Smartup фильтрует на своей стороне — быстро).
export async function getOrderDocument(dealId: string): Promise<CheckDocument | null> {
  const orders = await exportOrders({ deal_id: dealId });
  const order = orders[0];
  if (!order) return null;

  const rawItems = order.order_products || [];

  // Реальные штрихкоды (EAN-13 и вшитые в название) берём из нашего справочника
  // в Firestore по коду товара — в заказе есть только авто-штрихкод.
  const infos = await getProductInfos(rawItems.map((i) => i.product_code || ''));

  const items: DocItem[] = rawItems.map((item, index) => {
    const code = normalizeCode(item.product_code);
    const info = infos.get(code);
    const barcodes = new Set<string>();
    if (item.product_barcode) barcodes.add(normalizeCode(item.product_barcode));
    for (const bc of info?.barcodes || []) barcodes.add(bc);

    return {
      product_code: code,
      product_name: item.product_name || info?.name || '',
      quantity: toNumber(item.order_quant),
      barcodes: [...barcodes].filter(Boolean),
      line_id:
        normalizeCode(item.product_unit_id) ||
        normalizeCode(item.external_id) ||
        `${code}-${index}`,
    };
  });

  return {
    doc_type: 'order',
    doc_id: String(order.deal_id),
    doc_number: String(order.delivery_number || order.invoice_number || order.deal_id),
    date: order.delivery_date || order.deal_time || '',
    from_warehouse_code: null,
    to_warehouse_code: order.room_name || null,
    client_name: order.person_name || null,
    note: order.deal_note || order.note || null,
    items,
  };
}

// Поиск заказа по номеру ТТН (delivery_number) или счёта (invoice_number).
// Smartup не фильтрует по этим полям, поэтому тянем заказы за период и ищем локально.
export async function getOrderDocumentByTTN(ttn: string): Promise<CheckDocument | null> {
  const needle = normalizeCode(ttn);
  if (!needle) return null;

  const end = new Date();
  const begin = new Date(end);
  begin.setDate(begin.getDate() - 6);

  const orders = await exportOrders({
    begin_order_date: formatSmartupDate(begin),
    end_order_date: formatSmartupDate(end),
  });

  const match = orders.find(
    (o) =>
      normalizeCode(o.delivery_number) === needle ||
      normalizeCode(o.invoice_number) === needle
  );

  if (!match) return null;

  // Дотягиваем полный заказ по deal_id (с обогащением штрихкодов).
  return getOrderDocument(String(match.deal_id));
}

export interface OrderListItem {
  deal_id: string;
  doc_number: string;
  date: string;
  client_name: string;
  items_count: number;
  total_quantity: number;
}

// Лёгкий список заказов за период, который отдаёт Smartup (~7 дней).
export async function listOrders(): Promise<OrderListItem[]> {
  const end = new Date();
  const begin = new Date(end);
  begin.setDate(begin.getDate() - 6);

  const orders = await exportOrders({
    begin_order_date: formatSmartupDate(begin),
    end_order_date: formatSmartupDate(end),
  });

  return orders
    .map((o) => {
      const items = o.order_products || [];
      return {
        deal_id: String(o.deal_id),
        doc_number: String(o.delivery_number || o.invoice_number || o.deal_id),
        date: o.delivery_date || o.deal_time || '',
        client_name: o.person_name || '',
        items_count: items.length,
        total_quantity: items.reduce((s, it) => s + toNumber(it.order_quant), 0),
      };
    })
    .sort((a, b) => b.deal_id.localeCompare(a.deal_id, undefined, { numeric: true }));
}
