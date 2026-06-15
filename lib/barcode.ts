// Загрузка JsBarcode по требованию из CDN (без npm-зависимости).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { interface Window { JsBarcode?: any } }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadJsBarcode(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('only client'));
  if (window.JsBarcode) return Promise.resolve(window.JsBarcode);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';
    s.onload = () => resolve(window.JsBarcode);
    s.onerror = () => reject(new Error('Не удалось загрузить библиотеку штрихкодов'));
    document.head.appendChild(s);
  });
}

// Выбирает штрихкод для печати: предпочитает цифровой EAN-13/EAN-8, иначе берёт первый, иначе — код товара.
export function pickBarcode(code: string, barcodes: string[]): { value: string; format: string } {
  const digitsOnly = barcodes.find(b => /^\d{8}$|^\d{13}$/.test(b));
  if (digitsOnly) {
    return { value: digitsOnly, format: digitsOnly.length === 13 ? 'EAN13' : 'EAN8' };
  }
  if (barcodes[0]) {
    return { value: barcodes[0], format: 'CODE128' };
  }
  return { value: code, format: 'CODE128' };
}
