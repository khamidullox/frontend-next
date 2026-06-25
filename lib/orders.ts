import { smartupRequest } from './smartup';
import { getProductInfos } from './products';
import { CheckDocument, DocItem } from './document';
import { cached } from './cache';

const ORDER_EXPORT_ENDPOINT = '/b/trade/txs/tdeal/order$export';
const TRADE_PROJECT = 'trade';
const LIST_TTL_MS = 90 * 1000;

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
  person_id?: string;
  person_name?: string;
  person_code?: string;
  person_latitude?: string | number | null;
  person_longitude?: string | number | null;
  delivery_address_full?: string | null;
  delivery_address_short?: string | null;
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
// Выгрузка всех заказов за период, кэшируется на 90с (тяжёлая, ~12 МБ).
// Используется и списком, и поиском по ТТН — оба берут из одного кэша.
async function getAllOrders(): Promise<RawOrder[]> {
  return cached('orders:all', LIST_TTL_MS, () => {
    const end = new Date();
    const begin = new Date(end);
    begin.setDate(begin.getDate() - 6);
    return exportOrders({
      begin_order_date: formatSmartupDate(begin),
      end_order_date: formatSmartupDate(end),
    });
  });
}

export async function getOrderDocumentByTTN(ttn: string): Promise<CheckDocument | null> {
  const needle = normalizeCode(ttn);
  if (!needle) return null;

  const orders = await getAllOrders();

  const match = orders.find(
    (o) =>
      normalizeCode(o.delivery_number) === needle ||
      normalizeCode(o.invoice_number) === needle
  );

  if (!match) return null;

  // Дотягиваем полный заказ по deal_id (с обогащением штрихкодов).
  return getOrderDocument(String(match.deal_id));
}

export interface SalesAggregate {
  total_qty: number;
  total_orders: number;
  by_shop: { shop: string; qty: number; orders: number; products: number }[];
  by_product: { code: string; name: string; qty: number; orders: number }[];
}

// Продажи (заказы клиентам) за произвольный период — для аналитики. person_name —
// это и есть магазин/клиент, которому продали (в order$export нет отдельного «магазина»,
// заказы — это и есть факт продажи). Не кэшируется здесь (90с слишком мало для
// аналитики за месяц) — кэш более долгий держит lib/analytics.ts поверх этой функции.
export async function getSalesAggregate(begin: Date, end: Date): Promise<SalesAggregate> {
  const orders = await exportOrders({
    begin_order_date: formatSmartupDate(begin),
    end_order_date: formatSmartupDate(end),
  });

  const shopMap = new Map<string, { qty: number; orders: number; products: Set<string> }>();
  const productMap = new Map<string, { name: string; qty: number; orders: Set<string> }>();
  let total_qty = 0;

  for (const o of orders) {
    const shop = o.person_name?.trim() || 'Без названия';
    const sAgg = shopMap.get(shop) || { qty: 0, orders: 0, products: new Set<string>() };
    sAgg.orders++;
    for (const item of o.order_products || []) {
      const code = normalizeCode(item.product_code);
      if (!code) continue;
      const qty = toNumber(item.order_quant);
      total_qty += qty;
      sAgg.qty += qty;
      sAgg.products.add(code);

      const pAgg = productMap.get(code) || { name: item.product_name || '', qty: 0, orders: new Set<string>() };
      pAgg.qty += qty;
      pAgg.orders.add(String(o.deal_id));
      if (item.product_name) pAgg.name = item.product_name;
      productMap.set(code, pAgg);
    }
    shopMap.set(shop, sAgg);
  }

  return {
    total_qty,
    total_orders: orders.length,
    by_shop: [...shopMap.entries()]
      .map(([shop, v]) => ({ shop, qty: v.qty, orders: v.orders, products: v.products.size }))
      .sort((a, b) => b.qty - a.qty),
    by_product: [...productMap.entries()]
      .map(([code, v]) => ({ code, name: v.name, qty: v.qty, orders: v.orders.size }))
      .sort((a, b) => b.qty - a.qty),
  };
}

export interface ClientAddressStatus {
  person_id: string;
  person_name: string;
  has_address: boolean;   // координаты (lat/lng) или текстовый адрес есть хотя бы в одном заказе
  address: string;        // последний известный непустой адрес (full || short)
  lat: number | null;
  lng: number | null;
  orders_count: number;
  last_order_date: string;
}

// По каждому клиенту (person_id, из заказов за последние 6 дней — тот же охват, что
// у listOrders) смотрим, есть ли у него адрес/координаты доставки в Smartup. Берём
// самые свежие непустые значения, если в разных заказах они отличаются.
export async function listClientAddressStatus(): Promise<ClientAddressStatus[]> {
  const orders = await getAllOrders();
  const byClient = new Map<string, ClientAddressStatus>();

  for (const o of orders) {
    const id = normalizeCode(o.person_id) || normalizeCode(o.person_name);
    if (!id) continue;
    const lat = o.person_latitude != null && o.person_latitude !== '' ? Number(o.person_latitude) : null;
    const lng = o.person_longitude != null && o.person_longitude !== '' ? Number(o.person_longitude) : null;
    const address = normalizeCode(o.delivery_address_full) || normalizeCode(o.delivery_address_short);
    const date = o.delivery_date || o.deal_time || '';

    const cur = byClient.get(id) || {
      person_id: id,
      person_name: o.person_name || id,
      has_address: false,
      address: '',
      lat: null,
      lng: null,
      orders_count: 0,
      last_order_date: '',
    };
    cur.orders_count++;
    if (date > cur.last_order_date) cur.last_order_date = date;
    if (Number.isFinite(lat) && Number.isFinite(lng)) { cur.lat = lat; cur.lng = lng; }
    if (address) cur.address = address;
    if ((Number.isFinite(lat) && Number.isFinite(lng)) || address) cur.has_address = true;
    byClient.set(id, cur);
  }

  return [...byClient.values()].sort((a, b) => a.person_name.localeCompare(b.person_name, 'ru'));
}

export interface OrderListItem {
  deal_id: string;
  doc_number: string;
  date: string;
  client_name: string;
  items_count: number;
  total_quantity: number;
}

// Лёгкий список заказов за период (из кэша).
export async function listOrders(): Promise<OrderListItem[]> {
  const orders = await getAllOrders();

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
