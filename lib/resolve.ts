import { CheckDocument } from './document';
import { getMovementDocument } from './movement';
import { getOrderDocument, getOrderDocumentByTTN } from './orders';
import { getTransferDocument } from './transfers';
import { getReceiptDocument } from './receipts';

export interface ResolveInput {
  query?: string;
  movement_id?: string;
  movement_number?: string;
  deal_id?: string;
  transfer_id?: string;
  receipt_id?: string;
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
  // Явные типы (из соответствующих разделов) — без авто-определения.
  if (input.deal_id) return getOrderDocument(input.deal_id);
  if (input.transfer_id) return getTransferDocument(input.transfer_id);
  if (input.receipt_id) return getReceiptDocument(input.receipt_id);
  if (input.movement_id) return getMovementDocument({ movement_id: input.movement_id });
  if (input.movement_number)
    return getMovementDocument({ movement_number: input.movement_number });

  const q = String(input.query || '').trim();
  if (!q) return null;

  // Форматированный номер накладной — однозначно накладная.
  if (/^0\d+$/.test(q)) {
    return getMovementDocument({ movement_number: q });
  }

  // Чтобы экономить лимит запросов Smartup (500/день), сначала пробуем
  // ВЕРОЯТНЫЙ тип по величине ID — это 1 запрос. Второй тип запрашиваем
  // только если по первому не нашли.
  const n = Number(q);
  const orderFirst = Number.isFinite(n) && n >= ORDER_ID_THRESHOLD;

  const primary = orderFirst ? await tryOrder(q) : await tryMovement(q);
  if (primary) return primary;

  const secondary = orderFirst ? await tryMovement(q) : await tryOrder(q);
  if (secondary) return secondary;

  // Межфилиальные перемещения ищем по id/номеру в кэшированной выгрузке
  // (дёшево — общий кэш со списком, без новых запросов при попадании).
  const transfer = await getTransferDocument(q);
  if (transfer) return transfer;

  const receipt = await getReceiptDocument(q);
  if (receipt) return receipt;

  // Последний шанс: это может быть номер ТТН заказа (delivery_number).
  return getOrderDocumentByTTN(q);
}
