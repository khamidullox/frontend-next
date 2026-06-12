'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getSession,
  scanBarcode,
  setItemQuantity,
  finishSession,
  Session,
  SessionItem,
  ScanRecord,
  ItemStatus,
  ScanStatus,
} from '@/lib/api';

// SheetJS грузим по требованию из CDN (без npm-зависимости).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global { interface Window { XLSX?: any } }

function loadXLSX(): Promise<unknown> {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Не удалось загрузить библиотеку Excel'));
    document.head.appendChild(s);
  });
}

async function exportToExcel(session: Session) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const XLSX: any = await loadXLSX();

  const statusLabel: Record<ItemStatus, string> = {
    done: 'Собрано', partial: 'Частично', pending: 'Не собрано',
  };

  const rows = session.items.map((it, i) => ({
    '№': i + 1,
    'Код': it.product_code,
    'Название': it.product_name,
    'Штрихкоды': it.barcodes.join(', '),
    'По накладной': it.quantity,
    'Отсканировано': it.scanned_quantity,
    'Расхождение': it.scanned_quantity - it.quantity,
    'Статус': statusLabel[it.status],
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 5 }, { wch: 10 }, { wch: 45 }, { wch: 28 },
    { wch: 12 }, { wch: 13 }, { wch: 12 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Проверка');

  const prefix = session.document.doc_type === 'order' ? 'zakaz' : 'nakladnaya';
  const num = session.document.doc_number || session.document.doc_id || prefix;
  XLSX.writeFile(wb, `${prefix}_${num}.xlsx`);
}

// ─── helpers ────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<ItemStatus, string> = {
  done: '✅',
  partial: '🟡',
  pending: '⬜',
};

const SCAN_STYLE: Record<ScanStatus, string> = {
  done:         'bg-green-100 text-green-800',
  partial:      'bg-yellow-100 text-yellow-800',
  over_scanned: 'bg-red-100 text-red-800',
  not_found:    'bg-red-100 text-red-800',
  manual:       'bg-blue-100 text-blue-800',
};

const SCAN_ICON: Record<ScanStatus, string> = {
  done:         '✅',
  partial:      '🟡',
  over_scanned: '⚠️',
  not_found:    '❌',
  manual:       '✍️',
};

const STATUS_ORDER: Record<ItemStatus, number> = { pending: 0, partial: 1, done: 2 };

// ─── sub-components ─────────────────────────────────────────────────────────

function ProductCard({
  item,
  index,
  highlighted,
  onManual,
  readOnly,
}: {
  item: SessionItem;
  index: number;
  highlighted: boolean;
  onManual: (item: SessionItem) => void;
  readOnly?: boolean;
}) {
  const borderColor: Record<ItemStatus, string> = {
    done:    'border-l-green-500',
    partial: 'border-l-yellow-400',
    pending: 'border-l-gray-200',
  };
  const qtyColor: Record<ItemStatus, string> = {
    done:    'text-green-600',
    partial: 'text-yellow-600',
    pending: 'text-gray-300',
  };

  return (
    <div
      className={`
        bg-white rounded-lg shadow-sm px-2.5 py-2 flex items-center gap-2 border-l-4
        ${borderColor[item.status]}
        transition-all duration-300
        ${highlighted ? 'ring-2 ring-blue-400 shadow-blue-200 shadow-md' : ''}
      `}
    >
      <span className="text-[11px] text-gray-300 font-mono w-5 text-right flex-shrink-0">{index}</span>
      <span className="text-base flex-shrink-0">{STATUS_ICON[item.status]}</span>

      <div className="flex-1 min-w-0">
        <div className="font-medium text-[13px] leading-tight truncate">{item.product_name || '—'}</div>
        <div className="text-[11px] text-gray-400 truncate">
          Код {item.product_code}
          {item.barcodes.length > 0 && ` · ШК ${item.barcodes.join(', ')}`}
        </div>
      </div>

      <div className="text-right flex-shrink-0 leading-none">
        <span className={`text-lg font-bold ${qtyColor[item.status]}`}>{item.scanned_quantity}</span>
        <span className="text-[11px] text-gray-400">/{item.quantity}</span>
      </div>

      {/* Ручной ввод количества */}
      {!readOnly && (
        <button
          onClick={() => onManual(item)}
          title="Ввести количество вручную"
          className="flex-shrink-0 w-7 h-7 rounded-md bg-gray-100 hover:bg-blue-100
                     text-gray-500 hover:text-blue-600 transition-colors flex items-center
                     justify-center text-sm print:hidden"
        >
          ✍️
        </button>
      )}
    </div>
  );
}

function ManualQuantityDialog({
  item,
  onConfirm,
  onCancel,
}: {
  item: SessionItem;
  onConfirm: (qty: number) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(String(item.scanned_quantity));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
  }, []);

  const qty = Number(value);
  const valid = Number.isFinite(qty) && qty >= 0;
  const clamped = valid ? Math.min(Math.floor(qty), item.quantity) : 0;

  function confirm() {
    if (valid) onConfirm(clamped);
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-1">Ручной ввод количества</h3>
        <p className="text-sm text-gray-500 mb-4 truncate" title={item.product_name}>
          {item.product_name || `Код: ${item.product_code}`}
        </p>

        <label className="block text-sm text-gray-600 mb-2">
          Сколько штук проверено? (максимум {item.quantity})
        </label>
        <input
          ref={inputRef}
          type="number"
          min={0}
          max={item.quantity}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') onCancel(); }}
          className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-2xl font-bold
                     text-center outline-none focus:border-blue-400 transition-colors mb-2"
        />

        {valid && clamped !== qty && (
          <p className="text-xs text-amber-600 mb-2">
            Будет установлено {clamped} (не больше {item.quantity} по накладной)
          </p>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={onCancel}
            className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 rounded-xl font-semibold
                       text-gray-600 transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={confirm}
            disabled={!valid}
            className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300
                       text-white rounded-xl font-semibold transition-colors"
          >
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  );
}

// Статусы, которые считаем «проблемными» (что-то пошло не так)
const PROBLEM_STATUSES: ScanStatus[] = ['not_found', 'over_scanned'];

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

function ScanRow({
  scan,
  itemName,
}: {
  scan: ScanRecord;
  itemName?: string;
}) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-white/70">
      <span className="text-base leading-none mt-0.5">{SCAN_ICON[scan.status]}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          {itemName || scan.product_code || '—'}
        </div>
        <div className="text-xs opacity-70 truncate">{scan.message}</div>
        {scan.barcode && (
          <div className="font-mono text-[11px] opacity-50 truncate">
            ШК: {scan.barcode}
          </div>
        )}
      </div>
      <span className="text-[11px] opacity-50 whitespace-nowrap mt-0.5">
        {formatTime(scan.scanned_at)}
      </span>
    </div>
  );
}

