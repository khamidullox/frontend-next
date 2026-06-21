'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AdminGate from '@/components/AdminGate';
import { listShops, createShop, updateShop, deleteShopApi, listAllWarehouses, Shop, WarehouseSummary, DIRECTIONS, ShopType } from '@/lib/api';
import ConfirmModal from '@/components/ConfirmModal';
import * as XLSX from 'xlsx';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function calcDirection(baseLat: number, baseLng: number, lat: number, lng: number): string {
  const dist = haversineKm(baseLat, baseLng, lat, lng);
  if (dist < 3) return 'Центр';
  const dLng = (lng - baseLng) * Math.PI / 180;
  const lat1R = baseLat * Math.PI / 180;
  const lat2R = lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  if (bearing >= 315 || bearing < 45) return 'Север';
  if (bearing >= 45 && bearing < 135) return 'Восток';
  if (bearing >= 135 && bearing < 225) return 'Юг';
  return 'Запад';
}

// Сравниваем точки без учёта хвостового номера телефона в названии
// (в Excel-выгрузках номер бывает то актуальный, то старый — он не должен мешать сопоставлению).
function normalizeName(name: string): string {
  return name.replace(/\s*\d{6,}\s*$/, '').trim().toLowerCase();
}

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

  // Форма добавления
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [direction, setDirection] = useState<string>('Центр');
  const [km, setKm] = useState('');
  const [phone, setPhone] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [type, setType] = useState<ShopType>('shop');

  // Автодетект
  const [autoInfo, setAutoInfo] = useState<{ dir: string; km: number; baseName: string } | null>(null);
  const [selectedBaseId, setSelectedBaseId] = useState<string>('');

  // Список складов Smartup (для подсказки названия)
  const [warehouses, setWarehouses] = useState<WarehouseSummary[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const nameRef = useRef<HTMLDivElement>(null);

  // Импорт точек из Excel
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  useEffect(() => {
    listAllWarehouses().then(setWarehouses).catch(() => {});
  }, []);

  // Закрыть подсказку при клике вне
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (nameRef.current && !nameRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Загрузка точек
  const load = useCallback(async () => {
    try { setItems(await listShops()); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Базы — склады с координатами
  const bases = items.filter(s => s.type === 'warehouse' && s.lat && s.lng);

  // Выбранная база
  const selectedBase = bases.find(b => b.id === selectedBaseId) ?? bases[0] ?? null;

  // Пересчёт при смене координат или базы
  function recalc(latVal: string, lngVal: string, base: Shop | null) {
    const latN = parseFloat(latVal);
    const lngN = parseFloat(lngVal);
    if (!base || isNaN(latN) || isNaN(lngN) || latN === 0 || lngN === 0) {
      setAutoInfo(null);
      return;
    }
    const dir = calcDirection(base.lat!, base.lng!, latN, lngN);
    const distKm = haversineKm(base.lat!, base.lng!, latN, lngN);
    setDirection(dir);
    setKm(String(distKm));
    setAutoInfo({ dir, km: distKm, baseName: base.name });
  }

  function onLatChange(v: string) {
    setLat(v);
    recalc(v, lng, selectedBase);
  }
  function onLngChange(v: string) {
    setLng(v);
    recalc(lat, v, selectedBase);
  }
  function onBaseChange(id: string) {
    setSelectedBaseId(id);
    const base = bases.find(b => b.id === id) ?? bases[0] ?? null;
    recalc(lat, lng, base);
  }

  const suggestions = name.trim().length >= 1
    ? warehouses.filter(w => w.warehouse_name.toLowerCase().includes(name.toLowerCase())).slice(0, 10)
    : warehouses.slice(0, 10);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError('');
    try {
      const shop = await createShop({
        name, address, direction, km: Number(km) || 0, phone,
        lat: lat ? Number(lat) : undefined,
        lng: lng ? Number(lng) : undefined,
        type,
      });
      setItems(prev => [...prev, shop].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
      setName(''); setAddress(''); setKm(''); setPhone(''); setLat(''); setLng('');
      setAutoInfo(null); setDirection('Центр');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  // Импорт точек из Excel: колонки "Склад"(название), "Номер"(телефон), "Роль"(магазин/база), "Расположения"("lat, lng").
  async function handleImportFile(file: File) {
    setImporting(true); setImportMsg('');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      const base = bases[0] ?? null;
      let created = 0, updated = 0, skipped = 0;
      const nextItems = [...items];

      for (const row of rows.slice(1)) {
        const rawName = String(row[0] ?? '').trim();
        if (!rawName) { skipped++; continue; }
        const phone = row[1] ? String(row[1]) : '';
        const roleStr = String(row[2] ?? '').toLowerCase();
        const type: ShopType = roleStr.includes('магазин') ? 'shop' : 'warehouse';
        const locStr = String(row[3] ?? '').trim();
        let lat: number | undefined, lng: number | undefined;
        if (locStr.includes(',')) {
          const [a, b] = locStr.split(',').map((s) => parseFloat(s.trim()));
          if (!isNaN(a) && !isNaN(b)) { lat = a; lng = b; }
        }

        const norm = normalizeName(rawName);
        const existing = nextItems.find((s) => normalizeName(s.name) === norm);

        if (existing) {
          const patch: { lat?: number; lng?: number; phone?: string; type?: ShopType } = { type };
          if (lat !== undefined) patch.lat = lat;
          if (lng !== undefined) patch.lng = lng;
          if (phone) patch.phone = phone;
          try {
            const upd = await updateShop(existing.id, patch);
            const idx = nextItems.findIndex((s) => s.id === existing.id);
            nextItems[idx] = upd;
            updated++;
          } catch { skipped++; }
        } else {
          let direction: string | undefined, km: number | undefined;
          if (base && base.lat && base.lng && lat !== undefined && lng !== undefined && type === 'shop') {
            direction = calcDirection(base.lat, base.lng, lat, lng);
            km = haversineKm(base.lat, base.lng, lat, lng);
          }
          try {
            const created_shop = await createShop({ name: rawName, phone, type, lat, lng, direction, km });
            nextItems.push(created_shop);
            created++;
          } catch { skipped++; }
        }
      }

      setItems(nextItems.sort((a, b) => a.name.localeCompare(b.name, 'ru')));
      setImportMsg(`Готово: создано ${created}, обновлено ${updated}, пропущено ${skipped}`);
    } catch (e) {
      setImportMsg('Ошибка чтения файла: ' + (e as Error).message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
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
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="ml-auto px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-lg disabled:opacity-50 whitespace-nowrap"
        >
          {importing ? '⏳ Импорт…' : '📥 Импорт из Excel'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); }}
        />
      </div>
      {importMsg && <p className="text-xs text-emerald-600 mb-3">{importMsg}</p>}

      <form onSubmit={add} className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-col gap-2">
        <div className="text-xs font-semibold text-gray-500">+ Добавить магазин / адрес</div>

        {/* Название + адрес */}
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
                  <button key={w.warehouse_id} type="button"
                    onMouseDown={() => { setName(w.warehouse_name); setShowSuggestions(false); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 truncate border-b border-gray-100 last:border-0">
                    🏭 {w.warehouse_name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Адрес"
            className="flex-[2] border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>

        {/* Тип + направление + км + телефон */}
        <div className="flex flex-col sm:flex-row gap-2">
          <select value={type} onChange={e => setType(e.target.value as ShopType)}
            className="sm:w-36 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400">
            <option value="shop">🏪 Магазин</option>
            <option value="warehouse">🏭 Склад (база)</option>
          </select>
          <select value={direction} onChange={e => { setDirection(e.target.value); setAutoInfo(null); }}
            className="sm:w-36 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400">
            {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <input type="number" min={0} step="0.1" value={km} onChange={e => setKm(e.target.value)} placeholder="Км"
            className="sm:w-24 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Телефон"
            className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>

        {/* Координаты + база + автодетект */}
        <div className="flex flex-col sm:flex-row gap-2 items-end">
          <input type="number" step="any" value={lat} onChange={e => onLatChange(e.target.value)}
            placeholder="Широта (40.44513)"
            className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <input type="number" step="any" value={lng} onChange={e => onLngChange(e.target.value)}
            placeholder="Долгота (71.75780)"
            className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />

          {bases.length > 0 ? (
            <select
              value={selectedBaseId || bases[0]?.id || ''}
              onChange={e => onBaseChange(e.target.value)}
              className="flex-1 border-2 border-blue-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400"
              title="От какой базы считать направление и км"
            >
              {bases.map(b => (
                <option key={b.id} value={b.id}>🏭 от: {b.name}</option>
              ))}
            </select>
          ) : (
            <div className="text-xs text-amber-500 pb-2 whitespace-nowrap">
              Добавьте склад (базу) с координатами для автодетекта
            </div>
          )}

          <button disabled={busy || !name.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg whitespace-nowrap">
            {busy ? '⏳…' : '+ Добавить'}
          </button>
        </div>

        {autoInfo && (
          <div className="text-xs text-emerald-600 bg-emerald-50 rounded-lg px-3 py-1.5">
            ✓ От «{autoInfo.baseName}»: <strong>{autoInfo.dir}</strong> · {autoInfo.km} км
          </div>
        )}
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
                  {s.lat && s.lng && (
                    <span className="text-emerald-600"> · 📍 {s.lat.toFixed(4)}, {s.lng.toFixed(4)}</span>
                  )}
                </div>
                {/* Направление от каждой базы */}
                {s.lat && s.lng && bases.length > 1 && (
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {bases.map(b => b.id !== s.id && b.lat && b.lng ? (
                      <span key={b.id} className="text-[10px] text-gray-400">
                        {b.name.split(' ')[0]}: <strong>{calcDirection(b.lat, b.lng, s.lat!, s.lng!)}</strong> {haversineKm(b.lat, b.lng, s.lat!, s.lng!)}км
                      </span>
                    ) : null)}
                  </div>
                )}
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
