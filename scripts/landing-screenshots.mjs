// Tar nya skärmbilder av Lossi till landningssidan (mappen landing/), i ljust och mörkt läge.
// Använder en låtsas-Supabase (scripts/mock-supabase.js) med exempeldata, så inget riktigt konto behövs.
//
// Kör så här (från projektmappen, med den lokala servern igång på port 8765):
//   python3 -m http.server 8765        # i en annan terminal
//   node scripts/landing-screenshots.mjs
// Kräver Google Chrome och Node 22+.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const BASE = 'http://localhost:8765';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'landing');

// Tillfälliga sidor som laddar låtsas-Supabase i stället för den riktiga
const TEMP = ['_mock-supabase.js', '_mobile-upplag.html', '_mobile-calendar.html', '_mobile-index.html'];
copyFileSync(join(ROOT, 'scripts/mock-supabase.js'), join(ROOT, '_mock-supabase.js'));
for (const page of ['upplag', 'calendar', 'index']) {
  const html = readFileSync(join(ROOT, page + '.html'), 'utf8')
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+"><\/script>/, '<script src="_mock-supabase.js"></script>')
    .replaceAll('upplag.html?id=', '_mobile-upplag.html?id=');
  writeFileSync(join(ROOT, `_mobile-${page}.html`), html);
}
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'lossi-shots-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const page = (await (await fetch('http://127.0.0.1:9334/json')).json()).find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error('no chrome');
}
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.error('eval error', JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
async function go(path, width = 1440, height = 920) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: BASE + path });
  await sleep(2600);
}
async function shot(name, clip) {
  const params = { format: 'webp', quality: 88, captureBeyondViewport: !!clip };
  if (clip) params.clip = { ...clip, scale: 1 };
  const r = await send('Page.captureScreenshot', params);
  writeFileSync(join(OUT, name + '.webp'), Buffer.from(r.result.data, 'base64'));
  console.log('saved', name);
}
// Sidkoordinater (inte fönster), som captureScreenshot vill ha
const rect = sel => evaluate(`const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };`);

