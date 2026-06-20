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

function buildGpsUrl(token: string) {
  return `https://www.gps16888.com/GetDataService.aspx?method=loadUser&mds=${token}&callback=loadedCallback&_=${Date.now()}`;
}

function gpsHeaders(token: string) {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    'Referer': `https://www.gps16888.com/user/indexp.aspx?mds=${token}`,
    'Accept': 'text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
  };
}

export async function fetchGpsRaw(): Promise<string> {
  const token = process.env.GPS_MDS_TOKEN;
  if (!token) return 'NO_TOKEN';
  try {
    const res = await fetch(buildGpsUrl(token), { cache: 'no-store', headers: gpsHeaders(token) });
    return `status=${res.status} | ` + (await res.text());
  } catch (e) {
    return `fetch_error: ${e}`;
  }
}

export async function fetchAllGpsLocations(): Promise<GpsLocation[]> {
  const token = process.env.GPS_MDS_TOKEN;
  if (!token) return [];

  const res = await fetch(buildGpsUrl(token), {
    cache: 'no-store',
    headers: gpsHeaders(token),
  });

  if (!res.ok) return [];

  const text = await res.text();
  // Try JSONP format: loadedCallback({...})
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
