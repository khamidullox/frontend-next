// Бэкенд теперь — это API-роуты самого Next.js (тот же домен).
const API_BASE = '/api/invoice-check';

// ─── Types ───────────────────────────────────────────

export type ItemStatus = 'pending' | 'partial' | 'done';
export type ScanStatus = 'done' | 'partial' | 'over_scanned' | 'not_found' | 'manual';

export interface SessionItem {
  id: string;
  product_code: string;
  product_name: string;
  quantity: number;
  scanned_quantity: number;
  status: ItemStatus;
  barcodes: string[];
}

export type DocType = 'movement' | 'order' | 'transfer' | 'receipt';

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  movement: 'Накладная',
  order: 'Заказ',
  transfer: 'Перемещение',
  receipt: 'Приёмка',
};

export interface SessionDocument {
  doc_type: DocType;
  doc_id: string;
  doc_number: string;
  date: string;
  from_warehouse_code: string | null;
  to_warehouse_code: string | null;
  client_name: string | null;
  note: string | null;
}

export interface SessionSummary {
  total: number;
  scanned: number;
  done_items: number;
  total_items: number;
}

export type SessionStatus = 'active' | 'finished';

export interface Session {
  id: string;
  created_at: string;
  finished_at?: string | null;
  status: SessionStatus;
  checker_name: string;
  document: SessionDocument;
  items: SessionItem[];
  summary: SessionSummary;
  scans: ScanRecord[];
}

export interface SessionListItem {
  id: string;
  created_at: string;
  finished_at?: string | null;
  status: SessionStatus;
  checker_name: string;
  doc_type: DocType;
  doc_id: string;
  doc_number: string;
  summary: SessionSummary;
}

export interface MovementListItem {
  movement_id: string;
  movement_number: string;
  from_movement_date: string;
  filial_code: string;
  from_warehouse_code: string | null;
  to_warehouse_code: string | null;
  from_warehouse_name: string | null;
  to_warehouse_name: string | null;
  status: string;
  items_count: number;
  total_quantity: number;
}

// Статусы накладных Smartup: D-черновик N-новый S-ждёт отгрузку R-ждёт поступление T-в пути C-завершено
export const MOVEMENT_STATUS_LABEL: Record<string, string> = {
  D: 'Черновик',
  N: 'Новый',
  S: 'Ждёт отгрузку',
  R: 'Ждёт поступление',
  T: 'В пути',
  C: 'Завершено',
};

export interface OrderListItem {
  deal_id: string;
  doc_number: string;
  date: string;
  client_name: string;
  items_count: number;
  total_quantity: number;
}

export interface ScanRecord {
  barcode: string;
  product_code: string;
  scanned_at: string;
  status: ScanStatus;
  message: string;
  item_id?: string;
}

export interface ScanResult {
  scan: ScanRecord;
  session: Session;
}

// ─── API calls ───────────────────────────────────────

export async function createSession(filters: Record<string, string>): Promise<Session> {
  const res = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filters),
  });

  if (res.status === 404) {
    throw new NotFoundError('Накладная не найдена в Smartup');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Ошибка сервера: ${res.status}`);
  }

  return res.json();
}

export async function getSession(sessionId: string): Promise<Session> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`);
  if (res.status === 404) throw new NotFoundError('Сессия не найдена');
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  return res.json();
}

export async function scanBarcode(sessionId: string, barcode: string): Promise<ScanResult> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ barcode }),
  });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  return res.json();
}

export interface SetQuantityResult {
  item_id: string;
  session: Session;
}

export async function setItemQuantity(
  sessionId: string,
  itemId: string,
  quantity: number
): Promise<SetQuantityResult> {
  const res = await fetch(
    `${API_BASE}/sessions/${sessionId}/items/${itemId}/quantity`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity }),
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Ошибка сервера: ${res.status}`);
  }
  return res.json();
}

export async function finishSession(sessionId: string): Promise<Session> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/finish`, {
    method: 'POST',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Ошибка сервера: ${res.status}`);
  }
  return res.json();
}

export async function listSessions(): Promise<SessionListItem[]> {
  const res = await fetch(`${API_BASE}/sessions`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

export async function listMovements(): Promise<MovementListItem[]> {
  const res = await fetch('/api/movements', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

export async function listOrders(): Promise<OrderListItem[]> {
  const res = await fetch('/api/orders', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data || [];
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

export async function listTransfers(): Promise<TransferListItem[]> {
  const res = await fetch('/api/transfers', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data || [];
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
  const res = await fetch('/api/receipts', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

export interface CatalogItem {
  code: string;
  name: string;
  producer: string;
  group: string;
  barcodes: string[];
}

export async function listProducts(): Promise<CatalogItem[]> {
  const res = await fetch('/api/products', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

export interface StockRow {
  warehouse_name: string;
  quantity: number;
}

export interface ProductStock {
  rows: StockRow[];
  total: number;
  input_price: number;
}

export async function getProductStock(code: string): Promise<ProductStock> {
  const res = await fetch(`/api/products/${encodeURIComponent(code)}/stock`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  return res.json();
}

export interface WarehouseSummary {
  warehouse_id: string;
  warehouse_name: string;
  products_count: number;
  total_quantity: number;
}

export async function listWarehouses(): Promise<WarehouseSummary[]> {
  const res = await fetch('/api/warehouses', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

export interface WarehouseProduct {
  product_code: string;
  product_name: string;
  producer: string;
  group: string;
  quantity: number;
}

export interface WarehouseStock {
  warehouse_id: string;
  warehouse_name: string;
  rows: WarehouseProduct[];
  total: number;
}

export async function getWarehouseStock(id: string): Promise<WarehouseStock> {
  const res = await fetch(`/api/warehouses/${encodeURIComponent(id)}/stock`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  return res.json();
}

export async function getStockUpdated(): Promise<number | null> {
  const res = await fetch('/api/stock-updated', { cache: 'no-store' });
  if (!res.ok) return null;
  const data = await res.json();
  return data.updated_ms ?? null;
}

export interface SmartupLimit {
  endpoint: string;
  left: number | null;
  total: number | null;
  seen_at: string;
}

export async function getSmartupLimits(): Promise<SmartupLimit[]> {
  const res = await fetch('/api/smartup-limits', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
