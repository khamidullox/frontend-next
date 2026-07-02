'use client';

import { useEffect, useState, useMemo } from 'react';
import AdminGate from '@/components/AdminGate';
import LogisticsTabs from '@/components/LogisticsTabs';
import { DeliveryStatus, DELIVERY_STATUS_LABEL, DocType, DOC_TYPE_LABEL } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

interface HistoryEntry {
  id: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  doc_type: DocType | null;
  doc_number: string | null;
  doc_id: string | null;
  client_name: string;
  from_name: string | null;
  to_name: string | null;
  status: DeliveryStatus;
  driver_name: string | null;
  driver_username: string | null;
  car_number: string | null;
  external: boolean;
  route_id: string | null;
  history: { at: string; status: DeliveryStatus; by: string }[];
  is_duplicate: boolean;
}

const STATUS_COLOR: Record<DeliveryStatus, string> = {
  new: 'bg-gray-100 text-gray-600',
  assigned: 'bg-amber-100 text-amber-700',
  on_way: 'bg-blue-100 text-blue-700',
  delivered: 'bg-green-100 text-green-700',
  returned: 'bg-red-100 text-red-700',
};

const DAYS_OPTIONS = [
  { label: 'Сегодня', days: 1 },
  { label: '7 дней', days: 7 },
  { label: '30 дней', days: 30 },
];

function shortId(id: string) {
  return id.slice(-6).toUpperCase();
}

function assignedAt(entry: HistoryEntry): string | null {
  const ev = entry.history?.find((h) => h.status === 'assigned');
  return ev?.at ?? null;
}

export default function HistoryPage() {
  return (
    <AdminGate min="manager">
      <HistoryContent />
    </AdminGate>
  );
}

function HistoryContent() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | ''>('');
  const [search, setSearch] = useState('');
  const [onlyDupes, setOnlyDupes] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/logistics/history?days=${days}`)
      .then((r) => r.json())
      .then((j) => setData(j.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((d) => {
      if (statusFilter && d.status !== statusFilter) return false;
      if (onlyDupes && !d.is_duplicate) return false;
      if (q) {
        const hay = [
          d.doc_number, d.doc_id, d.client_name, d.from_name, d.to_name,
          d.driver_name, d.car_number, d.created_by, shortId(d.id),
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, statusFilter, onlyDupes, search]);

  const dupeCount = useMemo(() => data.filter((d) => d.is_duplicate).length, [data]);
  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of data) counts[d.status] = (counts[d.status] || 0) + 1;
    return counts;
  }, [data]);

  return (
    <div className="p-4 max-w-7xl mx-auto">
      <LogisticsTabs />

      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h1 className="text-xl font-bold">📋 История заявок</h1>
        <div className="flex gap-1">
          {DAYS_OPTIONS.map((o) => (
            <button key={o.days} onClick={() => setDays(o.days)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${days === o.days ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Сводка */}
      <div className="flex flex-wrap gap-3 mb-4">
        <Chip label="Всего" value={data.length} color="gray" />
        <Chip label="Доставлено" value={stats.delivered || 0} color="green" />
        <Chip label="В пути" value={stats.on_way || 0} color="blue" />
        <Chip label="Возвратов" value={stats.returned || 0} color="red" />
        {dupeCount > 0 && (
          <Chip label="Дублей" value={dupeCount} color="amber" onClick={() => setOnlyDupes((v) => !v)} active={onlyDupes} />
        )}
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по ID, номеру, клиенту, водителю..."
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[200px] outline-none focus:border-blue-400" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as DeliveryStatus | '')}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400 bg-white">
          <option value="">Все статусы</option>
          {(Object.keys(DELIVERY_STATUS_LABEL) as DeliveryStatus[]).map((s) => (
            <option key={s} value={s}>{DELIVERY_STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>

      {loading && <div className="text-center py-10 text-gray-400">Загрузка...</div>}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-10 text-gray-400">Нет заявок за выбранный период</div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-3 py-2 font-semibold">ID</th>
                <th className="px-3 py-2 font-semibold">Документ / клиент</th>
                <th className="px-3 py-2 font-semibold">Создано</th>
                <th className="px-3 py-2 font-semibold">Водитель</th>
                <th className="px-3 py-2 font-semibold">Назначен</th>
                <th className="px-3 py-2 font-semibold">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((d) => (
                <Row key={d.id} d={d} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ d }: { d: HistoryEntry }) {
  const assigned = assignedAt(d);
  const docLabel = d.doc_type ? `${DOC_TYPE_LABEL[d.doc_type]} №${d.doc_number || d.doc_id}` : null;
  const route = d.from_name && d.to_name ? `${d.from_name} → ${d.to_name}` : null;

  return (
    <tr className={`hover:bg-gray-50 transition-colors ${d.is_duplicate ? 'bg-amber-50' : ''}`}>
      {/* ID */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="font-mono text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
          #{shortId(d.id)}
        </span>
        {d.is_duplicate && (
          <span className="ml-1 text-[10px] font-bold text-amber-600 bg-amber-100 px-1 py-0.5 rounded" title="Этот документ добавлен как заявка несколько раз">
            ⚠️ дубль
          </span>
        )}
      </td>

      {/* Документ + клиент */}
      <td className="px-3 py-2.5 max-w-[260px]">
        {docLabel && (
          <div className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded inline-block mb-0.5">
            {docLabel}
          </div>
        )}
        <div className="font-medium text-gray-800 truncate">
          {route || d.client_name || '—'}
        </div>
        {route && d.client_name && (
          <div className="text-xs text-gray-500 truncate">{d.client_name}</div>
        )}
      </td>

      {/* Создано */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <div className="text-xs text-gray-700">{fmtDateTime(d.created_at)}</div>
        {d.created_by && (
          <div className="text-[11px] text-gray-400">{d.created_by}</div>
        )}
      </td>

      {/* Водитель */}
      <td className="px-3 py-2.5">
        {d.driver_name ? (
          <div>
            <div className="text-xs font-medium text-gray-800">
              {d.external && <span className="text-orange-500 mr-1">🚖</span>}
              {d.driver_name}
            </div>
            {d.car_number && <div className="text-[11px] text-gray-400">{d.car_number}</div>}
          </div>
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        )}
      </td>

      {/* Когда назначен */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        {assigned ? (
          <div className="text-xs text-gray-600">{fmtDateTime(assigned)}</div>
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        )}
      </td>

      {/* Статус */}
      <td className="px-3 py-2.5">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[d.status]}`}>
          {DELIVERY_STATUS_LABEL[d.status]}
        </span>
      </td>
    </tr>
  );
}

function Chip({
  label, value, color, onClick, active,
}: {
  label: string; value: number; color: string; onClick?: () => void; active?: boolean;
}) {
  const colors: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-700',
    green: 'bg-green-100 text-green-700',
    blue: 'bg-blue-100 text-blue-700',
    red: 'bg-red-100 text-red-700',
    amber: active ? 'bg-amber-500 text-white' : 'bg-amber-100 text-amber-700',
  };
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold ${colors[color] || colors.gray} ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
    >
      <span className="text-lg font-bold">{value}</span>
      <span className="font-normal text-xs">{label}</span>
    </div>
  );
}
