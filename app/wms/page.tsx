'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminGate from '@/components/AdminGate';
import {
  wmsListLocations, wmsCreateLocation, wmsDeleteLocation,
  wmsPlace, wmsFindByProduct, wmsListByLocation,
  WmsLocation, WmsStockRow,
} from '@/lib/api';

type Tab = 'place' | 'find' | 'locations';

export default function WmsPage() {
  return (
    <AdminGate min="worker">
      <WmsContent />
    </AdminGate>
  );
}

function WmsContent() {
  const [tab, setTab] = useState<Tab>('place');
  return (
    <div>
      <h2 className="text-xl font-bold mb-1">📦 WMS — склад 001 (Основной)</h2>
      <p className="text-xs text-gray-400 mb-3">Адресное хранение: где какой товар лежит. Этап 1 — размещение и поиск.</p>
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        {([['place', '📥 Разместить'], ['find', '🔎 Найти'], ['locations', '🗄️ Ячейки']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-semibold rounded-lg ${tab === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'place' && <PlaceTab />}
      {tab === 'find' && <FindTab />}
      {tab === 'locations' && <LocationsTab />}
    </div>
  );
}

// ─── Разместить ──────────────────────────────────────────────────────────────
function PlaceTab() {
  const [location, setLocation] = useState('');
  const [product, setProduct] = useState('');
  const [qty, setQty] = useState('1');
  const [card, setCard] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function submit() {
    setErr(''); setMsg('');
    if (!location.trim() || !product.trim()) { setErr('Укажите ячейку и товар'); return; }
    setBusy(true);
    try {
      const r = await wmsPlace({ location: location.trim(), product: product.trim(), qty: Number(qty) || 0, card_number: card.trim() || undefined });
      setMsg(`✓ ${r.product_name} → ячейка ${location.trim().toUpperCase()}: теперь ${r.qty} шт`);
      setProduct(''); setQty('1'); setCard('');
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 max-w-md flex flex-col gap-3">
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Ячейка (скан/ввод)</label>
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="напр. A1"
          className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm uppercase outline-none focus:border-blue-400" />
      </div>
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Товар (скан штрихкода или код)</label>
        <input value={product} onChange={(e) => setProduct(e.target.value)} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="штрихкод / код товара"
          className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-xs text-gray-500 mb-1 block">Кол-во</label>
          <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)}
            className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>
        <div className="flex-1">
          <label className="text-xs text-gray-500 mb-1 block">№ карточки (необязательно)</label>
          <input value={card} onChange={(e) => setCard(e.target.value)}
            className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>
      </div>
      <button onClick={submit} disabled={busy}
        className="py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white font-semibold rounded-lg">
        {busy ? '⏳…' : '📥 Положить в ячейку'}
      </button>
      {msg && <div className="text-sm text-emerald-600">{msg}</div>}
      {err && <div className="text-sm text-red-500">{err}</div>}
    </div>
  );
}

// ─── Найти ───────────────────────────────────────────────────────────────────
function FindTab() {
  const [mode, setMode] = useState<'product' | 'location'>('product');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<WmsStockRow[]>([]);
  const [title, setTitle] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function search() {
    setErr(''); setRows([]); setTitle('');
    if (!q.trim()) return;
    setBusy(true);
    try {
      if (mode === 'product') {
        const r = await wmsFindByProduct(q.trim());
        setTitle(`${r.product_name} (${r.product_code})`);
        setRows(r.rows);
      } else {
        setTitle(`Ячейка ${q.trim().toUpperCase()}`);
        setRows(await wmsListByLocation(q.trim()));
      }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {([['product', 'По товару'], ['location', 'По ячейке']] as ['product' | 'location', string][]).map(([k, label]) => (
          <button key={k} onClick={() => { setMode(k); setRows([]); setTitle(''); }}
            className={`px-3 py-1.5 text-xs font-semibold rounded ${mode === k ? 'bg-white shadow-sm' : 'text-gray-500'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
          placeholder={mode === 'product' ? 'штрихкод / код товара' : 'ячейка (напр. A1)'}
          className="flex-1 min-w-0 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        <button onClick={search} disabled={busy}
          className="px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white font-semibold rounded-lg shrink-0">
          {busy ? '⏳' : 'Найти'}
        </button>
      </div>
      {err && <div className="text-sm text-red-500">{err}</div>}
      {title && (
        <div className="bg-white rounded-xl shadow-sm p-3">
          <div className="font-semibold text-sm mb-2">{title}</div>
          {rows.length === 0 ? (
            <div className="text-sm text-gray-400">Ничего не найдено (нет остатка).</div>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-400">
                <th className="py-1 pr-2">{mode === 'product' ? 'Ячейка' : 'Товар'}</th>
                <th className="py-1 pr-2 text-right">Кол-во</th>
                <th className="py-1 text-right">№ карточки</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5 pr-2 font-medium">{mode === 'product' ? r.location : `${r.product_name} (${r.product_code})`}</td>
                    <td className="py-1.5 pr-2 text-right">{r.qty}</td>
                    <td className="py-1.5 text-right text-gray-500">{r.card_number || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Ячейки ──────────────────────────────────────────────────────────────────
function LocationsTab() {
  const [locs, setLocs] = useState<WmsLocation[]>([]);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [zone, setZone] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { wmsListLocations().then(setLocs).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setErr('');
    if (!code.trim()) { setErr('Укажите код ячейки'); return; }
    setBusy(true);
    try {
      await wmsCreateLocation({ code: code.trim(), label: label.trim(), zone: zone.trim() });
      setCode(''); setLabel(''); load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  async function del(c: string) {
    if (!confirm(`Удалить ячейку ${c}?`)) return;
    try { await wmsDeleteLocation(c); load(); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <div className="bg-white rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Код ячейки</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="A1"
            className="w-28 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm uppercase outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Название</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Колонна 1"
            className="w-40 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Зона</label>
          <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Ряд A"
            className="w-32 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>
        <button onClick={add} disabled={busy}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg">
          + Добавить
        </button>
      </div>
      {err && <div className="text-sm text-red-500">{err}</div>}
      <div className="bg-white rounded-xl shadow-sm p-3">
        <div className="text-xs text-gray-400 mb-2">Всего ячеек: {locs.length}</div>
        {locs.length === 0 ? (
          <div className="text-sm text-gray-400">Ячеек пока нет — добавьте первую (например, по колоннам ангара).</div>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-gray-400">
              <th className="py-1 pr-2">Код</th><th className="py-1 pr-2">Название</th><th className="py-1 pr-2">Зона</th><th className="py-1"></th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {locs.map((l) => (
                <tr key={l.code}>
                  <td className="py-1.5 pr-2 font-mono font-semibold">{l.code}</td>
                  <td className="py-1.5 pr-2">{l.label}</td>
                  <td className="py-1.5 pr-2 text-gray-500">{l.zone || '—'}</td>
                  <td className="py-1.5 text-right">
                    <button onClick={() => del(l.code)} className="text-red-500 hover:text-red-700">🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
