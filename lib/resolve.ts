import { CheckDocument } from './document';
import { getMovementDocument } from './movement';
import { getOrderDocument, getOrderDocumentByTTN } from './orders';

export interface ResolveInput {
  query?: string;
  movement_id?: string;
  movement_number?: string;
  deal_id?: string;
}

// deal_id заказов — крупные (сотни миллионов, ~9 цифр),
// movement_id накладных — миллионы (~7 цифр). Порог различает их.
const ORDER_ID_THRESHOLD = 100_000_000;

async function tryMovement(q: string): Promise<CheckDocument | null> {
  // Форматированный номер с ведущим нулём — это movement_number.
  if (/^0\d+$/.test(q)) {
    return getMovementDocument({ movement_number: q });
  }
  return getMovementDocument({ movement_id: q });
}

async function tryOrder(q: string): Promise<CheckDocument | null> {
  return getOrderDocument(q);
}

/**
 * Определяет тип документа по введённому значению и возвращает его
 * в нормализованном виде. Поддерживает явное указание типа (с разделов
 * «Накладные» / «Заказы») и единый ввод (query) с авто-определением.
 */
export async function resolveDocument(input: ResolveInput): Promise<CheckDocument | null> {
  if (input.deal_id) return getOrderDocument(input.deal_id);
  if (input.movement_id) return getMovementDocument({ movement_id: input.movement_id });
  if (input.movement_number)
    return getMovementDocument({ movement_number: input.movement_number });

  const q = String(input.query || '').trim();
  if (!q) return null;

  // Форматированный номер накладной — однозначно накладная.
  if (/^0\d+$/.test(q)) {
    return getMovementDocument({ movement_number: q });
  }

  // Иначе пробуем по величине ID, с откатом на другой тип.
  const n = Number(q);
  const orderFirst = Number.isFinite(n) && n >= ORDER_ID_THRESHOLD;

  const primary = orderFirst
    ? (await tryOrder(q)) || (await tryMovement(q))
    : (await tryMovement(q)) || (await tryOrder(q));

  if (primary) return primary;

  // Последний шанс: это может быть номер ТТН заказа (delivery_number).
  return getOrderDocumentByTTN(q);
}
