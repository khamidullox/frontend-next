// Код склада = первый токен названия («001 Основной склад» → «001»).
// Тот же код хранится в user.warehouses / user.home_warehouse.
export function whCode(name: string): string {
  return String(name || '').trim().split(/\s+/)[0] || '';
}
