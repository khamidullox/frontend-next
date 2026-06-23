// Общие форматтеры даты-времени для UI (ru-RU). Раньше одинаковые `fmt`/`fmtTime`
// были скопированы по странице логистики (my, shop, shop-requests, logistics).

// ДД.ММ ЧЧ:ММ (без года). Пустое/битое → ''.
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// ДД.ММ.ГГ ЧЧ:ММ (с годом). Пустое/битое → '—'.
export function fmtDateTimeYear(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}
