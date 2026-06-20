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

const BASE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

// Возвращает cookie строку для запросов к GPS платформе
async function getGpsCookie(token: string): Promise<string> {
  // Если задана вручную (из браузера пользователя) — используем её
  const manualSession = process.env.GPS_SESSION_ID;
  if (manualSession) {
    return `ASP.NET_SessionId=${manualSession}; domainIndex=0`;
  }
  // Иначе пробуем создать новую сессию через mds ссылку
  const loginUrl = `https://www.gps16888.com/user/indexp.aspx?mds=${token}`;
  const res = await fetch(loginUrl, {
    cache: 'no-store',
    redirect: 'follow',
    headers: { 'User-Agent': BASE_UA },
  });
  const cookies: string[] = [];
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      const part = value.split(';')[0];
      if (part) cookies.push(part);
    }
  });
  return cookies.join('; ');
}

function parseGpsJson(text: string): GpsLocation[] {
  const match = text.match(/loadedCallback\(([\s\S]+)\)/);
  let json: Record<string, unknown>;
  try {
    json = match ? JSON.parse(match[1]) : JSON.parse(text);
  } catch {
    return [];
  }
  if (json.success !== 'true' || !Array.isArray(json.data)) return [];
  return (json.data as Record<string, unknown>[])
    .filter((d) => d.jingdu && d.weidu)
    .map((d) => ({
      user_name: String(d.user_name || ''),
      user_id: String(d.user_id || ''),
      lat: Number(d.weidu) || 0,
      lng: Number(d.jingdu) || 0,
      speed: Math.round(Number(d.sudu) || 0),
      sys_time: String(d.sys_time || ''),
      heart_time: String(d.heart_time || ''),
      alarm: Number(d.alarm) || 0,
      sim_id: String(d.sim_id || ''),
    }));
}

// Тест: запрос конкретного user_id без сессии — проверяем работает ли mds+user_id
export async function fetchGpsRawUid(userId: string): Promise<string> {
  const token = process.env.GPS_MDS_TOKEN;
  if (!token) return 'NO_TOKEN';
  try {
    const url = `https://www.gps16888.com/GetDataService.aspx?method=loadUser&mds=${token}&callback=loadedCallback&user_id=${userId}&_=${Date.now()}`;
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { 'User-Agent': BASE_UA },
    });
    return `status=${res.status} | ` + (await res.text());
  } catch (e) {
    return `fetch_error: ${e}`;
  }
}

export async function fetchGpsRaw(): Promise<string> {
  const token = process.env.GPS_MDS_TOKEN;
  if (!token) return 'NO_TOKEN';
  try {
    const cookie = await getGpsCookie(token);
    const url = `https://www.gps16888.com/GetDataService.aspx?method=loadUser&mds=${token}&callback=loadedCallback&_=${Date.now()}`;
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'User-Agent': BASE_UA,
        'Referer': `https://www.gps16888.com/user/indexp.aspx?mds=${token}`,
        'Accept': 'text/javascript, application/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': cookie,
      },
    });
    return `cookie=${cookie} | status=${res.status} | ` + (await res.text());
  } catch (e) {
    return `fetch_error: ${e}`;
  }
}

async function fetchOneByUserId(token: string, userId: string): Promise<GpsLocation | null> {
  try {
    const url = `https://www.gps16888.com/GetDataService.aspx?method=loadUser&mds=${token}&callback=loadedCallback&user_id=${userId}&_=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store', headers: { 'User-Agent': BASE_UA } });
    if (!res.ok) return null;
    const locs = parseGpsJson(await res.text());
    return locs[0] ?? null;
  } catch {
    return null;
  }
}

// Основная функция: запрашивает GPS по списку user_id (mds+user_id работает без сессии)
export async function fetchGpsLocationsByUserIds(userIds: string[]): Promise<GpsLocation[]> {
  const token = process.env.GPS_MDS_TOKEN;
  if (!token || userIds.length === 0) return [];
  const results = await Promise.all(userIds.map((id) => fetchOneByUserId(token, id)));
  return results.filter((r): r is GpsLocation => r !== null);
}

export async function fetchAllGpsLocations(): Promise<GpsLocation[]> {
  return [];
}
