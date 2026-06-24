'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AdminGate from '@/components/AdminGate';
import {
  listShops, createShop, updateShop, deleteShopApi, listAllWarehouses, listDeliveries,
  Shop, WarehouseSummary, ShopType, Delivery, DeliveryStatus, DELIVERY_STATUS_LABEL,
} from '@/lib/api';
import ConfirmModal from '@/components/ConfirmModal';
import { normalizeName } from '@/lib/normalize';
import * as XLSX from 'xlsx';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Определяет город/населённый пункт по координатам (обратное геокодирование OSM).
async function cityFromCoords(lat: number, lng: number): Promise<string> {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ru&zoom=12`,
      { headers: { 'Accept-Language': 'ru' } }
    );
    const data = (await r.json()) as { address?: Record<string, string> };
    const a = data.address || {};
    return a.city || a.town || a.municipality || a.village || a.county || a.state || '';
  } catch {
    return '';
  }
}

const DELIVERY_STATUS_BADGE: Record<DeliveryStatus, string> = {
  new: 'bg-gray-100 text-gray-600', assigned: 'bg-amber-100 text-amber-700', on_way: 'bg-blue-100 text-blue-700',
  delivered: 'bg-green-100 text-green-700', returned: 'bg-red-100 text-red-700',
};

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
  const [direction, setDirection] = useState<string>('');
  const [km, setKm] = useState('');
  const [phone, setPhone] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [type, setType] = useState<ShopType>('shop');

  // Автодетект
  const [autoInfo, setAutoInfo] = useState<{ dir: string; km: number; baseName: string } | null>(null);
  const [detectingCity, setDetectingCity] = useState(false);
  const cityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Список складов Smartup (для подсказки названия)
  const [warehouses, setWarehouses] = useState<WarehouseSummary[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const nameRef = useRef<HTMLDivElement>(null);

  // Импорт точек из Excel
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  // Редактирование точки
  const [editShop, setEditShop] = useState<Shop | null>(null);

  // Массовое определение городов
  const [geocodingAll, setGeocodingAll] = useState(false);

  // Точки назначения накладных база → клиент (warehouse_dispatch), у которых нет
  // соответствия в справочнике (ни по shop_id, ни по нормализованному названию) —
  // предлагаем добавить как точку типа «клиент» (👤, см. fillFromUnlinked).
  const [unlinked, setUnlinked] = useState<{ name: string; count: number }[]>([]);

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

  // Какие получатели накладных база → клиент ещё не привязаны ни к одной точке.
  useEffect(() => {
    if (!items.length) { setUnlinked([]); return; }
    let cancelled = false;
    const known = new Set(items.map((s) => normalizeName(s.name)));
    listDeliveries()
      .then((all) => {
        if (cancelled) return;
        const counts = new Map<string, { name: string; count: number }>();
        for (const d of all) {
          if (d.kind !== 'warehouse_dispatch' || d.shop_id || !d.to_name) continue;
          const norm = normalizeName(d.to_name);
          if (!norm || known.has(norm)) continue;
          const cur = counts.get(norm) || { name: d.to_name, count: 0 };
          cur.count += 1;
          counts.set(norm, cur);
        }
        setUnlinked([...counts.values()].sort((a, b) => b.count - a.count));
      })
      .catch(() => { if (!cancelled) setUnlinked([]); });
    return () => { cancelled = true; };
  }, [items]);

  function fillFromUnlinked(destName: string) {
    setName(destName);
    setType('client');
    nameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Базы — склады с координатами
  const bases = items.filter(s => s.type === 'warehouse' && s.lat && s.lng);

  // Выбранная база
  // Определение города по координатам (с задержкой, чтобы не дёргать на каждый символ).
  function recalc(latVal: string, lngVal: string) {
    const latN = parseFloat(latVal);
    const lngN = parseFloat(lngVal);
    if (isNaN(latN) || isNaN(lngN) || latN === 0 || lngN === 0) {
      setAutoInfo(null);
      return;
    }
    if (cityTimer.current) clearTimeout(cityTimer.current);
    setDetectingCity(true);
    cityTimer.current = setTimeout(async () => {
      const city = await cityFromCoords(latN, lngN);
      setDetectingCity(false);
      if (city) {
        setDirection(city);
        setAutoInfo({ dir: city, km: 0, baseName: '' });
      }
    }, 700);
  }

  function onLatChange(v: string) {
    setLat(v);
    recalc(v, lng);
  }
  function onLngChange(v: string) {
    setLng(v);
    recalc(lat, v);
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
      setAutoInfo(null); setDirection('');
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
          if (lat !== undefined && lng !== undefined) {
            if (base && base.lat && base.lng) km = haversineKm(base.lat, base.lng, lat, lng);
            // Город по координатам (Nominatim ~1 запрос/сек — ставим паузу).
            direction = await cityFromCoords(lat, lng);
            await new Promise((r) => setTimeout(r, 1100));
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

  // Сохранение изменений из модалки.
  async function saveEdit(patch: { name: string; address: string; direction: string; km: number; phone: string; lat?: number; lng?: number; type: ShopType }) {
    if (!editShop) return;
    try {
      const upd = await updateShop(editShop.id, patch);
      setItems(prev => prev.map(s => s.id === upd.id ? upd : s).sort((a, b) => a.name.localeCompare(b.name, 'ru')));
      setEditShop(null);
    } catch (e) { setError((e as Error).message); }
  }

  // Определить города для всех точек с координатами, у которых город не задан
  // (пусто или старое значение по умолчанию «Центр»).
  async function geocodeAll() {
    setGeocodingAll(true); setError(''); setImportMsg('');
    const targets = items.filter(s => s.lat && s.lng && (!s.direction || s.direction === 'Центр'));
    if (targets.length === 0) {
      setGeocodingAll(false);
      setImportMsg('Нет точек с координатами для определения города');
      return;
    }
    let done = 0;
    for (const s of targets) {
      const city = await cityFromCoords(s.lat!, s.lng!);
      if (city) {
        try {
          const upd = await updateShop(s.id, { direction: city });
          setItems(prev => prev.map(x => x.id === upd.id ? upd : x));
          done++;
          setImportMsg(`Определено городов: ${done} из ${targets.length}…`);
        } catch { /* ignore */ }
      }
      await new Promise(r => setTimeout(r, 1100));
    }
    setGeocodingAll(false);
    setImportMsg(`Готово: определено городов — ${done} из ${targets.length}`);
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Link href="/logistics" className="text-sm text-gray-500 hover:text-gray-700">← Логистика</Link>
        <h2 className="text-xl font-bold ml-1">🏪 Точки доставки <span className="text-sm text-gray-400 font-normal">({items.length})</span></h2>
        <button
          onClick={geocodeAll}
          disabled={geocodingAll}
          title="Определить города по координатам для точек без города"
          className="ml-auto px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-semibold rounded-lg disabled:opacity-50 whitespace-nowrap"
        >
          {geocodingAll ? '⏳ Определяю…' : '🌍 Определить города'}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-lg disabled:opacity-50 whitespace-nowrap"
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

      {unlinked.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
          <div className="text-xs font-semibold text-amber-700 mb-2">
            ⚠️ Получатели накладных база → клиент без точки в справочнике ({unlinked.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {unlinked.map((u) => (
              <button key={u.name} onClick={() => fillFromUnlinked(u.name)}
                title="Заполнить форму ниже названием — останется указать адрес/координаты"
                className="text-xs px-2.5 py-1 rounded-full bg-white border border-amber-300 text-amber-700 hover:bg-amber-100 whitespace-nowrap">
                + {u.name} {u.count > 1 && <span className="text-amber-400">×{u.count}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

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
            <option value="client">👤 Клиент (магазин)</option>
            <option value="warehouse">🏭 Склад (база)</option>
          </select>
          <input value={direction} onChange={e => { setDirection(e.target.value); setAutoInfo(null); }}
            placeholder={detectingCity ? 'Определяю город…' : 'Город'}
            title="Заполняется автоматически по координатам, можно изменить"
            className="sm:w-40 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <input type="number" min={0} step="0.1" value={km} onChange={e => setKm(e.target.value)} placeholder="Км"
            className="sm:w-24 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Телефон"
            className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
        </div>

        {/* Координаты + автоопределение города */}
        <div className="flex flex-col sm:flex-row gap-2 items-end">
          <input type="number" step="any" value={lat} onChange={e => onLatChange(e.target.value)}
            placeholder="Широта (40.44513)"
            className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <input type="number" step="any" value={lng} onChange={e => onLngChange(e.target.value)}
            placeholder="Долгота (71.75780)"
            className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />

          <button disabled={busy || !name.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg whitespace-nowrap">
            {busy ? '⏳…' : '+ Добавить'}
          </button>
        </div>

        {autoInfo && (
          <div className="text-xs text-emerald-600 bg-emerald-50 rounded-lg px-3 py-1.5">
            ✓ Город: <strong>{autoInfo.dir}</strong>{autoInfo.km > 0 ? ` · ${autoInfo.km} км от «${autoInfo.baseName}»` : ''}
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
              <span className="text-xl shrink-0">{s.type === 'warehouse' ? '🏭' : s.type === 'client' ? '👤' : '🏪'}</span>
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
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${DIR_COLOR[s.direction] || 'bg-sky-100 text-sky-700'}`}>
                {s.direction || '—'}
              </span>
              <button onClick={() => setEditShop(s)} className="text-gray-400 hover:text-blue-600 text-base px-1" title="Изменить">✏️</button>
              <button onClick={() => remove(s.id)} className="text-red-400 hover:text-red-600 text-lg px-1">✕</button>
            </div>
          ))}
        </div>
      )}

      {editShop && (
        <EditShopModal shop={editShop} onClose={() => setEditShop(null)} onSave={saveEdit} />
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

// ─── Модалка редактирования точки ────────────────────────────────────────────
function EditShopModal({
  shop, onClose, onSave,
}: {
  shop: Shop;
  onClose: () => void;
  onSave: (patch: { name: string; address: string; direction: string; km: number; phone: string; lat?: number; lng?: number; type: ShopType }) => void;
}) {
  const [name, setName] = useState(shop.name);
  const [address, setAddress] = useState(shop.address || '');
  const [direction, setDirection] = useState(shop.direction || '');
  const [km, setKm] = useState(String(shop.km || ''));
  const [phone, setPhone] = useState(shop.phone || '');
  const [lat, setLat] = useState(shop.lat != null ? String(shop.lat) : '');
  const [lng, setLng] = useState(shop.lng != null ? String(shop.lng) : '');
  const [type, setType] = useState<ShopType>(shop.type === 'warehouse' || shop.type === 'client' ? shop.type : 'shop');
  const [detecting, setDetecting] = useState(false);
  const [busy, setBusy] = useState(false);

  async function detectCity() {
    const latN = parseFloat(lat), lngN = parseFloat(lng);
    if (isNaN(latN) || isNaN(lngN)) return;
    setDetecting(true);
    const city = await cityFromCoords(latN, lngN);
    setDetecting(false);
    if (city) setDirection(city);
  }

  function submit() {
    if (!name.trim()) return;
    setBusy(true);
    onSave({
      name: name.trim(), address: address.trim(), direction: direction.trim(),
      km: Number(km) || 0, phone: phone.trim(),
      lat: lat ? Number(lat) : undefined, lng: lng ? Number(lng) : undefined, type,
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-lg">Изменить точку</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="mb-4">
          <div className="text-xs font-semibold text-gray-500 mb-1.5">🚚 Доставки в эту точку</div>
          <ShopDeliveries shop={shop} />
        </div>

        <div className="flex flex-col gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Название"
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Адрес"
            className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          <div className="flex gap-2">
            <select value={type} onChange={e => setType(e.target.value as ShopType)}
              className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-blue-400">
              <option value="shop">🏪 Магазин</option>
              <option value="client">👤 Клиент (магазин)</option>
              <option value="warehouse">🏭 Склад (база)</option>
            </select>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Телефон"
              className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          </div>
          <div className="flex gap-2">
            <input value={direction} onChange={e => setDirection(e.target.value)} placeholder="Город"
              className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
            <input type="number" min={0} step="0.1" value={km} onChange={e => setKm(e.target.value)} placeholder="Км"
              className="w-24 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
          </div>
          <div className="flex gap-2 items-end">
            <input type="number" step="any" value={lat} onChange={e => setLat(e.target.value)} placeholder="Широта"
              className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
            <input type="number" step="any" value={lng} onChange={e => setLng(e.target.value)} placeholder="Долгота"
              className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400" />
            <button type="button" onClick={detectCity} disabled={detecting || !lat || !lng}
              className="px-3 py-2 bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-semibold rounded-lg disabled:opacity-50 whitespace-nowrap">
              {detecting ? '⏳' : '🌍 город'}
            </button>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={submit} disabled={busy || !name.trim()}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg">
            {busy ? '⏳…' : 'Сохранить'}
          </button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-sm font-semibold rounded-lg">Отмена</button>
        </div>
      </div>
    </div>
  );
}

// Доставки со склада в эту конкретную точку (раздел 1) — что едет/доставлено сюда сейчас.
function ShopDeliveries({ shop }: { shop: Shop }) {
  const [items, setItems] = useState<Delivery[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const norm = normalizeName(shop.name);
    listDeliveries()
      .then((all) => {
        if (cancelled) return;
        const matched = all
          .filter((d) => d.kind === 'warehouse_dispatch' && (d.shop_id === shop.id || (d.to_name && normalizeName(d.to_name) === norm)))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          .slice(0, 15);
        setItems(matched);
      })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [shop.id, shop.name]);

  if (items === null) {
    return <div className="text-xs text-gray-400 py-2">Загрузка…</div>;
  }
  if (!items.length) {
    return <div className="text-xs text-gray-400 py-2">Доставок в эту точку пока нет</div>;
  }
  return (
    <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
      {items.map((d) => (
        <div key={d.id} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-2.5 py-1.5">
          <span className="flex-1 min-w-0 truncate">
            {d.doc_number ? `№ ${d.doc_number}` : (d.client_name || '—')}
            {d.driver_name && <span className="text-gray-400"> · {d.driver_name}</span>}
          </span>
          <span className={`px-1.5 py-0.5 rounded-full font-medium shrink-0 ${DELIVERY_STATUS_BADGE[d.status]}`}>
            {DELIVERY_STATUS_LABEL[d.status]}
          </span>
        </div>
      ))}
    </div>
  );
}
