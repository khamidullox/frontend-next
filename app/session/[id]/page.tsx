'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getSession,
  scanBarcode,
  setItemQuantity,
  Session,
  SessionItem,
  ScanRecord,
  ItemStatus,
  ScanStatus,
} from '@/lib/api';

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

function ProgressBar({ session }: { session: Session }) {
  const { summary, items } = session;
  const partial = items.filter(i => i.status === 'partial').length;
  const pending  = items.filter(i => i.status === 'pending').length;
  const pct = summary.total_items > 0
    ? Math.round((summary.done_items / summary.total_items) * 100)
    : 0;

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
      <div className="flex gap-6 mb-3 flex-wrap">
        <Stat label="Всего позиций" value={summary.total_items} color="text-blue-500" />
        <Stat label="Проверено"     value={summary.done_items}  color="text-green-600" />
        <Stat label="Частично"      value={partial}             color="text-yellow-600" />
        <Stat label="Ожидают"       value={pending}             color="text-gray-400" />
      </div>
      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-right text-xs text-gray-400 mt-1">{pct}%</div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function ProductCard({
  item,
  highlighted,
  onManual,
}: {
  item: SessionItem;
  highlighted: boolean;
  onManual: (item: SessionItem) => void;
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
        bg-white rounded-xl shadow-sm p-4 flex items-center gap-4 border-l-4
        ${borderColor[item.status]}
        transition-all duration-300
        ${highlighted ? 'ring-2 ring-blue-400 shadow-blue-200 shadow-md' : ''}
      `}
    >
      <span className="text-2xl flex-shrink-0">{STATUS_ICON[item.status]}</span>

      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate">{item.product_name || '—'}</div>
        <div className="text-xs text-gray-400 mt-0.5">Код: {item.product_code}</div>
        {item.barcodes.length > 0 && (
          <div className="text-xs text-gray-300 mt-0.5 truncate">
            ШК: {item.barcodes.join(', ')}
          </div>
        )}
      </div>

      <div className="text-right flex-shrink-0">
        <div className={`text-2xl font-bold ${qtyColor[item.status]}`}>
          {item.scanned_quantity}
        </div>
        <div className="text-xs text-gray-400">из {item.quantity}</div>
      </div>

      {/* Ручной ввод количества */}
      <button
        onClick={() => onManual(item)}
        title="Ввести количество вручную"
        className="flex-shrink-0 w-9 h-9 rounded-lg bg-gray-100 hover:bg-blue-100
                   text-gray-500 hover:text-blue-600 transition-colors flex items-center
                   justify-center text-lg"
      >
        ✍️
      </button>
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

function LastScanBanner({ scan, itemName }: { scan: ScanRecord; itemName?: string }) {
  return (
    <div
      className={`
        flex items-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm mb-4
        animate-in fade-in slide-in-from-top-2 duration-300
        ${SCAN_STYLE[scan.status]}
      `}
    >
      <span>{SCAN_ICON[scan.status]}</span>
      <span>{scan.message}</span>
      {itemName && <span className="font-normal opacity-70">— {itemName}</span>}
      <span className="ml-auto font-mono text-xs opacity-50">{scan.barcode}</span>
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

  const { movement, summary, items } = session;
  const allDone = summary.done_items === summary.total_items && summary.total_items > 0;

  const sortedItems = [...items].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  );

  const lastScanItem = lastScan?.item_id
    ? items.find(i => i.id === lastScan.item_id)
    : undefined;

  return (
    <div>
      {/* Invoice header */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex items-start gap-4 flex-wrap">
        <div className="flex-1">
          <h2 className="text-xl font-bold">
            Накладная #{movement.movement_number || movement.movement_id || '—'}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {[
              movement.from_warehouse_code && `Со склада: ${movement.from_warehouse_code}`,
              movement.to_warehouse_code   && `На склад: ${movement.to_warehouse_code}`,
              movement.from_movement_date  && `Дата: ${movement.from_movement_date}`,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-600 transition-colors"
        >
          ← Назад
        </button>
      </div>

      {/* Progress */}
      <ProgressBar session={session} />

      {/* Done banner */}
      {allDone && (
        <div className="bg-gradient-to-r from-green-500 to-green-600 text-white rounded-xl p-5 text-center font-bold text-lg mb-4 shadow-green-200 shadow-md">
          ✅ Все товары проверены! Накладная готова к отправке.
        </div>
      )}

      {/* Scan input */}
      <div className="bg-slate-900 rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
        <span className="text-gray-400 text-sm whitespace-nowrap">📷 Сканер:</span>
        <input
          ref={scanInputRef}
          type="text"
          placeholder="Поднесите сканер к штрихкоду..."
          onKeyDown={handleScan}
          onClick={refocusScan}
          className="flex-1 bg-slate-800 text-white placeholder-slate-500 rounded-lg px-4 py-2.5
                     border-2 border-blue-500 focus:border-green-400 outline-none transition-colors
                     text-base"
        />
      </div>

      {scanError && (
        <p className="text-red-500 text-sm mb-3">{scanError}</p>
      )}

      {/* Last scan result */}
      {lastScan && (
        <LastScanBanner scan={lastScan} itemName={lastScanItem?.product_name} />
      )}

      {/* Журнал сканов: проблемные | принятые */}
      <ScanLog scans={session.scans} items={items} />

      {/* Product list */}
      <div className="flex flex-col gap-2.5">
        {sortedItems.map(item => (
          <div key={item.id} id={`card-${item.id}`}>
            <ProductCard
              item={item}
              highlighted={highlightedId === item.id}
              onManual={setManualItem}
            />
          </div>
        ))}
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
