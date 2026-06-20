'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AdminGate from '@/components/AdminGate';
import { listShops, createShop, deleteShopApi, listAllWarehouses, Shop, WarehouseSummary, DIRECTIONS, ShopType } from '@/lib/api';
import ConfirmModal from '@/components/ConfirmModal';

const DIR_COLOR: Record<string, string> = {
  'Север': 'bg-blue-100 text-blue-700',
  'Юг': 'bg-green-100 text-green-700',
  'Восток': 'bg-orange-100 text-orange-700',
  'Запад': 'bg-purple-100 text-purple-700',
  'Центр': 'bg-amber-100 text-amber-700',
};

export default function ShopsPage() {
  return (
    <AdminGate min="manager">
      <ShopsContent />
    </AdminGate>
  );
}

function ShopsContent() {
  const [items, setItems] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<{ msg: string; onOk: () => void } | null>(null);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [direction, setDirection] = useState<string>('Центр');
  const [km, setKm] = useState('');
  const [phone, setPhone] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [type, setType] = useState<ShopType>('shop');

  const [warehouses, setWarehouses] = useState<WarehouseSummary[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const nameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listAllWarehouses().then(setWarehouses).catch(() => {});
  }, []);

  // Закрыть список при клике вне
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (nameRef.current && !nameRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const suggestions = name.trim().length >= 1
    ? warehouses.filter(w => w.warehouse_name.toLowerCase().includes(name.toLowerCase())).slice(0, 10)
    : warehouses.slice(0, 10);

  function pickWarehouse(w: WarehouseSummary) {
    setName(w.warehouse_name);
    setShowSuggestions(false);
  }

  const load = useCallback(async () => {
    try { setItems(await listShops()); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError('');
    try {
      const shop = await createShop({ name, address, direction, km: Number(km) || 0, phone,
        lat: lat ? Number(lat) : undefined, lng: lng ? Number(lng) : undefined, type });
      setItems(prev => [...prev, shop].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
      setName(''); setAddress(''); setKm(''); setPhone(''); setLat(''); setLng('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function remove(id: string) {
    setConfirmState({
      msg: 'Удалить точку?',
      onOk: async () => {
        setConfirmState(null);
        try { await deleteShopApi(id); setItems(prev => prev.filter(s => s.id !== id)); }
        catch (e) { setError((e as Error).message); }
      },
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Link href="/logistics" className="text-sm text-gray-500 hover:text-gray-700">← Логистика</Link>
        <h2 className="text-xl font-bold ml-1">🏪 Точки доставки <span className="text-sm text-gray-400 font-normal">({items.length})</span></h2>
      </div>

      <form onSubmit={add} className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-col gap-2">
        <div className="text-xs font-semibold text-gray-500">+ Добавить магазин / адрес</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div ref={nameRef} className="flex-1 relative">
            <input
              value={name}
              onChange={e => { setName(e.target.value); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              placeholder="Название (Базар №1)"
              autoComplete="off"
              className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                {suggestions.map(w => (
                  <button
                    key={w.warehouse_id}
                    type="button"
                    onMouseDown={() => pickWarehouse(w)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 truncate border-b border-gray-100 last:border-0"
                  >
                    🏭 {w.warehouse_name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Адрес"
            className="flex-[2] border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <select value={type} onChange={e => setType(e.target.value as ShopType)}
            className="sm:w-36 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400">
            <option value="shop">🏪 Магазин</option>
            <option value="warehouse">🏭 Склад (база)</option>
          </select>
          <select value={direction} onChange={e => setDirection(e.target.value)}
            className="sm:w-36 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400">
            {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <input type="number" min={0} step="0.1" value={km} onChange={e => setKm(e.target.value)} placeholder="Км"
            className="sm:w-24 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Телефон"
            className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>
        <div className="flex flex-col sm:flex-row gap-2 items-end">
          <input type="number" step="any" value={lat} onChange={e => setLat(e.target.value)} placeholder="Широта (40.44513)"
            className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <input type="number" step="any" value={lng} onChange={e => setLng(e.target.value)} placeholder="Долгота (71.75780)"
            className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <button disabled={busy || !name.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg whitespace-nowrap">
            {busy ? '⏳…' : '+ Добавить'}
          </button>
        </div>
      </form>

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-gray-500 text-sm">
          <span className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" /> Загрузка…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">Точек пока нет</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map(s => (
            <div key={s.id} className="bg-white rounded-lg shadow-sm px-3 py-2.5 flex items-center gap-3">
              <span className="text-xl shrink-0">{s.type === 'warehouse' ? '🏭' : '🏪'}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{s.name}</div>
                <div className="text-[11px] text-gray-400 truncate">
                  {s.address || '—'}
                  {s.km > 0 && ` · ${s.km} км`}
                  {s.phone && ` · ${s.phone}`}
                  {s.lat && s.lng && <span className="text-emerald-600"> · 📍 {s.lat.toFixed(4)}, {s.lng.toFixed(4)}</span>}
                </div>
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${DIR_COLOR[s.direction] || 'bg-gray-100 text-gray-600'}`}>
                {s.direction}
              </span>
              <button onClick={() => remove(s.id)} className="text-red-400 hover:text-red-600 text-lg px-1">✕</button>
            </div>
          ))}
        </div>
      )}

      {confirmState && (
        <ConfirmModal
          message={confirmState.msg}
          onOk={confirmState.onOk}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}
