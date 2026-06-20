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

export async function fetchAllGpsLocations(): Promise<GpsLocation[]> {
  const token = process.env.GPS_MDS_TOKEN;
  if (!token) return [];

  const url = `https://www.gps16888.com/GetDataService.aspx?method=loadUser&mds=${token}&_=${Date.now()}`;

  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.gps16888.com/',
    },
  });

  if (!res.ok) return [];

  const text = await res.text();
  // Response format: loadedCallback({...})
  const match = text.match(/loadedCallback\((.+)\)/s);
  if (!match) return [];

  try {
    const json = JSON.parse(match[1]);
    if (json.success !== 'true' || !Array.isArray(json.data)) return [];

    return json.data
      .filter((d: Record<string, unknown>) => d.jingdu && d.weidu)
      .map((d: Record<string, unknown>) => ({
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
  } catch {
    return [];
  }
}
