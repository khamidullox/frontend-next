'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminGate from '@/components/AdminGate';
import {
  wmsListLocations, wmsCreateLocation, wmsDeleteLocation,
  wmsPlace, wmsFindByProduct, wmsListByLocation, wmsOverview,
  WmsLocation, WmsStockRow, WmsPlacedProduct, WmsUnplaced,
} from '@/lib/api';

type Tab = 'distribute' | 'overview' | 'find' | 'locations';

export default function WmsPage() {
  return (
    <AdminGate min="worker">
      <WmsContent />
    </AdminGate>
  );
}

function WmsContent() {
  const [tab, setTab] = useState<Tab>('distribute');
  return (
    <div>
      <h2 className="text-xl font-bold mb-1">📦 WMS — склад 001 (Основной)</h2>
      <p className="text-xs text-gray-400 mb-3">Остаток из Smartup распределяется по ячейкам. Приход/уход сверяется автоматически.</p>
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        {([['distribute', '📥 Нужно разместить'], ['overview', '📊 По ячейкам'], ['find', '🔎 Найти'], ['locations', '🗄️ Ячейки']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-semibold rounded-lg ${tab === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'distribute' && <DistributeTab />}
      {tab === 'overview' && <OverviewTab />}
      {tab === 'find' && <FindTab />}
      {tab === 'locations' && <LocationsTab />}
    </div>
  );
}

// ─── Нужно разместить ────────────────────────────────────────────────────────
function DistributeTab() {
  const [unplaced, setUnplaced] = useState<WmsUnplaced[]>([]);
  const [loading, setLoading] = useState(true);
  const [locs, setLocs] = useState<WmsLocation[]>([]);
  const [err, setErr] = useState('');
  const [busyCode, setBusyCode] = useState('');
  // черновик размещения по каждому товару
  const [draft, setDraft] = useState<Record<string, { loc: string; qty: string; card: string }>>({});

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const o = await wmsOverview();
      setUnplaced(o.unplaced);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); wmsListLocations().then(setLocs).catch(() => {}); }, [load]);

  async function place(u: WmsUnplaced) {
    const d = draft[u.product_code] || { loc: '', qty: String(u.qty), card: '' };
    if (!d.loc.trim()) { setErr('Укажите ячейку'); return; }
    setBusyCode(u.product_code); setErr('');
    try {
      await wmsPlace({ location: d.loc.trim(), product: u.product_code, qty: Number(d.qty) || u.qty, card_number: d.card.trim() || undefined });
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusyCode(''); }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <button onClick={load} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200">↻ Обновить</button>
        <span className="text-xs text-gray-400">Товаров без ячейки: {unplaced.length}</span>
      </div>
      {err && <div className="text-sm text-red-500">{err}</div>}
      {loading ? (
        <div className="text-gray-500 text-sm">Загрузка остатка из Smartup…</div>
      ) : unplaced.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-4 text-sm text-gray-500">✓ Весь остаток склада 001 разложен по ячейкам.</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          {unplaced.map((u) => {
            const d = draft[u.product_code] || { loc: '', qty: String(u.qty), card: '' };
            const set = (patch: Partial<typeof d>) => setDraft((s) => ({ ...s, [u.product_code]: { ...d, ...patch } }));
            return (
              <div key={u.product_code} className="p-3 flex flex-wrap items-center gap-2">
                <div className="flex-1 min-w-[180px]">
                  <div className="text-sm font-medium">{u.product_name}</div>
                  <div className="text-xs text-gray-400">код {u.product_code} · остаток {u.qty} шт</div>
                </div>
                <input list="wms-loc-list" value={d.loc} onChange={(e) => set({ loc: e.target.value })} placeholder="ячейка"
                  className="w-24 border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm uppercase outline-none focus:border-blue-400" />
                <input type="number" min={1} value={d.qty} onChange={(e) => set({ qty: e.target.value })}
                  className="w-16 border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right outline-none focus:border-blue-400" />
                <input value={d.card} onChange={(e) => set({ card: e.target.value })} placeholder="№ карт."
                  className="w-20 border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
                <button onClick={() => place(u)} disabled={busyCode === u.product_code}
                  className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white text-sm font-semibold rounded-lg">
                  {busyCode === u.product_code ? '⏳' : 'Положить'}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <datalist id="wms-loc-list">{locs.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</datalist>
    </div>
  );
}

// ─── По ячейкам (обзор размещённого) ─────────────────────────────────────────
function OverviewTab() {
  const [placed, setPlaced] = useState<WmsPlacedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  useEffect(() => { wmsOverview().then((o) => setPlaced(o.placed)).catch(() => {}).finally(() => setLoading(false)); }, []);
  const list = placed.filter((p) => !q.trim() || p.product_name.toLowerCase().includes(q.toLowerCase()) || p.product_code.includes(q.trim()));
  if (loading) return <div className="text-gray-500 text-sm">Загрузка…</div>;
  return (
    <div className="flex flex-col gap-3">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по товару / коду…"
        className="w-full max-w-md border rounded-lg px-3 py-2 text-sm" />
      <div className="bg-white rounded-xl shadow-sm p-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-gray-400">
            <th className="py-1 pr-2">Товар</th><th className="py-1 pr-2 text-right">Остаток (Smartup)</th>
            <th className="py-1 pr-2 text-right">Разложено</th><th className="py-1">Ячейки</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {list.map((p) => (
              <tr key={p.product_code}>
                <td className="py-1.5 pr-2"><div className="font-medium">{p.product_name}</div><div className="text-gray-400">{p.product_code}</div></td>
                <td className="py-1.5 pr-2 text-right">{p.total}</td>
                <td className={`py-1.5 pr-2 text-right ${p.placed !== p.total ? 'text-amber-600 font-semibold' : ''}`}>{p.placed}</td>
                <td className="py-1.5 text-gray-600">{p.cells.map((c) => `${c.location}: ${c.qty}`).join(', ')}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={4} className="py-3 text-center text-gray-400">Ничего не размещено</td></tr>}
          </tbody>
        </table>
      </div>
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
        setTitle(`${r.product_name} (${r.product_code})`); setRows(r.rows);
      } else {
        setTitle(`Ячейка ${q.trim().toUpperCase()}`); setRows(await wmsListByLocation(q.trim()));
      }
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {([['product', 'По товару'], ['location', 'По ячейке']] as ['product' | 'location', string][]).map(([k, label]) => (
          <button key={k} onClick={() => { setMode(k); setRows([]); setTitle(''); }}
            className={`px-3 py-1.5 text-xs font-semibold rounded ${mode === k ? 'bg-white shadow-sm' : 'text-gray-500'}`}>{label}</button>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
          placeholder={mode === 'product' ? 'штрихкод / код товара' : 'ячейка (напр. A1)'}
          className="flex-1 min-w-0 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        <button onClick={search} disabled={busy} className="px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white font-semibold rounded-lg shrink-0">{busy ? '⏳' : 'Найти'}</button>
      </div>
      {err && <div className="text-sm text-red-500">{err}</div>}
      {title && (
        <div className="bg-white rounded-xl shadow-sm p-3">
          <div className="font-semibold text-sm mb-2">{title}</div>
          {rows.length === 0 ? <div className="text-sm text-gray-400">Ничего не найдено (нет остатка).</div> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-gray-400">
                <th className="py-1 pr-2">{mode === 'product' ? 'Ячейка' : 'Товар'}</th>
                <th className="py-1 pr-2 text-right">Кол-во</th><th className="py-1 text-right">№ карточки</th>
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
    try { await wmsCreateLocation({ code: code.trim(), label: label.trim(), zone: zone.trim() }); setCode(''); setLabel(''); load(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function del(c: string) {
    if (!confirm(`Удалить ячейку ${c}?`)) return;
    try { await wmsDeleteLocation(c); load(); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="flex flex-col gap-3 max-w-2xl">
      <div className="bg-white rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-2">
        <div><label className="text-xs text-gray-500 mb-1 block">Код ячейки</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="A1"
            className="w-28 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm uppercase outline-none focus:border-blue-400" /></div>
        <div><label className="text-xs text-gray-500 mb-1 block">Название</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Колонна 1"
            className="w-40 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" /></div>
        <div><label className="text-xs text-gray-500 mb-1 block">Зона</label>
          <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Ряд A"
            className="w-32 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" /></div>
        <button onClick={add} disabled={busy} className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg">+ Добавить</button>
      </div>
      {err && <div className="text-sm text-red-500">{err}</div>}
      <div className="bg-white rounded-xl shadow-sm p-3">
        <div className="text-xs text-gray-400 mb-2">Всего ячеек: {locs.length}</div>
        {locs.length === 0 ? <div className="text-sm text-gray-400">Ячеек пока нет — добавьте первую (например, по колоннам ангара).</div> : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-gray-400"><th className="py-1 pr-2">Код</th><th className="py-1 pr-2">Название</th><th className="py-1 pr-2">Зона</th><th className="py-1"></th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {locs.map((l) => (
                <tr key={l.code}>
                  <td className="py-1.5 pr-2 font-mono font-semibold">{l.code}</td>
                  <td className="py-1.5 pr-2">{l.label}</td>
                  <td className="py-1.5 pr-2 text-gray-500">{l.zone || '—'}</td>
                  <td className="py-1.5 text-right"><button onClick={() => del(l.code)} className="text-red-500 hover:text-red-700">🗑️</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
