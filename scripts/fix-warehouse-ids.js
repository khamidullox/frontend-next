// Разовый скрипт: переводит user.warehouses / user.home_warehouse со старой схемы
// (код, выдранный из названия склада) на настоящий warehouse_id. Запуск:
//   node scripts/fix-warehouse-ids.js          — только отчёт, без записи
//   node scripts/fix-warehouse-ids.js --write   — применить изменения

const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = process.env[m[1]] || m[2];
  }
}
loadEnvLocal();

const WRITE = process.argv.includes('--write');

const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
initializeApp({ credential: cert(svc) });
const db = getFirestore();

const FIXED_ASSETS_RE = /vositalar/i;

function whCode(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

async function fetchWarehouses() {
  const auth = 'Basic ' + Buffer.from(process.env.SMARTUP_USERNAME + ':' + process.env.SMARTUP_PASSWORD).toString('base64');
  const res = await fetch('https://smartup.online/b/anor/mxsx/mkw/warehouse$export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth, project_code: 'anor' },
    body: JSON.stringify({}),
  });
  const data = JSON.parse(await res.text());
  return (data.warehouse || []).map((w) => ({
    id: String(w.warehouse_id || ''),
    name: String(w.name || ''),
    code: String(w.code || ''),
  }));
}

async function main() {
  const refs = await fetchWarehouses();
  const byId = new Map(refs.map((r) => [r.id, r]));
  const byCode = new Map(refs.filter((r) => r.code).map((r) => [r.code, r]));

  // Резолвит одно значение (старый код/токен из названия) в warehouse_id.
  // Никогда не возвращает склад «Asosiy vositalar» — если совпадение
  // только на него, считаем неразрешённым (требует ручной проверки).
  function resolve(value) {
    if (byId.has(value)) return { id: value, how: 'id' };
    const byRealCode = byCode.get(value);
    if (byRealCode && !FIXED_ASSETS_RE.test(byRealCode.name)) return { id: byRealCode.id, how: 'code' };
    const nameMatches = refs.filter((r) => whCode(r.name) === value && !FIXED_ASSETS_RE.test(r.name));
    if (nameMatches.length === 1) return { id: nameMatches[0].id, how: 'name-token' };
    if (nameMatches.length > 1) return { id: null, how: 'ambiguous', candidates: nameMatches };
    return { id: null, how: 'not-found' };
  }

  const snap = await db.collection('users').get();
  const report = [];
  let changedCount = 0;

  for (const doc of snap.docs) {
    const u = doc.data();
    const oldWh = Array.isArray(u.warehouses) ? u.warehouses : [];
    const oldHome = u.home_warehouse || '';

    const resolvedWh = [];
    const whIssues = [];
    for (const v of oldWh) {
      const r = resolve(v);
      if (r.id) { if (!resolvedWh.includes(r.id)) resolvedWh.push(r.id); }
      else whIssues.push({ value: v, ...r });
    }

    let resolvedHome = oldHome;
    let homeIssue = null;
    if (oldHome) {
      const r = resolve(oldHome);
      if (r.id) resolvedHome = r.id;
      else { homeIssue = { value: oldHome, ...r }; resolvedHome = ''; }
    }

    const whChanged = JSON.stringify([...oldWh].sort()) !== JSON.stringify([...resolvedWh].sort());
    const homeChanged = oldHome !== resolvedHome;

    if (whChanged || homeChanged || whIssues.length || homeIssue) {
      report.push({
        username: doc.id,
        oldWh, resolvedWh, whIssues,
        oldHome, resolvedHome, homeIssue,
        willWrite: whChanged || homeChanged,
      });
      if (whChanged || homeChanged) changedCount++;
    }
  }

  console.log(`Пользователей с изменениями: ${changedCount} (плюс отдельно отмеченные проблемы без авторазрешения)\n`);
  for (const r of report) {
    console.log(`@${r.username}`);
    if (r.oldWh.length || r.resolvedWh.length) {
      console.log(`  Склады: [${r.oldWh.join(', ')}] -> [${r.resolvedWh.join(', ')}]`);
    }
    if (r.whIssues.length) {
      for (const i of r.whIssues) console.log(`    ⚠ не разрешено: "${i.value}" (${i.how})${i.candidates ? ' candidates=' + i.candidates.map(c=>c.name).join(' | ') : ''}`);
    }
    if (r.oldHome || r.resolvedHome) {
      console.log(`  Свой склад: "${r.oldHome}" -> "${r.resolvedHome}"`);
    }
    if (r.homeIssue) {
      console.log(`    ⚠ не разрешено: "${r.homeIssue.value}" (${r.homeIssue.how})`);
    }
    console.log('');
  }

  if (WRITE) {
    let written = 0;
    for (const r of report) {
      if (!r.willWrite) continue;
      await db.collection('users').doc(r.username).set(
        { warehouses: r.resolvedWh, home_warehouse: r.resolvedHome },
        { merge: true }
      );
      written++;
    }
    console.log(`Записано изменений: ${written}`);
  } else {
    console.log('Это предпросмотр (без --write). Запустите с --write, чтобы применить.');
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
