'use client';

import { useEffect, useRef, useState } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getL(): any {
  return (window as unknown as { L?: unknown }).L;
}

function ensureLeaflet(onReady: () => void) {
  if (getL()) { onReady(); return; }
  if (!document.getElementById('leaflet-css')) {
    const link = document.createElement('link');
    link.id = 'leaflet-css';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }
  const existing = document.getElementById('leaflet-js') as HTMLScriptElement | null;
  if (existing) { existing.addEventListener('load', onReady); if (getL()) onReady(); return; }
  const script = document.createElement('script');
  script.id = 'leaflet-js';
  script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
  script.onload = onReady;
  document.head.appendChild(script);
}

interface Props {
  lat?: number;
  lng?: number;
  onChange: (lat: number, lng: number) => void;
}

// Кнопка "указать на карте" — раскрывает мини-карту, клик ставит/двигает метку.
export default function LocationPicker({ lat, lng, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const mapDivRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);

  function placeMarker(plat: number, plng: number) {
    const L = getL();
    if (!mapRef.current) return;
    if (markerRef.current) markerRef.current.setLatLng([plat, plng]);
    else markerRef.current = L.marker([plat, plng]).addTo(mapRef.current);
    mapRef.current.setView([plat, plng], 16);
    onChange(plat, plng);
  }

  async function handleSearch() {
    if (!query.trim() || searching) return;
    setSearching(true);
    setSearchErr('');
    try {
      const q = encodeURIComponent(`${query.trim()}, Узбекистан`);
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`, {
        headers: { 'Accept-Language': 'ru' },
      });
      const data = await res.json() as { lat: string; lon: string }[];
      if (data.length > 0) {
        placeMarker(parseFloat(data[0].lat), parseFloat(data[0].lon));
      } else {
        setSearchErr('Не найдено');
      }
    } catch {
      setSearchErr('Ошибка поиска');
    } finally {
      setSearching(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    ensureLeaflet(() => {
      if (cancelled || !mapDivRef.current || mapRef.current) return;
      const L = getL();
      const startLat = lat ?? 40.461, startLng = lng ?? 71.755;
      const map = L.map(mapDivRef.current).setView([startLat, startLng], lat && lng ? 15 : 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
      if (lat && lng) markerRef.current = L.marker([lat, lng]).addTo(map);
      map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
        const { lat: clat, lng: clng } = e.latlng;
        if (markerRef.current) markerRef.current.setLatLng([clat, clng]);
        else markerRef.current = L.marker([clat, clng]).addTo(map);
        onChange(clat, clng);
      });
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-2 border-2 border-gray-200 rounded-lg text-sm text-left hover:border-blue-400 w-full"
      >
        📍 {lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'Указать на карте'}
      </button>
      {open && (
        <>
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSearchErr(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSearch(); } }}
              placeholder="🔍 Поиск по адресу / городу"
              className="flex-1 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm outline-none focus:border-blue-400"
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={searching || !query.trim()}
              className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-200 text-white text-sm font-semibold rounded-lg whitespace-nowrap"
            >
              {searching ? '⏳' : 'Найти'}
            </button>
          </div>
          {searchErr && <p className="text-xs text-red-500 mt-1">{searchErr}</p>}
          <div ref={mapDivRef} className="rounded-lg mt-2 border-2 border-gray-200" style={{ height: 280 }} />
        </>
      )}
    </div>
  );
}
