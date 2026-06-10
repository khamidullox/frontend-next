import { smartupRequest } from './smartup';
import { getProductInfos } from './products';

const MOVEMENT_EXPORT_ENDPOINT = '/b/anor/mxsx/mkw/movement$export';

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
    const all = await exportMovements({});
    return (
      all.find(
        (m) => String(m.movement_number) === String(filters.movement_number)
      ) || null
    );
  }

  const movements = await exportMovements(filters);
  return movements[0] || null;
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
