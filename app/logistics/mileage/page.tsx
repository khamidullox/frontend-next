'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminGate from '@/components/AdminGate';
import LogisticsTabs from '@/components/LogisticsTabs';
import { fetchDailyMileage, listDrivers, DailyMileageRow, UserInfo } from '@/lib/api';
import { fmtDateTime as fmt } from '@/lib/format';

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function MileagePage() {
  return (
    <AdminGate min="manager">
      <MileageContent />
    </AdminGate>
  );
}

function MileageContent() {
  const [date, setDate] = useState(() => isoDate(new Date()));
  const [rows, setRows] = useState<DailyMileageRow[]>([]);
  const [drivers, setDrivers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([fetchDailyMileage(date), listDrivers()])
      .then(([m, d]) => { setRows(m.data); setDrivers(d); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [date]);

  const driverByGpsId = useMemo(() => {
    const m = new Map<string, UserInfo>();
    for (const d of drivers) if (d.gps_user_id) m.set(d.gps_user_id, d);
    return m;
  }, [drivers]);

  const joined = useMemo(() => rows.map((r) => {
    const driver = driverByGpsId.get(r.user_id);
    return { ...r, driver_name: driver?.name || r.user_name || r.user_id, car_number: driver?.car_number || '' };
  }), [rows, driverByGpsId]);

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-xl font-bold mb-3">🚚 Логистика</h1>
      <LogisticsTabs />

      <p className="text-xs text-gray-500 mb-3">
        Пробег по GPS-трекерам (не путать с км доставок) — копится сам по себе раз в
        несколько минут из реального местоположения машины, независимо от того, есть
        ли активные доставки. Источник — GPS-Trace, у него нет готового отчёта «км за
        день», поэтому считаем сами по точкам.
      </p>

      <div className="bg-white rounded-xl shadow-sm p-3 mb-4 flex items-center gap-2">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          className="border-2 border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
        <button onClick={() => setDate(isoDate(new Date()))}
          className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">
          Сегодня
        </button>
      </div>

      {loading && <p className="text-gray-500">Загрузка…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && !error && (
        <div className="flex flex-col gap-2">
          {joined.map((r) => (
            <div key={r.user_id} className="bg-white rounded-xl shadow-sm p-3 flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">{r.driver_name}</div>
                {r.car_number && <div className="text-xs text-gray-500">🚐 {r.car_number}</div>}
                <div className="text-[11px] text-gray-400">обновлено {fmt(r.updated_at)}</div>
              </div>
              <div className="text-lg font-bold text-emerald-600">{r.km} км</div>
            </div>
          ))}
          {joined.length === 0 && <p className="text-gray-400 text-sm">За эту дату данных нет.</p>}
        </div>
      )}
    </div>
  );
}
