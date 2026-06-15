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

// Формат под длину цифрового штрихкода (нестандартная длина — CODE128).
function fmt(value: string): string {
  return value.length === 13 ? 'EAN13' : value.length === 8 ? 'EAN8' : 'CODE128';
}

// Выбирает штрихкод для печати.
// Приоритет — НАШ внутренний ШК: цифровой, начинается с «1000» и заканчивается кодом товара
// (напр. код 157 → 10000000000157). Иначе — первый цифровой, иначе первый, иначе код товара.
export function pickBarcode(code: string, barcodes: string[]): { value: string; format: string } {
  const norm = String(code).trim();
  const own = barcodes.find(b => /^\d+$/.test(b) && b.startsWith('1000') && b.endsWith(norm));
  if (own) return { value: own, format: fmt(own) };

  const digitsOnly = barcodes.find(b => /^\d+$/.test(b));
  if (digitsOnly) return { value: digitsOnly, format: fmt(digitsOnly) };

  if (barcodes[0]) return { value: barcodes[0], format: 'CODE128' };
  return { value: norm, format: 'CODE128' };
}
