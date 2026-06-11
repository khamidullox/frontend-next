// Мягкий «киоск-режим»: по умолчанию виден только сканер.
// Списки и история открываются через /unlock по простому паролю.
// Это UI-ограничение для склада, не криптозащита.

const ADMIN_KEY = 'admin_unlocked';

export const ADMIN_PASSWORD =
  process.env.NEXT_PUBLIC_ADMIN_PASSWORD || '1234';

export function isAdminUnlocked(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(ADMIN_KEY) === '1';
}

export function setAdminUnlocked(value: boolean) {
  if (typeof window === 'undefined') return;
  if (value) localStorage.setItem(ADMIN_KEY, '1');
  else localStorage.removeItem(ADMIN_KEY);
}
