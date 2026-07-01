import { smartupRequest } from './smartup';
import { getProductInfos, getWarehouseCodeMap } from './products';
import { CheckDocument, DocItem } from './document';
import { cached } from './cache';
import { shopForWarehouseCode } from './shopWarehouseMap';

const MOVEMENT_EXPORT_ENDPOINT = '/b/anor/mxsx/mkw/movement$export';
// 300 запросов/день (редкие документы) = не чаще 1 раза в ~5 мин.
const LIST_TTL_MS = 5 * 60 * 1000;

// Полная выгрузка накладных, кэш 5 мин. Используется списком и поиском
// по movement_number (Smartup по номеру не фильтрует).
function getAllMovements(): Promise<Movement[]> {
  return cached('movements:all', LIST_TTL_MS, () => exportMovements({}));
}

export interface MovementItem {
  product_code: string;
  product_name: string;
  quantity: number;
  movement_item_id?: string;
  external_id?: string;
  [key: string]: unknown;
}

export interface Movement {
  filial_code: string;
  external_id: string | null;
  movement_id: string;
  movement_number: string;
  from_movement_date: string;
  to_movement_date: string;
  status: string;
  from_warehouse_code: string | null;
  to_warehouse_code: string | null;
  barcode: string;
  note: string | null;
  movement_items: MovementItem[];
}

export interface MovementFilters {
  movement_id?: string;
  movement_number?: string;
  filial_code?: string;
  external_id?: string;
  [key: string]: unknown;
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => {
      if (Array.isArray(v)) return v.length > 0;
      return v !== undefined && v !== null && v !== '';
    })
  );
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildExportBody(filters: MovementFilters): Record<string, unknown> {
  return compactObject({
    filial_code: filters.filial_code,
    external_id: filters.external_id,
    movement_id: filters.movement_id,
  });
}

async function exportMovements(filters: MovementFilters): Promise<Movement[]> {
  const data = await smartupRequest<{ movement?: Movement[] }>(
    MOVEMENT_EXPORT_ENDPOINT,
    buildExportBody(filters)
  );
  return data.movement || [];
}

async function getMovement(filters: MovementFilters): Promise<Movement | null> {
  // Быстрый путь: Smartup фильтрует по movement_id (~3.5 КБ вместо 2.5 МБ).
  if (filters.movement_id) {
    const byId = await exportMovements({ movement_id: filters.movement_id });
    if (byId.length) return byId[0];
    // Если по id пусто — возможно ввели номер; идём дальше.
  }

  // Медленный путь: по movement_number Smartup не фильтрует — тянем все и ищем.
  if (filters.movement_number) {
    const all = await getAllMovements();
    return (
      all.find(
        (m) => String(m.movement_number) === String(filters.movement_number)
      ) || null
    );
  }

  const movements = await exportMovements(filters);
  return movements[0] || null;
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

function whName(code: string | null, map: Map<string, string>): string | null {
  if (!code) return null;
  return map.get(String(code).trim()) || String(code);
}

// Лёгкий список доступных накладных (из кэша).
// Завершённые (status "C") не показываем — их уже отгрузили, проверять нечего.
export async function listMovements(): Promise<MovementListItem[]> {
  const [movements, whMap] = await Promise.all([getAllMovements(), getWarehouseCodeMap()]);

  return movements
    .filter((m) => m.status !== 'C')
    .map((m) => {
      const items = m.movement_items || [];
      return {
        movement_id: String(m.movement_id),
        movement_number: String(m.movement_number),
        from_movement_date: m.from_movement_date,
        filial_code: m.filial_code,
        from_warehouse_code: m.from_warehouse_code,
        to_warehouse_code: m.to_warehouse_code,
        from_warehouse_name: whName(m.from_warehouse_code, whMap),
        to_warehouse_name: whName(m.to_warehouse_code, whMap),
        status: m.status,
        items_count: items.length,
        total_quantity: items.reduce((sum, it) => sum + toNumber(it.quantity), 0),
      };
    })
    .sort((a, b) => b.movement_id.localeCompare(a.movement_id, undefined, { numeric: true }));
}

// Дата строки в формате Smartup → {iso: "YYYY-MM-DD", ts}. Понимает "DD.MM.YYYY[ время]"
// и "YYYY-MM-DD[ время]".
function parseMovDate(s: string): { iso: string | null; ts: number } {
  const str = String(s || '').trim();
  let m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return { iso: `${m[3]}-${m[2]}-${m[1]}`, ts: Date.UTC(+m[3], +m[2] - 1, +m[1]) };
  m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { iso: `${m[1]}-${m[2]}-${m[3]}`, ts: Date.UTC(+m[1], +m[2] - 1, +m[3]) };
  return { iso: null, ts: 0 };
}

// Последняя дата прихода товара в магазин — по внутренним накладным (movement$export),
// где склад-получатель = склад магазина. Ключ `${shop_code}|${product_code}` → "YYYY-MM-DD".
// Берём ВСЕ статусы (в т.ч. завершённые «C» — это и есть состоявшиеся приходы).
export async function getShopArrivalDates(): Promise<Map<string, string>> {
  const movements = await getAllMovements();
  const out = new Map<string, string>();
  const bestTs = new Map<string, number>();
  for (const m of movements) {
    const shop = shopForWarehouseCode(m.to_warehouse_code || '');
    if (!shop) continue;
    const { iso, ts } = parseMovDate(m.from_movement_date);
    if (!iso) continue;
    for (const it of m.movement_items || []) {
      const code = String(it.product_code || '').trim();
      if (!code) continue;
      const key = `${shop.code}|${code}`;
      if (ts > (bestTs.get(key) ?? -1)) { bestTs.set(key, ts); out.set(key, iso); }
    }
  }
  return out;
}

export async function getEnrichedMovement(
  filters: MovementFilters
): Promise<Movement | null> {
  const movement = await getMovement(filters);
  if (!movement) return null;

  const items = movement.movement_items || [];
  const infos = await getProductInfos(items.map((i) => i.product_code));

  const movementItems: MovementItem[] = items.map((item) => {
    const info = infos.get(String(item.product_code).trim());
    return {
      ...item,
      quantity: toNumber(item.quantity),
      product_name: info?.name || info?.short_name || '',
      barcodes: info?.barcodes || [],
    };
  });

  return { ...movement, movement_items: movementItems };
}

// Накладная в общем («нормализованном») виде документа проверки.
export async function getMovementDocument(
  filters: MovementFilters
): Promise<CheckDocument | null> {
  const movement = await getEnrichedMovement(filters);
  if (!movement) return null;

  const items: DocItem[] = (movement.movement_items || []).map((item, index) => ({
    product_code: String(item.product_code ?? '').trim(),
    product_name: item.product_name || '',
    quantity: toNumber(item.quantity),
    barcodes: (item.barcodes as string[]) || [],
    line_id:
      String(item.movement_item_id ?? '').trim() ||
      String(item.external_id ?? '').trim() ||
      `${item.product_code}-${index}`,
  }));

  // «Откуда → Куда» названиями складов (коды теперь заполнены в Smartup).
  const whMap = await getWarehouseCodeMap();
  const from = whName(movement.from_warehouse_code, whMap);
  const to = whName(movement.to_warehouse_code, whMap);
  const route = [from, to].filter(Boolean).join(' → ') || null;

  return {
    doc_type: 'movement',
    doc_id: String(movement.movement_id),
    doc_number: String(movement.movement_number),
    date: movement.from_movement_date,
    from_warehouse_code: movement.from_warehouse_code,
    to_warehouse_code: movement.to_warehouse_code,
    client_name: route,
    note: movement.note,
    items,
  };
}
