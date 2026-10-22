// Headless Chrome + CDP: riktiga musdrag av aktiviteter på uppläggssidan, före och efter spara + omladdning
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = 'http://localhost:8765/_mobile-upplag.html?id=1';
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=9333', '--window-size=1280,900',
  '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'cdp-')), 'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  await sleep(200);
  try {
    const list = await (await fetch('http://localhost:9333/json')).json();
    const page = list.find(t => t.type === 'page');
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {}
}
await new Promise(r => ws.addEventListener('open', r));
let n = 0; const waiting = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const id = ++n; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evalJS = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

async function load(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 50; i++) { await sleep(200); if (await evalJS(`typeof planLoaded !== 'undefined' && planLoaded`)) break; }
  await sleep(500);
}
const order = () => evalJS(`[...document.querySelectorAll('.lesson-group')].map(g => [...g.querySelectorAll('.activity-wrapper')].map(a => a.querySelector('.activity-name, .activity-title, h4, .activity-header')?.textContent.trim().slice(0, 25) || a.dataset.activityId))`);

async function drag(from, to) {
  const pts = await evalJS(`(() => {
    const acts = [...document.querySelectorAll('.activity-wrapper')];
    const a = acts[${from}], b = acts[${to}];
    a.closest('.lesson-group').scrollIntoView({ block: 'start' });
    const h = a.querySelector('.activity-row');
    const r1 = h.getBoundingClientRect(), r2 = b.getBoundingClientRect();
    return [r1.left + 40, r1.top + r1.height / 2, r2.left + r2.width / 2, r2.top + r2.height * 0.8];
  })()`);
  const [x1, y1, x2, y2] = pts;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 25; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * i / 25, y: y1 + (y2 - y1) * i / 25, button: 'left', buttons: 1 });
    await sleep(25);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 });
  await sleep(400);
}

await send('Page.enable'); await send('Runtime.enable');
await load(URL);
console.log('före   ', JSON.stringify(await order()));
await drag(0, 2);
console.log('drag 1 ', JSON.stringify(await order()));
console.log("sparat", await evalJS(`new Promise(r => setTimeout(r, 2000)).then(() => JSON.stringify(__mockDb.plans[0].state).length)`));
await load(URL);
console.log('omladd ', JSON.stringify(await order()));
await drag(0, 2);
console.log('drag 2 ', JSON.stringify(await order()));
console.log("sparat", await evalJS(`new Promise(r => setTimeout(r, 2000)).then(() => JSON.stringify(__mockDb.plans[0].state).length)`));
await load(URL);
console.log('omladd2', JSON.stringify(await order()));
console.log('fel    ', await evalJS(`document.body.classList.contains('plan-loading')`));
ws.close(); chrome.kill();
