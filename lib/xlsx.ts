// Загрузка SheetJS по требованию из CDN (без npm-зависимости).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { interface Window { XLSX?: any } }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadXLSX(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('only client'));
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Не удалось загрузить библиотеку Excel'));
    document.head.appendChild(s);
  });
}
