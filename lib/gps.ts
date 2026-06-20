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

// Открываем страницу платформы чтобы получить ASP.NET_SessionId
async function bootstrapSession(token: string): Promise<string> {
  const loginUrl = `https://www.gps16888.com/user/indexp.aspx?mds=${token}`;
  const res = await fetch(loginUrl, {
    cache: 'no-store',
    redirect: 'follow',
    headers: { 'User-Agent': BASE_UA },
  });
  // Собираем все Set-Cookie заголовки
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

export async function fetchGpsRaw(): Promise<string> {
  const token = process.env.GPS_MDS_TOKEN;
  if (!token) return 'NO_TOKEN';
  try {
    const cookie = await bootstrapSession(token);
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

export async function fetchAllGpsLocations(): Promise<GpsLocation[]> {
  const token = process.env.GPS_MDS_TOKEN;
  if (!token) return [];

  try {
    const cookie = await bootstrapSession(token);
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
    if (!res.ok) return [];
    return parseGpsJson(await res.text());
  } catch {
    return [];
  }
}
