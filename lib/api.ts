// Бэкенд теперь — это API-роуты самого Next.js (тот же домен).
const API_BASE = '/api/invoice-check';

// ─── Авторизация ─────────────────────────────────────
export type Role = 'driver' | 'worker' | 'manager' | 'admin';
export const ROLE_RANK: Record<Role, number> = { driver: 1, worker: 1, manager: 2, admin: 3 };
export const ROLE_LABEL: Record<Role, string> = {
  driver: 'Водитель', worker: 'Магазин', manager: 'Менеджер', admin: 'Админ',
};

export interface UserSession {
  username: string;
  name: string;
  role: Role;
  warehouses: string[];
  shop_id?: string;
}

export interface MeResult {
  session: UserSession | null;
  setup_needed?: boolean;
}

export async function getMe(): Promise<MeResult> {
  const res = await fetch('/api/auth/me', { cache: 'no-store' });
  if (!res.ok) return { session: null };
  return res.json();
}

export async function login(username: string, password: string): Promise<UserSession> {
  const res = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка входа');
  return data as UserSession;
}

export async function setupAdmin(username: string, name: string, password: string): Promise<void> {
  const res = await fetch('/api/auth/setup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, name, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка настройки');
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}

export interface UserInfo {
  username: string;
  name: string;
  role: Role;
  created_at: string;
  warehouses: string[];
  car_number: string;
  transport: string;
  capacity_m3: number;
  capacity_kg: number;
  direction: string;
  shop_id: string;
}

