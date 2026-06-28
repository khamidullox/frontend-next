// Гибкие права доступа к разделам — поверх ролей. По умолчанию доступ определяется
// ролью (manager видит менеджерские разделы, admin — всё). Админ может для конкретного
// пользователя ПЕРЕОПРЕДЕЛИТЬ отдельный раздел: включить (даже если по роли не положено,
// напр. дать менеджеру «Перемещения») или скрыть (напр. убрать «Аналитику» у менеджера).
//
// Хранится у пользователя как features: { <ключ>: true|false }. Ключа нет → действует
// умолчание по роли (минимальная роль раздела). Так старые пользователи без поля
// работают как раньше. Файл не зависит ни от сервера, ни от клиента — импортируется и там, и там.

export type FeatureKey =
  | 'orders' | 'movements' | 'analytics' | 'transfers' | 'receipts'
  | 'log_reports' | 'log_clients' | 'log_capacity'
  | 'log_addresses' | 'log_mileage' | 'log_shop_requests';

type Role = 'driver' | 'worker' | 'manager' | 'admin';
const RANK: Record<Role, number> = { driver: 1, worker: 1, manager: 2, admin: 3 };

export interface FeatureDef { key: FeatureKey; label: string; minRole: Role }

// Порядок = порядок вывода галочек в карточке пользователя.
export const FEATURES: FeatureDef[] = [
  { key: 'orders',           label: '🧾 Заказы',                    minRole: 'manager' },
  { key: 'movements',        label: '🗂️ Накладные',                 minRole: 'manager' },
  { key: 'analytics',        label: '📊 Аналитика',                 minRole: 'manager' },
  { key: 'transfers',        label: '🔄 Перемещения',               minRole: 'admin'   },
  { key: 'receipts',         label: '📥 Приёмка',                   minRole: 'admin'   },
  { key: 'log_reports',      label: '🚚 Логистика: Отчёты',          minRole: 'manager' },
  { key: 'log_clients',      label: '🚚 Логистика: База клиентов',    minRole: 'manager' },
  { key: 'log_capacity',     label: '🚚 Логистика: Вместимость',      minRole: 'manager' },
  { key: 'log_addresses',    label: '🚚 Логистика: Адреса клиентов',  minRole: 'manager' },
  { key: 'log_mileage',      label: '🚚 Логистика: Пробег GPS',       minRole: 'manager' },
  { key: 'log_shop_requests',label: '🚚 Логистика: Заявки магазинов', minRole: 'manager' },
];

const BY_KEY: Record<string, FeatureDef> = Object.fromEntries(FEATURES.map((f) => [f.key, f]));

// Доступен ли раздел пользователю с данной ролью и переопределениями.
export function canAccess(
  key: FeatureKey,
  role: string,
  features?: Record<string, boolean> | null
): boolean {
  if (role === 'admin') return true; // админ всегда видит всё — нельзя случайно себя запереть
  const ov = features?.[key];
  if (typeof ov === 'boolean') return ov;
  const def = BY_KEY[key];
  if (!def) return false;
  return (RANK[role as Role] || 0) >= RANK[def.minRole];
}

// Эффективное значение «галочки» для UI настроек (с учётом умолчания по роли).
export function effectiveDefault(key: FeatureKey, role: string): boolean {
  const def = BY_KEY[key];
  if (!def) return false;
  return (RANK[role as Role] || 0) >= RANK[def.minRole];
}
