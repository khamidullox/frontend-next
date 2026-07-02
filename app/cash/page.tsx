'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminGate from '@/components/AdminGate';
import { useAuth } from '@/components/AuthProvider';
import {
  ROLE_RANK, listDriverCash, settleDriverCash, getMyCash, DriverCashBalance,
} from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

function money(n: number) {
  return `${Math.round(n).toLocaleString('ru-RU')} сум`;
}

export default function CashPage() {
  return (
    <AdminGate min="driver">
      <CashContent />
    </AdminGate>
  );
}

function CashContent() {
  const { session } = useAuth();
  const isManager = session ? ROLE_RANK[session.role] >= ROLE_RANK['manager'] : false;
  return isManager ? <ManagerCash /> : <DriverCash />;
}

// ─── Менеджер/админ: Касса → Логистика ───────────────────────────────────────
function ManagerCash() {
  const [rows, setRows] = useState<DriverCashBalance[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<DriverCashBalance | null>(null);

  const load = useCallback(async () => {
    try {
      const { data, total } = await listDriverCash();
      setRows(data);
      setTotal(total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function settle(b: DriverCashBalance) {
    setBusy(b.driver_username);
    setError('');
    try {
      await settleDriverCash(b.driver_username);
      setConfirm(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  if (loading) return <div className="text-gray-400 text-sm p-4">Загрузка…</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">💰 Касса · Логистика</h1>
        <div className="text-sm bg-emerald-50 text-emerald-700 font-semibold px-3 py-1.5 rounded-lg">
          Всего на руках: {money(total)}
        </div>
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-400">
          Нет наличных к сдаче — у всех водителей по нулям 👍
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((b) => (
            <div key={b.driver_username} className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => setExpanded(expanded === b.driver_username ? null : b.driver_username)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="font-semibold text-sm truncate">👤 {b.driver_name}</div>
                  <div className="text-xs text-gray-400">{b.count} доставок · нажмите, чтобы раскрыть</div>
                </button>
                <div className="text-lg font-bold text-emerald-600 whitespace-nowrap">{money(b.total)}</div>
                <button
                  onClick={() => setConfirm(b)}
                  disabled={busy === b.driver_username}
                  className="px-3 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white text-xs font-semibold rounded-lg whitespace-nowrap"
                >
                  {busy === b.driver_username ? '⏳…' : '✅ Принял'}
                </button>
              </div>
              {expanded === b.driver_username && (
                <div className="border-t border-gray-100 px-4 py-2 flex flex-col gap-1.5 bg-gray-50">
                  {b.deliveries.map((d) => (
                    <div key={d.id} className="flex items-center justify-between text-xs">
                      <span className="truncate text-gray-600">
                        {d.doc_number ? `№${d.doc_number} · ` : ''}{d.client_name}
                        <span className="text-gray-400 ml-1">{fmtDateTime(d.delivered_at)}</span>
                      </span>
                      <span className="font-semibold text-gray-700 whitespace-nowrap ml-2">{money(d.cash_amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">Принять наличные</h3>
            <p className="text-sm text-gray-600 mb-4">
              Подтвердите, что водитель <b>{confirm.driver_name}</b> сдал <b>{money(confirm.total)}</b> ({confirm.count} доставок).
              После этого его касса обнулится.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirm(null)} className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-xl font-semibold text-gray-600">
                Отмена
              </button>
              <button onClick={() => settle(confirm)} disabled={busy === confirm.driver_username}
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white rounded-xl font-semibold">
                {busy === confirm.driver_username ? '⏳…' : 'Принял'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Водитель: моя касса ─────────────────────────────────────────────────────
function DriverCash() {
  const [bal, setBal] = useState<DriverCashBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getMyCash().then(setBal).catch((e) => setError((e as Error).message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-400 text-sm p-4">Загрузка…</div>;
  if (error) return <p className="text-red-500 text-sm">{error}</p>;

  const total = bal?.total || 0;
  const deliveries = bal?.deliveries || [];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">💰 Моя касса</h1>

      <div className={`rounded-2xl p-5 text-center ${total > 0 ? 'bg-emerald-50' : 'bg-gray-50'}`}>
        <div className="text-xs text-gray-500 mb-1">Нужно сдать менеджеру</div>
        <div className={`text-3xl font-bold ${total > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{money(total)}</div>
        {deliveries.length > 0 && <div className="text-xs text-gray-400 mt-1">по {deliveries.length} доставкам</div>}
      </div>

      {deliveries.length === 0 ? (
        <div className="text-center text-gray-400 text-sm">Наличных нет — всё сдано 👍</div>
      ) : (
        <div className="flex flex-col gap-2">
          {deliveries.map((d) => (
            <div key={d.id} className="bg-white rounded-xl shadow-sm px-4 py-3 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {d.doc_number ? `№${d.doc_number} · ` : ''}{d.client_name}
                </div>
                <div className="text-xs text-gray-400">{fmtDateTime(d.delivered_at)}</div>
              </div>
              <div className="text-base font-bold text-emerald-600 whitespace-nowrap ml-2">{money(d.cash_amount)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