export async function listUsers(): Promise<UserInfo[]> {
  const res = await fetch('/api/users', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

export async function createUser(input: {
  username: string; name: string; role: Role; password: string; warehouses?: string[];
  car_number?: string; transport?: string; capacity_m3?: number; capacity_kg?: number; direction?: string;
  shop_id?: string;
}): Promise<void> {
  const res = await fetch('/api/users', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка создания');
}

export async function deleteUserApi(username: string): Promise<void> {
  const res = await fetch(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка удаления');
}

export async function setUserPassword(username: string, password: string): Promise<void> {
  const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка смены пароля');
}

export async function setUserWarehouses(username: string, warehouses: string[]): Promise<void> {
  const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ warehouses }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка сохранения складов');
}

// Единое обновление пользователя из модалки (пароль / склады / профиль водителя).
export async function updateUser(username: string, patch: {
  password?: string; warehouses?: string[]; car_number?: string; transport?: string;
  capacity_m3?: number; capacity_kg?: number; direction?: string; shop_id?: string;
}): Promise<void> {
  const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка сохранения');
}

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
  client_name: string | null;
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

export async function deleteSessionApi(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка удаления');
}

export async function setSessionStatusApi(sessionId: string, status: SessionStatus): Promise<Session> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка изменения статуса');
  return data as Session;
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
  price: number;
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
  wholesale_price: number;
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

// Для ценников: менеджер/админ видят все склады, магазин — только свои без основных.
export async function listWarehousesForTags(): Promise<WarehouseSummary[]> {
  const res = await fetch('/api/warehouses?for=tags', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

// Все склады (для настройки пользователя): менеджер/админ — полный список.
export async function listAllWarehouses(): Promise<WarehouseSummary[]> {
  const res = await fetch('/api/warehouses?for=all', { cache: 'no-store' });
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
  price: number;
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

// ─── Логистика: доставки ─────────────────────────────

export type DeliveryStatus = 'new' | 'assigned' | 'on_way' | 'delivered' | 'returned';

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  new: 'Новый',
  assigned: 'Назначен',
  on_way: 'В пути',
  delivered: 'Доставлено',
  returned: 'Возврат',
};

export type DeliverySource = 'document' | 'session' | 'manual';
export type DeliveryKind = 'warehouse_dispatch' | 'shop_to_client';

export interface Delivery {
  id: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  source: DeliverySource;
  kind: DeliveryKind;
  doc_type: DocType | null;
  doc_id: string | null;
  doc_number: string | null;
  client_name: string;
  address: string;
  note: string;
  from_name: string | null;
  to_name: string | null;
  shop_id: string | null;
  shop_name: string | null;
  total_weight: number;
  total_volume_l: number;
  total_qty: number;
  direction: string;
  km: number;
  driver_username: string | null;
  driver_name: string | null;
  car_number: string | null;
  transport: string | null;
  route_id: string | null;
  status: DeliveryStatus;
  history: { at: string; status: DeliveryStatus; by: string }[];
}

export async function listDeliveries(): Promise<Delivery[]> {
  const res = await fetch('/api/deliveries', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

export async function createDelivery(input: {
  query?: string;
  movement_id?: string;
  deal_id?: string;
  transfer_id?: string;
  receipt_id?: string;
  session_id?: string;
  client_name?: string;
  address?: string;
  note?: string;
  direction?: string;
  km?: number;
  driver_username?: string;
  external_driver?: string;
  external_car?: string;
}): Promise<Delivery> {
  const res = await fetch('/api/deliveries', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка создания доставки');
  return data.data as Delivery;
}

export async function updateDelivery(
  id: string,
  patch: { status?: DeliveryStatus; driver_username?: string | null; client_name?: string; address?: string; note?: string; direction?: string; km?: number }
): Promise<Delivery> {
  const res = await fetch(`/api/deliveries/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка изменения доставки');
  return data.data as Delivery;
}

export async function autoAssign(): Promise<{ assigned: number; skipped: number }> {
  const res = await fetch('/api/logistics/auto-assign', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка автораспределения');
  return data.data as { assigned: number; skipped: number };
}

export interface LogisticsSettings { fuel_rate_per_km: number; }

export async function fetchLogisticsSettings(): Promise<LogisticsSettings> {
  const res = await fetch('/api/logistics/settings', { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  return (data.data as LogisticsSettings) || { fuel_rate_per_km: 0 };
}

export async function saveLogisticsSettings(s: Partial<LogisticsSettings>): Promise<void> {
  await fetch('/api/logistics/settings', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  });
}

export async function deleteDeliveryApi(id: string): Promise<void> {
  const res = await fetch(`/api/deliveries/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка удаления');
}

export async function listDrivers(): Promise<UserInfo[]> {
  const res = await fetch('/api/drivers', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

// ─── Логистика: справочник точек доставки (магазины/адреса) ───────────────────
export const DIRECTIONS = ['Север', 'Юг', 'Восток', 'Запад', 'Центр'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export type ShopType = 'warehouse' | 'shop';

export interface Shop {
  id: string;
  name: string;
  address: string;
  direction: Direction;
  km: number;
  phone: string;
  lat?: number;
  lng?: number;
  type?: ShopType;
  created_at: string;
}

export async function listShops(): Promise<Shop[]> {
  const res = await fetch('/api/shops', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

export async function createShop(input: {
  name: string; address?: string; direction?: string; km?: number; phone?: string;
  lat?: number; lng?: number; type?: ShopType;
}): Promise<Shop> {
  const res = await fetch('/api/shops', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка создания');
  return data.data as Shop;
}

export async function updateShop(
  id: string,
  patch: { name?: string; address?: string; direction?: string; km?: number; phone?: string }
): Promise<Shop> {
  const res = await fetch(`/api/shops/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка изменения');
  return data.data as Shop;
}

export async function deleteShopApi(id: string): Promise<void> {
  const res = await fetch(`/api/shops/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка удаления');
}

// ─── Логистика: маршруты (раздел 3, история) ──────────────────────────────
export type RouteStatus = 'active' | 'finished';

export interface Route {
  id: string;
  driver_username: string;
  driver_name: string;
  car_number: string | null;
  status: RouteStatus;
  started_at: string;
  finished_at: string | null;
  delivery_ids: string[];
  total_km: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface RouteWithDeliveries extends Route {
  deliveries: Delivery[];
}

export async function listRoutes(): Promise<Route[]> {
  const res = await fetch('/api/logistics/routes', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

export async function getRoute(id: string): Promise<RouteWithDeliveries> {
  const res = await fetch(`/api/logistics/routes/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data as RouteWithDeliveries;
}

export async function startRoute(driver_username?: string): Promise<Route> {
  const res = await fetch('/api/logistics/routes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(driver_username ? { driver_username } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка старта маршрута');
  return data.data as Route;
}

export async function finishRoute(id: string): Promise<RouteWithDeliveries> {
  const res = await fetch(`/api/logistics/routes/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'finished' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка завершения маршрута');
  return data.data as RouteWithDeliveries;
}

export async function addDeliveriesToRoute(id: string, deliveryIds: string[]): Promise<RouteWithDeliveries> {
  const res = await fetch(`/api/logistics/routes/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ add_delivery_ids: deliveryIds }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка добавления в маршрут');
  return data.data as RouteWithDeliveries;
}

// ─── Логистика: GPS-трекинг (раздел 3, карта) ─────────────────────────────
export interface VehiclePosition {
  username: string;
  driver_name: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  at: string;
  updated_at: string;
  route_id: string | null;
}

export async function sendTrackPoint(p: {
  lat: number; lng: number; accuracy?: number; speed?: number; heading?: number;
}): Promise<void> {
  await fetch('/api/logistics/track', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  });
}

export async function listVehiclePositions(): Promise<VehiclePosition[]> {
  const res = await fetch('/api/logistics/track', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

// ─── Логистика: заявки магазинов (раздел 2) ───────────────────────────────
export async function listShopRequests(): Promise<Delivery[]> {
  const res = await fetch('/api/logistics/shop-requests', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ошибка сервера: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

export async function createShopRequest(input: {
  client_name: string; address: string; note?: string;
}): Promise<Delivery> {
  const res = await fetch('/api/logistics/shop-requests', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Ошибка создания заявки');
  return data.data as Delivery;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
