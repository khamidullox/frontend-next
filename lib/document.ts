// Единый («нормализованный») вид проверяемого документа — и для накладной,
// и для заказа. Дальше движок проверки/сканирования работает только с ним.

export type DocType = 'movement' | 'order';

export interface DocItem {
  product_code: string;
  product_name: string;
  quantity: number;
  barcodes: string[];
  line_id?: string; // уникальный id строки из Smartup (для ключа позиции)
}

export interface CheckDocument {
  doc_type: DocType;
  doc_id: string; // movement_id / deal_id
  doc_number: string; // movement_number / deal_id (то, что печатается)
  date: string;
  from_warehouse_code: string | null;
  to_warehouse_code: string | null;
  client_name: string | null;
  note: string | null;
  items: DocItem[];
}
