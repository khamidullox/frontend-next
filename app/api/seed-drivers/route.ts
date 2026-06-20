import { createUser } from '@/lib/users';
import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Одноразовый импорт водителей. Защищён ролью admin.
// После использования можно удалить этот файл.
const DRIVERS = [
  { name: "Zulfiqorov Sharifjon",     car: "40 100 UAA", transport: "COBALT",  phone: "90 166 85 26" },
  { name: "Jo'rabayev Alyorbek",      car: "40 T 070 RB", transport: "COBALT", phone: "97 501 99 11" },
  { name: "Po'latov Azimjon",         car: "40 V 447 KB", transport: "COBALT", phone: "97 557 60 60" },
  { name: "Karimov Izzatillo",        car: "40 Q 475 RB", transport: "COBALT", phone: "97 664 11 10" },
  { name: "Sultonov Ro'zimuhammad",   car: "40 Z 634 SB", transport: "LABO",   phone: "88 418 11 10" },
  { name: "Mo'ydinzoda Muhiddin",     car: "40 Z 803 SB", transport: "LABO",   phone: "94 363 52 47" },
  { name: "Ismoilov Turg'unali",      car: "40 Q 627 OB", transport: "LABO",   phone: "97 641 80 87" },
  { name: "Ibroximov Nuriddinbek",    car: "40 615 OBA",  transport: "LABO",   phone: "77 372 81 00" },
  { name: "Ma'murov Oybek",           car: "40 F 273 KB", transport: "LABO",   phone: "90 630 05 25" },
  { name: "Xasanov Asadullo",         car: "40 F 274 KB", transport: "LABO",   phone: "90 501 81 81" },
  { name: "Axmadjonov Qodirali",      car: "40 545 SBA",  transport: "LABO",   phone: "91 116 77 11" },
  { name: "G'aniyev G'olibjon",       car: "40 Z 385 KB", transport: "LABO",   phone: "94 135 77 71" },
  { name: "Raimov Begzod",            car: "40 L 243 KB", transport: "LABO",   phone: "97 960 04 44" },
  { name: "Davronov Erkinjon",        car: "40 H 061 QB", transport: "LABO",   phone: "88 411 88 55" },
  { name: "Abduqaxorov Abdusalom",    car: "40 F 346 KB", transport: "DAMAS",  phone: "90 919 97 97" },
  { name: "Maxmudov Saidjamol",       car: "40 308 UBA",  transport: "DAMAS",  phone: "91 326 11 86" },
  { name: "Jalilov Qudratillo",       car: "40 L 163 RB", transport: "DAMAS",  phone: "91 650 34 56" },
  { name: "Xatamov G'ofurjon",        car: "40 613 OBA",  transport: "MATIZ",  phone: "95 105 41 17" },
  { name: "Jalilov Boburjon",         car: "40 767 UAA",  transport: "33021",  phone: "91 047 26 06" },
  { name: "Shuxratov Rustambek",      car: "01 W 884 MC", transport: "LABO",   phone: "95 154 51 51" },
  { name: "Raximov Ilhomjon",         car: "01 P 669 NC", transport: "LABO",   phone: "91 005 79 45" },
  { name: "Nuraliyev Otamurod",       car: "40 H 052 QB", transport: "LABO",   phone: "94 355 53 50" },
];

const CAPACITY: Record<string, { kg: number; m3: number }> = {
  'LABO':   { kg: 1200, m3: 9 },
  'COBALT': { kg: 300,  m3: 0.4 },
  'DAMAS':  { kg: 750,  m3: 3.5 },
  'MATIZ':  { kg: 250,  m3: 0.3 },
  '33021':  { kg: 1500, m3: 10 },
};

function toUsername(name: string): string {
  // "Zulfiqorov Sharifjon" → "zulfiqorov"
  return name
    .split(' ')[0]
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function toPassword(phone: string): string {
  // "90 166 85 26" → "901668526"
  return phone.replace(/\s/g, '');
}

export async function POST() {
  return withRole('admin', async () => {
    const results: { name: string; username: string; status: string }[] = [];

    for (const d of DRIVERS) {
      const username = toUsername(d.name);
      const password = toPassword(d.phone);
      const cap = CAPACITY[d.transport] || { kg: 0, m3: 0 };
      const res = await createUser({
        username,
        name: d.name,
        role: 'driver',
        password,
        car_number: d.car,
        transport: `Chevrolet ${d.transport}`.replace('GAZ 33021', 'GAZ 33021').replace('Chevrolet 33021', 'GAZ 33021'),
        capacity_kg: cap.kg,
        capacity_m3: cap.m3,
      });
      results.push({
        name: d.name,
        username,
        status: 'error' in res ? `ошибка: ${res.error}` : 'создан',
      });
    }

    const created = results.filter(r => r.status === 'создан').length;
    const errors  = results.filter(r => r.status !== 'создан').length;
    return Response.json({ created, errors, results });
  });
}