function ScanLog({
  scans,
  items,
}: {
  scans: ScanRecord[];
  items: SessionItem[];
}) {
  const nameById = (id?: string) =>
    id ? items.find(i => i.id === id)?.product_name : undefined;

  const problems = scans.filter(s => PROBLEM_STATUSES.includes(s.status));
  const accepted = scans.filter(s => !PROBLEM_STATUSES.includes(s.status));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
      {/* Проблемные сканы */}
      <div className="bg-red-50 border border-red-100 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-red-600 font-bold text-sm">⚠️ Проблемные</span>
          <span className="ml-auto text-xs font-semibold text-red-500 bg-red-100 rounded-full px-2 py-0.5">
            {problems.length}
          </span>
        </div>
        {problems.length === 0 ? (
          <p className="text-xs text-gray-400 px-1 py-2">Ошибок нет 👍</p>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
            {problems.map((scan, i) => (
              <ScanRow key={i} scan={scan} itemName={nameById(scan.item_id)} />
            ))}
          </div>
        )}
      </div>

      {/* Принятые сканы */}
      <div className="bg-green-50 border border-green-100 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-green-700 font-bold text-sm">✅ Принятые</span>
          <span className="ml-auto text-xs font-semibold text-green-600 bg-green-100 rounded-full px-2 py-0.5">
            {accepted.length}
          </span>
        </div>
        {accepted.length === 0 ? (
          <p className="text-xs text-gray-400 px-1 py-2">Пока ничего не отсканировано</p>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
            {accepted.map((scan, i) => (
              <ScanRow key={i} scan={scan} itemName={nameById(scan.item_id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── main page ──────────────────────────────────────────────────────────────

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [session, setSession]           = useState<Session | null>(null);
  const [loading, setLoading]           = useState(true);
  const [lastScan, setLastScan]         = useState<ScanRecord | null>(null);
  const [highlightedId, setHighlighted] = useState<string | null>(null);
  const [scanError, setScanError]       = useState('');
  const [manualItem, setManualItem]     = useState<SessionItem | null>(null);
  const [finishing, setFinishing]       = useState(false);
  const [exporting, setExporting]       = useState(false);

  const scanInputRef = useRef<HTMLInputElement>(null);

  // Load session on mount
  useEffect(() => {
    getSession(id)
      .then(setSession)
      .catch(() => router.push('/'))
      .finally(() => setLoading(false));
  }, [id, router]);

  // Keep focus on scan input
  const refocusScan = useCallback(() => {
    setTimeout(() => scanInputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    if (session) refocusScan();
  }, [session, refocusScan]);

  async function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;

    const barcode = (e.target as HTMLInputElement).value.trim();
    if (!barcode) return;

    (e.target as HTMLInputElement).value = '';
    setScanError('');

    try {
      const result = await scanBarcode(id, barcode);
      setSession(result.session);
      setLastScan(result.scan);

      if (result.scan.item_id) {
        setHighlighted(result.scan.item_id);
        setTimeout(() => setHighlighted(null), 2000);

        // scroll to card
        setTimeout(() => {
          document.getElementById(`card-${result.scan.item_id}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
      }
    } catch {
      setScanError('Ошибка при обработке скана');
    } finally {
      refocusScan();
    }
  }

  async function handleManualConfirm(qty: number) {
    if (!manualItem) return;

    const targetId = manualItem.id;
    setManualItem(null);

    try {
      const result = await setItemQuantity(id, targetId, qty);
      setSession(result.session);
      setHighlighted(targetId);
      setTimeout(() => setHighlighted(null), 2000);
    } catch (err) {
      setScanError((err as Error).message || 'Ошибка при ручном вводе');
    } finally {
      refocusScan();
    }
  }

  async function handleFinish() {
    if (!confirm('Завершить проверку? Сессия станет только для чтения.')) return;
    setFinishing(true);
    setScanError('');
    try {
      const s = await finishSession(id);
      setSession(s);
    } catch (err) {
      setScanError((err as Error).message || 'Ошибка завершения');
    } finally {
      setFinishing(false);
    }
  }

  async function handleExport() {
    if (!session) return;
    setExporting(true);
    try {
      await exportToExcel(session);
    } catch (err) {
      setScanError((err as Error).message || 'Ошибка экспорта');
    } finally {
      setExporting(false);
    }
  }

  // ── render ──

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] gap-3 text-gray-500">
        <span className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        Загрузка накладной...
      </div>
    );
  }

  if (!session) return null;

  const { document: doc, summary, items } = session;
  const allDone = summary.done_items === summary.total_items && summary.total_items > 0;
  const isFinished = session.status === 'finished';
  const isOrder = doc.doc_type === 'order';
  const docLabel = isOrder ? 'Заказ' : 'Накладная';
  const discrepancies = items.filter(i => i.scanned_quantity !== i.quantity);

  const sortedItems = [...items].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  );

  const lastScanItem = lastScan?.item_id
    ? items.find(i => i.id === lastScan.item_id)
    : undefined;

  const partial = items.filter(i => i.status === 'partial').length;
  const pct = summary.total_items > 0
    ? Math.round((summary.done_items / summary.total_items) * 100)
    : 0;
  const posById = new Map(items.map((it, i) => [it.id, i + 1]));

  return (
    <div>
      {/* ─── ПЕЧАТЬ: компактный акт-таблица (как в Excel) ─── */}
      <div className="hidden print:block text-black">
        <div className="flex justify-between items-baseline mb-1">
          <h2 className="text-base font-bold">{docLabel} #{doc.doc_number || doc.doc_id || '—'}</h2>
          <span className="text-xs">Дата: {doc.date}</span>
        </div>
        <p className="text-[11px] mb-2">
          Проверка: {new Date(session.finished_at || session.created_at).toLocaleString('ru-RU')}
          {session.checker_name && ` · Проверил: ${session.checker_name}`}
          {doc.client_name && ` · Клиент: ${doc.client_name}`}
          {' · '}Позиций: {summary.total_items} · Собрано: {summary.done_items} · Расхождений: {discrepancies.length}
        </p>
        <table className="w-full border-collapse text-[10px] leading-tight">
          <thead>
            <tr className="bg-gray-200">
              <th className="border border-gray-400 px-1 py-0.5 text-right">№</th>
              <th className="border border-gray-400 px-1 py-0.5 text-left">Код</th>
              <th className="border border-gray-400 px-1 py-0.5 text-left">Название</th>
              <th className="border border-gray-400 px-1 py-0.5 text-left">ШК</th>
              <th className="border border-gray-400 px-1 py-0.5 text-right">Кол-во</th>
              <th className="border border-gray-400 px-1 py-0.5 text-right">Скан</th>
              <th className="border border-gray-400 px-1 py-0.5 text-center">✓</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.id}>
                <td className="border border-gray-400 px-1 py-0.5 text-right">{i + 1}</td>
                <td className="border border-gray-400 px-1 py-0.5">{it.product_code}</td>
                <td className="border border-gray-400 px-1 py-0.5">{it.product_name}</td>
                <td className="border border-gray-400 px-1 py-0.5">{it.barcodes.join(', ')}</td>
                <td className="border border-gray-400 px-1 py-0.5 text-right">{it.quantity}</td>
                <td className="border border-gray-400 px-1 py-0.5 text-right">{it.scanned_quantity}</td>
                <td className="border border-gray-400 px-1 py-0.5 text-center">
                  {it.status === 'done' ? '✓' : it.status === 'partial' ? '±' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ─── ЭКРАН ─── */}
      <div className="print:hidden">
        {/* Закреплённый верх: номер + прогресс + сканер */}
        <div className="sticky top-0 z-20 -mx-4 px-3 pt-2 pb-2 bg-gray-100/95 backdrop-blur border-b border-gray-200">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              isOrder ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
            }`}>{docLabel}</span>
            <span className="font-bold text-sm truncate">#{doc.doc_number || doc.doc_id || '—'}</span>
            <span className="ml-auto text-xs font-semibold whitespace-nowrap">
              <span className="text-green-600">{summary.done_items}</span>
              <span className="text-gray-400">/{summary.total_items}</span>
              {partial > 0 && <span className="text-yellow-600"> · {partial}🟡</span>}
              <span className="text-gray-400"> · {pct}%</span>
            </span>
            <button
              onClick={() => router.push('/')}
              className="px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded text-xs text-gray-600"
            >
              ←
            </button>
          </div>

          {/* Тонкий прогресс */}
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mt-1.5">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Сканер */}
          {!isFinished && (
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-base">📷</span>
              <input
                ref={scanInputRef}
                type="text"
                placeholder="Сканер: поднесите к штрихкоду..."
                onKeyDown={handleScan}
                onClick={refocusScan}
                className="flex-1 bg-slate-900 text-white placeholder-slate-500 rounded-lg px-3 py-2
                           border-2 border-blue-500 focus:border-green-400 outline-none text-base"
              />
            </div>
          )}

          {/* Последний скан — компактно */}
          {lastScan && !isFinished && (
            <div className={`mt-1.5 px-2 py-1 rounded text-xs font-medium truncate ${SCAN_STYLE[lastScan.status]}`}>
              {SCAN_ICON[lastScan.status]} {lastScan.message}
              {lastScanItem && ` — ${lastScanItem.product_name}`}
            </div>
          )}
        </div>

        {scanError && <p className="text-red-500 text-sm my-2">{scanError}</p>}

        {allDone && (
          <div className="bg-green-100 text-green-800 rounded-lg px-3 py-2 text-center font-semibold text-sm my-2">
            ✅ Все товары проверены — готово к отправке
          </div>
        )}

        {/* Список товаров — компактный */}
        <div className="flex flex-col gap-1.5 mt-2">
          {sortedItems.map(item => (
            <div key={item.id} id={`card-${item.id}`}>
              <ProductCard
                item={item}
                index={posById.get(item.id) ?? 0}
                highlighted={highlightedId === item.id}
                onManual={setManualItem}
                readOnly={isFinished}
              />
            </div>
          ))}
        </div>

        {/* Журнал сканов */}
        {!isFinished && (
          <div className="mt-3">
            <ScanLog scans={session.scans} items={items} />
          </div>
        )}

        {/* Действия */}
        <div className="flex flex-wrap gap-2 mt-4 mb-8">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex-1 min-w-[120px] py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-green-300
                       text-white font-semibold rounded-lg transition-colors text-sm"
          >
            {exporting ? '⏳ Выгрузка...' : '📥 Excel'}
          </button>
          <button
            onClick={() => window.print()}
            className="flex-1 min-w-[120px] py-2.5 bg-gray-200 hover:bg-gray-300
                       text-gray-700 font-semibold rounded-lg transition-colors text-sm"
          >
            🖨️ Печать
          </button>
          {!isFinished && (
            <button
              onClick={handleFinish}
              disabled={finishing}
              className="flex-1 min-w-[120px] py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300
                         text-white font-semibold rounded-lg transition-colors text-sm"
            >
              {finishing ? '⏳...' : '✅ Завершить'}
            </button>
          )}
        </div>
      </div>

      {/* Manual quantity dialog */}
      {manualItem && (
        <ManualQuantityDialog
          item={manualItem}
          onConfirm={handleManualConfirm}
          onCancel={() => { setManualItem(null); refocusScan(); }}
        />
      )}
    </div>
  );
}
