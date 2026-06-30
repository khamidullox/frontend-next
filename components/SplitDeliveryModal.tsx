'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Delivery, UserInfo, DeliveryItemDim, fetchDeliveryItemDims, splitDeliveryApi,
  LogisticsSettings, defaultCapacity,
} from '@/lib/api';

interface Props {
  delivery: Delivery;
  drivers: UserInfo[];
  capSettings: LogisticsSettings | null;
  defaultCapSettings: LogisticsSettings;
  onClose: () => void;
  onDone: () => void;
}

// Разделение доставки по вместимости: водителю уходит выбранная часть, остаток
// остаётся в исходной доставке (собрано, без водителя).
export default function SplitDeliveryModal({ delivery, drivers, capSettings, defaultCapSettings, onClose, onDone }: Props) {
  const [driver, setDriver] = useState(delivery.driver_username || '');
  const [items, setItems] = useState<DeliveryItemDim[]>([]);
  const [take, setTake] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetchDeliveryItemDims(delivery.id)
      .then((d) => { setItems(d.items); setTake(Object.fromEntries(d.items.map((i) => [i.code, 0]))); })
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false));
  }, [delivery.id]);

  const cap = useMemo(() => {
    const d = drivers.find((x) => x.username === driver);
    if (!d) return { kg: 0, m3: 0 };
    const kg = d.capacity_kg > 0 ? d.capacity_kg : defaultCapacity(d.transport, capSettings || defaultCapSettings).kg;
    const m3 = d.capacity_m3 > 0 ? d.capacity_m3 : defaultCapacity(d.transport, capSettings || defaultCapSettings).m3;
    return { kg, m3 };
  }, [driver, drivers, capSettings, defaultCapSettings]);

  const sel = useMemo(() => {
    let w = 0, v = 0, qty = 0;
    for (const it of items) {
      const t = take[it.code] || 0;
      w += t * it.unit_weight; v += t * it.unit_volume_l; qty += t;
    }
    return { w, v: v / 1000, qty };
  }, [items, take]);

  function autofill() {
    let w = 0, v = 0;
    const capKg = cap.kg > 0 ? cap.kg : Infinity;
    const capL = cap.m3 > 0 ? cap.m3 * 1000 : Infinity;
    const next: Record<string, number> = {};
    for (const it of items) {
      let t = 0;
      while (t < it.qty && w + it.unit_weight <= capKg && v + it.unit_volume_l <= capL) {
        w += it.unit_weight; v += it.unit_volume_l; t++;
      }
      next[it.code] = t;
    }
    setTake(next);
  }

  async function confirm() {
    setErr('');
    if (!driver) { setErr('Выберите водителя'); return; }
    const list = items.map((i) => ({ code: i.code, qty: take[i.code] || 0 })).filter((x) => x.qty > 0);
    if (!list.length) { setErr('Укажите, сколько взять'); return; }
    setBusy(true);
    try { await splitDeliveryApi(delivery.id, driver, list); onDone(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  const pctKg = cap.kg > 0 ? Math.round((sel.w / cap.kg) * 100) : 0;
  const over = cap.kg > 0 && sel.w > cap.kg;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div className="font-bold">✂️ Назначить часть · {delivery.doc_number ? `№${delivery.doc_number}` : delivery.client_name}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select value={driver} onChange={(e) => setDriver(e.target.value)}
            className="border-2 border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400">
            <option value="">— водитель —</option>
            {drivers.map((d) => <option key={d.username} value={d.username}>{d.name}{d.transport ? ` · ${d.transport}` : ''}</option>)}
          </select>
          <button onClick={autofill} disabled={!driver}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50">
            ⚡ Заполнить по вместимости
          </button>
        </div>

        {driver && (
          <div className={`text-xs mb-2 ${over ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
            Берём: {Math.round(sel.w)} кг{cap.kg > 0 ? ` / ${cap.kg} кг (${pctKg}%)` : ''} · {sel.v.toFixed(2)} м³{cap.m3 > 0 ? ` / ${cap.m3} м³` : ''} · {sel.qty} шт
            {over && ' — перегруз!'}
          </div>
        )}

        {loading ? <div className="text-sm text-gray-500">Загрузка состава…</div> : (
          <div className="border border-gray-100 rounded-lg divide-y divide-gray-100 mb-3">
            {items.map((it) => (
              <div key={it.code} className="flex items-center gap-2 p-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" title={it.name}>{it.name}</div>
                  <div className="text-[11px] text-gray-400">всего {it.qty} шт · {it.unit_weight ? `${it.unit_weight} кг/шт` : 'вес ?'}</div>
                </div>
                <input type="number" min={0} max={it.qty} value={take[it.code] ?? 0}
                  onChange={(e) => setTake((s) => ({ ...s, [it.code]: Math.max(0, Math.min(it.qty, Math.floor(Number(e.target.value) || 0))) }))}
                  className="w-16 border-2 border-gray-200 rounded-lg px-2 py-1 text-sm text-right outline-none focus:border-blue-400" />
                <span className="text-[11px] text-gray-400 w-10">из {it.qty}</span>
              </div>
            ))}
          </div>
        )}

        {err && <div className="text-sm text-red-500 mb-2">{err}</div>}
        <div className="flex gap-2">
          <button onClick={confirm} disabled={busy}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white text-sm font-semibold rounded-lg">
            {busy ? '⏳…' : 'Назначить часть водителю'}
          </button>
          <button onClick={onClose} disabled={busy} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-lg">Отмена</button>
        </div>
        <div className="text-[11px] text-gray-400 mt-2">Остаток (что не взяли) останется в этой накладной как «Собрано», без водителя.</div>
      </div>
    </div>
  );
}