try {
  ws = new WebSocket(await connect());
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  await send('Runtime.enable');
  await send('Page.enable');

  // ── Exempeldata ──
  await go('/login.html');
  await evaluate(`sessionStorage.removeItem('mockDb'); localStorage.setItem('lossi-profile-prompted','true'); localStorage.setItem('lossi-invite-dismissed','true'); localStorage.setItem('lossi-theme','light'); localStorage.setItem('lossi-plan-tips','1'); localStorage.removeItem('lossi-welcome'); return 1;`); // inga tips eller välkomstdialog i bilderna
  await go('/_mobile-upplag.html?id=1');
  console.log(await evaluate(`
    const pills = () => [...document.querySelectorAll('#structureList .week-pill')];
    document.querySelector('#structureList .lesson-time-pill-value').textContent = '90';
    applyLessonTemplate('undersokande');
    applyLessonTemplate('kooperativt');
    pills()[1].textContent = 'Lektion 2: Hur fattas beslut i Sverige?';
    pills()[2].textContent = 'Lektion 3: Demokrati i vardagen';
    const vals = document.querySelectorAll('#structureList .lesson-time-pill-value');
    vals[1].textContent = '60'; vals[2].textContent = '60';
    recalcLessonTimes();
    selectClass('7B');
    setStatus('started', 'Påbörjad');
    saveState();
    await new Promise(r => setTimeout(r, 1500));
    // Lägg in lektionerna i kalendern den här veckan
    const monday = new Date(); monday.setHours(0,0,0,0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    if ([0, 6].includes(new Date().getDay())) monday.setDate(monday.getDate() + 7);
    const at = (d, h, m) => { const x = new Date(monday); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x; };
    const ids = [...document.querySelectorAll('#structureList .lesson-group')].map(g => g.dataset.lessonId);
    await LossiData.scheduleLesson({ planId: '1', lessonId: ids[0], start: at(0, 8, 20), durationMin: 90 });
    await LossiData.scheduleLesson({ planId: '1', lessonId: ids[1], start: at(2, 10, 0), durationMin: 60 });
    await LossiData.scheduleLesson({ planId: '1', lessonId: ids[2], start: at(3, 13, 15), durationMin: 60 });
    return 'plan 1: ' + ids.length + ' lektioner';
  `));
  // Upplägg 2 och 3 med egna lektionsnamn och tider
  for (const [planId, title, names, slots] of [
    ['2', 'Källkritik i det digitala samhället', ['Lektion 1: Vem står bakom?', 'Lektion 2: Granska en nyhet'], [[1, 9, 0, 60], [4, 10, 30, 60]]],
    ['3', 'Fotosyntes – från molekyl till ekosystem', ['Lektion 1: Ljus blir energi', 'Lektion 2: Labb – syre i vattnet'], [[1, 13, 0, 80], [3, 8, 20, 60]]],
  ]) {
    await go(`/_mobile-upplag.html?id=${planId}`);
    console.log(await evaluate(`
      applyLessonTemplate('direkt');
      const groups = [...document.querySelectorAll('#structureList .lesson-group')];
      const names = ${JSON.stringify(names)};
      groups.forEach((g, i) => { if (names[i]) g.querySelector('.week-pill').textContent = names[i]; });
      recalcLessonTimes(); saveState();
      await new Promise(r => setTimeout(r, 1500));
      const monday = new Date(); monday.setHours(0,0,0,0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      if ([0, 6].includes(new Date().getDay())) monday.setDate(monday.getDate() + 7);
      const slots = ${JSON.stringify(slots)};
      for (let i = 0; i < slots.length; i++) {
        const [d, h, m, dur] = slots[i]; const s = new Date(monday); s.setDate(s.getDate() + d); s.setHours(h, m, 0, 0);
        await LossiData.scheduleLesson({ planId: '${planId}', lessonId: groups[i].dataset.lessonId, start: s, durationMin: dur });
      }
      return 'plan ${planId} ok';
    `));
  }

  for (const theme of ['light', 'dark']) {
    await evaluate(`localStorage.setItem('lossi-theme', '${theme}'); return 1;`);

    // Hero: uppläggssidan
    await go('/_mobile-upplag.html?id=1', 1440, 920);
    await shot(`hero-${theme}`);

    // Struktur och tidslinje
    const s = await rect('#sec-structure');
    await shot(`structure-${theme}`, { x: s.x - 24, y: s.y - 16, width: s.width + 48, height: Math.min(s.height + 32, 760) });

    // Export-menyn
    await evaluate(`window.scrollTo(0, 0); return 1;`);
    await sleep(300);
    await evaluate(`toggleAppPopover(document.querySelector('#exportMenu').previousElementSibling); return 1;`);
    await sleep(400);
    const act = await rect('.plan-actions');
    const m = await rect('#exportMenu');
    await shot(`export-${theme}`, { x: act.x - 28, y: act.y - 28, width: act.width + 56, height: m.y + m.height - act.y + 56 });
    await evaluate(`closeAllMenuPopovers(); return 1;`);

    // Föreslå lektion
    await evaluate(`suggestLesson(); return 1;`);
    await sleep(500);
    const mo = await rect('#suggestLessonModal .modal');
    await shot(`suggest-${theme}`, { x: mo.x, y: mo.y, width: mo.width, height: mo.height });

    // Kalendern
    await go('/_mobile-calendar.html', 1440, 920);
    await evaluate(`const st = document.createElement('style'); st.textContent = '.cal-now { display: none !important; }'; document.head.appendChild(st); return 1;`);
    const g = await rect('.cal-main');
    const grid = await rect('.cal-grid');
    await shot(`calendar-${theme}`, { x: g.x, y: g.y, width: g.width, height: grid.y + grid.height - g.y + 24 });
  }
} catch (e) {
  console.error(e);
} finally {
  ws?.close();
  chrome.kill();
  for (const f of TEMP) rmSync(join(ROOT, f), { force: true });
}
