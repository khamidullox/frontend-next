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

export interface SessionMovement {
  filial_code: string;
  external_id: string;
  movement_id: string;
  movement_number: string;
  from_movement_date: string;
  to_movement_date: string;
  status: string;
  from_warehouse_code: string;
  to_warehouse_code: string;
  note: string;
}

export interface SessionSummary {
  total: number;
  scanned: number;
  done_items: number;
  total_items: number;
}

export interface Session {
  id: string;
  created_at: string;
  movement: SessionMovement;
  items: SessionItem[];
  summary: SessionSummary;
  scans: ScanRecord[];
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

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
