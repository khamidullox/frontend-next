'use client';

import { useEffect, useState } from 'react';

// Диагностика устройства на странице входа. Показывает понятную подсказку вместо
// голой ошибки браузера, когда вход не проходит по «телефонным» причинам:
//  • нет связи с сервером (интернет / Private DNS / VPN / экономия трафика);
//  • сбитые дата/время (ломают проверку HTTPS-сертификата — частая причина «у всех
//    работает, а у одного нет»).
// Если страница вообще не загрузилась — подсказка, конечно, не покажется; помогает
// в случаях, когда страница открылась, но запросы не проходят / время неверное.
const SKEW_MS = 3 * 60 * 1000; // расхождение часов больше 3 минут считаем проблемой

export default function DeviceCheck() {
  const [issue, setIssue] = useState<null | 'offline' | 'clock'>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t0 = Date.now();
        const res = await fetch('/api/ping', { cache: 'no-store' });
        const t1 = Date.now();
        if (!res.ok) throw new Error('bad status');
        const data = await res.json();
        const serverNow = Number(data.now);
        const deviceMid = (t0 + t1) / 2; // середина запроса — компенсируем задержку сети
        if (cancelled) return;
        if (Number.isFinite(serverNow) && Math.abs(serverNow - deviceMid) > SKEW_MS) {
          setIssue('clock');
        }
      } catch {
        if (!cancelled) setIssue('offline');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!issue) return null;

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
      {issue === 'clock' ? (
        <>
          <div className="font-semibold mb-1">⚠️ Неверные дата и время на телефоне</div>
          Из-за этого вход может не работать. Откройте <b>Настройки → Дата и время</b> и включите
          <b> «Автоматически»</b>, затем обновите страницу.
        </>
      ) : (
        <>
          <div className="font-semibold mb-1">⚠️ Нет связи с сервером</div>
          Проверьте интернет. Если он есть — частые причины на телефоне:
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            <li>сбитые <b>дата/время</b> (Настройки → Дата и время → «Автоматически»);</li>
            <li>включён <b>Приватный DNS</b> (Настройки → Подключения → выключить);</li>
            <li>включён <b>VPN</b> или <b>экономия трафика</b>.</li>
          </ul>
        </>
      )}
    </div>
  );
}
