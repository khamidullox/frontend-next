'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminGate from '@/components/AdminGate';
import {
  wmsListLocations, wmsCreateLocation, wmsDeleteLocation,
  wmsPlace, wmsFindByProduct, wmsListByLocation, wmsOverview, wmsBulkImport,
  WmsLocation, WmsStockRow, WmsPlacedProduct, WmsUnplaced, WMS_WAREHOUSES,
} from '@/lib/api';
import { loadXLSX } from '@/lib/xlsx';

// Адрес ячейки из ангар/колонна/строка: «А»+«1»+«2» → «А1-2».
function buildCellCode(h: string, c: string, r: string): string {
  const hh = h.trim().toUpperCase(); const cc = c.trim().toUpperCase(); const rr = r.trim().toUpperCase();
  if (!hh && !cc && !rr) return '';
  return `${hh}${cc}${rr ? `-${rr}` : ''}`;
}
function cellZone(h: string): string { return h.trim() ? `Ангар ${h.trim().toUpperCase()}` : ''; }
function cellLabel(h: string, c: string, r: string): string {
  const parts = [h.trim() && `Ангар ${h.trim().toUpperCase()}`, c.trim() && `кол ${c.trim()}`, r.trim() && `стр ${r.trim()}`].filter(Boolean);
  return parts.join(' · ');
}

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
  const [wh, setWh] = useState(WMS_WAREHOUSES[0]);
  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 className="text-xl font-bold">📦 WMS — адресное хранение</h2>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Склад:</span>
          <select value={wh} onChange={(e) => setWh(e.target.value)}
            className="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm font-semibold bg-white outline-none focus:border-blue-400">
            {WMS_WAREHOUSES.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs text-gray-400 mb-3">Остаток выбранного склада из Smartup распределяется по ячейкам. Приход/уход сверяется автоматически.</p>
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit flex-wrap">
        {([['distribute', '📥 Нужно разместить'], ['overview', '📊 По ячейкам'], ['find', '🔎 Найти'], ['locations', '🗄️ Ячейки']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-semibold rounded-lg ${tab === k ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'distribute' && <DistributeTab wh={wh} />}
      {tab === 'overview' && <OverviewTab wh={wh} />}
      {tab === 'find' && <FindTab wh={wh} />}
      {tab === 'locations' && <LocationsTab wh={wh} />}
    </div>
  );
}

// ─── Нужно разместить ────────────────────────────────────────────────────────
function DistributeTab({ wh }: { wh: string }) {
  const [unplaced, setUnplaced] = useState<WmsUnplaced[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busyCode, setBusyCode] = useState('');
  const [importing, setImporting] = useState(false);
  // черновик: ангар/колонна/строка/кол-во по каждому товару
  const [draft, setDraft] = useState<Record<string, { h: string; c: string; r: string; qty: string }>>({});

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setUnplaced((await wmsOverview(wh)).unplaced); }
    catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [wh]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function place(u: WmsUnplaced) {
    const d = draft[u.product_code] || { h: '', c: '', r: '', qty: String(u.qty) };
    const code = buildCellCode(d.h, d.c, d.r);
    if (!code) { setErr('Укажите ангар/колонну'); return; }
    setBusyCode(u.product_code); setErr('');
    try {
      await wmsPlace(wh, { location: code, product: u.product_code, qty: Number(d.qty) || u.qty, autoCreate: true, zone: cellZone(d.h), label: cellLabel(d.h, d.c, d.r) });
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusyCode(''); }
  }

  async function exportXlsx() {
    try {
      const XLSX = await loadXLSX();
      const data = unplaced.map((u) => ({
        'Код товара': u.product_code, 'Наименование': u.product_name, 'Остаток': u.qty,
        'Кол-во': u.qty, 'Ангар': '', 'Колонна': '', 'Строка': '',
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Разместить');
      XLSX.writeFile(wb, `wms_razmestit_${wh}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) { setErr((e as Error).message); }
  }

  async function importXlsx(file: File) {
    setImporting(true); setErr(''); setMsg('');
    try {
      const XLSX = await loadXLSX();
      const wb = XLSX.read(await file.arrayBuffer());
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rowsRaw = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];
      const rows = rowsRaw.map((r: Record<string, unknown>) => {
        const product = String(r['Код товара'] ?? r['код товара'] ?? '').trim();
        const h = String(r['Ангар'] ?? '').trim();
        const c = String(r['Колонна'] ?? '').trim();
        const rr = String(r['Строка'] ?? '').trim();
        const qty = Number(r['Кол-во'] ?? r['Остаток'] ?? 0) || 0;
        return { product, location: buildCellCode(h, c, rr), qty, zone: cellZone(h), label: cellLabel(h, c, rr) };
      }).filter((x: { product: string; location: string; qty: number }) => x.product && x.location && x.qty > 0);
      if (!rows.length) { setErr('В файле нет строк с заполненными Ангар/Колонна и Кол-во'); return; }
      const res = await wmsBulkImport(wh, rows);
      setMsg(`✓ Разложено: ${res.placed}${res.errors.length ? `, ошибок: ${res.errors.length}` : ''}`);
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setImporting(false); }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={load} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200">↻ Обновить</button>
        <button onClick={exportXlsx} disabled={!unplaced.length} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">⬇️ Экспорт Excel</button>
        <label className={`text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer ${importing ? 'bg-gray-100 text-gray-400' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}>
          {importing ? '⏳ Импорт…' : '⬆️ Импорт Excel'}
          <input type="file" accept=".xlsx,.xls" className="hidden" disabled={importing}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importXlsx(f); e.target.value = ''; }} />
        </label>
        <span className="text-xs text-gray-400">Товаров без ячейки: {unplaced.length}</span>
      </div>
      <div className="text-[11px] text-gray-400">
        Массовая раскладка: «Экспорт Excel» → заполните в файле столбцы <b>Ангар / Колонна / Строка</b> (и при необходимости <b>Кол-во</b>) → «Импорт Excel». Ячейки создаются автоматически.
      </div>
      {msg && <div className="text-sm text-emerald-600">{msg}</div>}
      {err && <div className="text-sm text-red-500">{err}</div>}

      {loading ? (
        <div className="text-gray-500 text-sm">Загрузка остатка из Smartup…</div>
      ) : unplaced.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-4 text-sm text-gray-500">✓ Весь остаток склада {wh} разложен по ячейкам.</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-gray-400">
              <th className="py-2 px-3">Товар</th>
              <th className="py-2 px-1 text-right">Остаток</th>
              <th className="py-2 px-1">Ангар</th>
              <th className="py-2 px-1">Колонна</th>
              <th className="py-2 px-1">Строка</th>
              <th className="py-2 px-1 text-right">Кол-во</th>
              <th className="py-2 px-3"></th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {unplaced.map((u) => {
                const d = draft[u.product_code] || { h: '', c: '', r: '', qty: String(u.qty) };
                const set = (patch: Partial<typeof d>) => setDraft((s) => ({ ...s, [u.product_code]: { ...d, ...patch } }));
                return (
                  <tr key={u.product_code}>
                    <td className="py-1.5 px-3"><div className="font-medium break-words">{u.product_name}</div><div className="text-gray-400">код {u.product_code}</div></td>
                    <td className="py-1.5 px-1 text-right text-gray-500">{u.qty}</td>
                    <td className="py-1.5 px-1"><input value={d.h} onChange={(e) => set({ h: e.target.value })} placeholder="А" className="w-12 border border-gray-200 rounded px-1.5 py-1 text-xs uppercase outline-none focus:border-blue-400" /></td>
                    <td className="py-1.5 px-1"><input value={d.c} onChange={(e) => set({ c: e.target.value })} placeholder="1" className="w-12 border border-gray-200 rounded px-1.5 py-1 text-xs outline-none focus:border-blue-400" /></td>
                    <td className="py-1.5 px-1"><input value={d.r} onChange={(e) => set({ r: e.target.value })} placeholder="2" className="w-12 border border-gray-200 rounded px-1.5 py-1 text-xs outline-none focus:border-blue-400" /></td>
                    <td className="py-1.5 px-1"><input type="number" min={1} value={d.qty} onChange={(e) => set({ qty: e.target.value })} className="w-16 border border-gray-200 rounded px-1.5 py-1 text-xs text-right outline-none focus:border-blue-400" /></td>
                    <td className="py-1.5 px-3 text-right">
                      <button onClick={() => place(u)} disabled={busyCode === u.product_code}
                        className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white text-xs font-semibold rounded-lg whitespace-nowrap">
                        {busyCode === u.product_code ? '⏳' : 'Положить'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── По ячейкам (обзор размещённого) ─────────────────────────────────────────
function OverviewTab({ wh }: { wh: string }) {
  const [placed, setPlaced] = useState<WmsPlacedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setLoading(true); wmsOverview(wh).then((o) => setPlaced(o.placed)).catch(() => {}).finally(() => setLoading(false)); }, [wh]);
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
function FindTab({ wh }: { wh: string }) {
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
        const r = await wmsFindByProduct(wh, q.trim());
        setTitle(`${r.product_name} (${r.product_code})`); setRows(r.rows);
      } else {
        setTitle(`Ячейка ${q.trim().toUpperCase()}`); setRows(await wmsListByLocation(wh, q.trim()));
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
function LocationsTab({ wh }: { wh: string }) {
  const [locs, setLocs] = useState<WmsLocation[]>([]);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [zone, setZone] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { wmsListLocations(wh).then(setLocs).catch(() => {}); }, [wh]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    setErr('');
    if (!code.trim()) { setErr('Укажите код ячейки'); return; }
    setBusy(true);
    try { await wmsCreateLocation(wh, { code: code.trim(), label: label.trim(), zone: zone.trim() }); setCode(''); setLabel(''); load(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function del(c: string) {
    if (!confirm(`Удалить ячейку ${c}?`)) return;
    try { await wmsDeleteLocation(wh, c); load(); } catch (e) { setErr((e as Error).message); }
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
