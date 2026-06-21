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

interface Suggestion { display_name: string; lat: string; lon: string }

// Кнопка "указать на карте" — раскрывает мини-карту, клик ставит/двигает метку.
export default function LocationPicker({ lat, lng, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const mapDivRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function placeMarker(plat: number, plng: number) {
    const L = getL();
    if (!mapRef.current) return;
    if (markerRef.current) markerRef.current.setLatLng([plat, plng]);
    else markerRef.current = L.marker([plat, plng]).addTo(mapRef.current);
    mapRef.current.setView([plat, plng], 16);
    onChange(plat, plng);
  }

  async function fetchSuggestions(text: string) {
    try {
      const q = encodeURIComponent(text);
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=5&countrycodes=uz`, {
        headers: { 'Accept-Language': 'ru' },
      });
      const data = await res.json() as Suggestion[];
      setSuggestions(data);
      setShowSuggestions(data.length > 0);
    } catch { /* ignore */ }
  }

  function handleQueryChange(text: string) {
    setQuery(text);
    setSearchErr('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 3) { setSuggestions([]); setShowSuggestions(false); return; }
    debounceRef.current = setTimeout(() => fetchSuggestions(text.trim()), 350);
  }

  function pickSuggestion(s: Suggestion) {
    setQuery(s.display_name);
    setShowSuggestions(false);
    placeMarker(parseFloat(s.lat), parseFloat(s.lon));
  }

  async function handleSearch() {
    if (!query.trim() || searching) return;
    setSearching(true);
    setSearchErr('');
    setShowSuggestions(false);
    try {
      const q = encodeURIComponent(query.trim());
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=uz`, {
        headers: { 'Accept-Language': 'ru' },
      });
      const data = await res.json() as Suggestion[];
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
          <div className="relative mt-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleSearch(); }
                  if (e.key === 'Escape') setShowSuggestions(false);
                }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder="🔍 Поиск по адресу / городу (Узбекистан)"
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
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border-2 border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(s)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-0"
                  >
                    📍 {s.display_name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {searchErr && <p className="text-xs text-red-500 mt-1">{searchErr}</p>}
          <div ref={mapDivRef} className="rounded-lg mt-2 border-2 border-gray-200" style={{ height: 280 }} />
        </>
      )}
    </div>
  );
}
