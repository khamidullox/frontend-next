'use client';

// Клиентский (браузерный) запрос GPS-локаций через JSONP.
// Серверный запрос с Vercel блокируется платформой gps16888.com (403, IP датацентра),
// поэтому запрос идёт прямо из браузера пользователя — mds+user_id работает без cookies.

export interface GpsLocation {
  user_name: string;
  user_id: string;
  lat: number;
  lng: number;
  speed: number;
  sys_time: string;
  heart_time: string;
  alarm: number;
  sim_id: string;
}

let counter = 0;

function fetchOneJsonp(token: string, userId: string, timeoutMs = 8000): Promise<GpsLocation | null> {
  return new Promise((resolve) => {
    const cbName = `__gpsCb${Date.now()}_${counter++}`;
    const script = document.createElement('script');
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      if (done) return;
      done = true;
      delete (window as unknown as Record<string, unknown>)[cbName];
      script.remove();
      clearTimeout(timer);
    };
    (window as unknown as Record<string, unknown>)[cbName] = (data: { success?: string; data?: Record<string, unknown>[] }) => {
      const d = data?.data?.[0];
      cleanup();
      if (data?.success !== 'true' || !d || !d.jingdu || !d.weidu) { resolve(null); return; }
      resolve({
        user_name: String(d.user_name || ''),
        user_id: String(d.user_id || ''),
        lat: Number(d.weidu) || 0,
        lng: Number(d.jingdu) || 0,
        speed: Math.round(Number(d.sudu) || 0),
        sys_time: String(d.sys_time || ''),
        heart_time: String(d.heart_time || ''),
        alarm: Number(d.alarm) || 0,
        sim_id: String(d.sim_id || ''),
      });
    };
    timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    script.src = `https://www.gps16888.com/GetDataService.aspx?method=loadUser&mds=${token}&callback=${cbName}&user_id=${userId}&_=${Date.now()}`;
    script.onerror = () => { cleanup(); resolve(null); };
    document.head.appendChild(script);
  });
}

export async function fetchGpsLocationsClient(userIds: string[]): Promise<GpsLocation[]> {
  const token = process.env.NEXT_PUBLIC_GPS_MDS_TOKEN;
  if (!token || userIds.length === 0) return [];
  const results = await Promise.all(userIds.map((id) => fetchOneJsonp(token, id)));
  return results.filter((r): r is GpsLocation => r !== null);
}
