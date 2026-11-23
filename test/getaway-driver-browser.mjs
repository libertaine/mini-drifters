// Browser check for Getaway Driver (EXPERIMENTAL, v0.8.0 R0 research). Run:
//   node test/getaway-driver-browser.mjs /path/to/playwright/index.mjs
// - without ?driver the Getaway sheet offers exactly the shipped mission;
// - with ?driver it offers Getaway Driver too, which plays: a calm run reaches the safehouse
//   unnoticed, a reckless one is spotted, chased with BUST RISK, and ends on the results sheet;
// - nothing is written to storage, and the page raises no errors, in Chromium and Firefox.
// Screenshots go to artifacts/screens-r0/.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
await mkdir(new URL('artifacts/screens-r0/', root), { recursive: true });
const shot = (name) => fileURLToPath(new URL(`artifacts/screens-r0/${name}.png`, root));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!/^(index\.html|style\.css|src\/[\w-]+\.js|test\/support\/urban-drivers\.mjs|(?:audio-lab\/assets|radio)\/[\w/.-]+)$/.test(file) || file.includes('..')) {
    res.writeHead(404); res.end(); return;
  }
  try { const data = await readFile(new URL(file, root)); res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/plain' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

function harness() {
  localStorage.setItem('mini-drifters-sound', 'off');
  window.__writes = [];
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { window.__writes.push(k); return set.call(this, k, v); };
  window.requestAnimationFrame = (callback) => { window.__nextFrame = callback; return 1; };
  let now;
  window.__frames = (count = 2, dt = 1000 / 60) => {
    now ??= performance.now();
    for (let i = 0; i < count; i++) { now += dt; window.__nextFrame(now); }
  };
  window.__driver = null;
  // Drives the live run until it ends, `maxSeconds` pass, or `until(run)` holds.
  window.__drive = async (make, maxSeconds, until = null) => {
    const D = await import('/test/support/urban-drivers.mjs');
    const m = window.__miniDrifters;
    if (make) window.__driver = make === 'calm' ? D.urbanGrip({ lateral: 8, cap: 17 }) : D.urbanGrip({ lateral: 10 });
    const stop = until ? new Function('run', `return (${until})(run);`) : null;
    for (let i = 0; i < maxSeconds * 60 && m.game.state !== 'finished'; i++) {
      Object.assign(m.input, window.__driver(m.game));
      window.__frames(1);
      if (stop && m.game.challenge && stop(m.game.challenge)) break;
    }
    if (m.game.state === 'finished') { for (const k of Object.keys(m.input)) m.input[k] = false; window.__frames(2); }
    const c = m.game.challenge;
    return { phase: c?.phase, reason: c?.reason, time: c?.time ?? 0, pursuing: c?.pursuing, detections: c?.detections, attention: c?.attention };
  };
}

async function check(name, engine) {
  const browser = await engine.launch({ headless: true });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addInitScript(harness);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const value = (fn, arg) => page.evaluate(fn, arg);
    const frames = (n = 2) => value((k) => window.__frames(k), n);
    const text = (sel) => page.locator(sel).textContent();
    const load = async (query = '') => { await page.goto(`${base}${query}`); await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 }); await frames(2); };
    const missions = () => page.locator('#getaway-missions button').evaluateAll((b) => b.map((x) => x.textContent));

    // Without the switch: exactly the shipped mission.
    await load();
    await page.click('#getaway');
    await frames(2);
    assert.deepEqual(await missions(), ['Get the Footage']);

    // With it: Getaway Driver as well, on one Downtown environment.
    await load('?driver');
    await page.click('#getaway');
    await frames(2);
    assert.deepEqual(await missions(), ['Get the Footage', 'Getaway Driver']);
    await page.click('#getaway-driver');
    await frames(2);
    assert.equal(await text('#gymkhana-title'), 'Getaway Driver');
    assert.match(await text('#challenge-brief'), /safehouse/);
    assert.equal(await text('#challenge-best'), 'No records');
    if (name === 'chromium') await page.screenshot({ path: shot('menu') });
    await page.click('#gymkhana-start');
    await frames(4);
    assert.equal(await value(() => window.__miniDrifters.game.challengeDef.id), 'getaway-driver-downtown');
    assert.equal(await page.locator('#bust').isVisible(), true);
    assert.equal(await text('.bust-head .bust-label'), 'Attention');

    // A calm run: unnoticed, to the safehouse.
    let r = await value(() => window.__drive('calm', 4));
    if (name === 'chromium') await page.screenshot({ path: shot('calm-start') });
    r = await value(() => window.__drive(null, 120));
    assert.equal(r.phase, 'complete', JSON.stringify(r));
    assert.equal(r.detections, 0);
    assert.equal(await page.locator('#gymkhana-results').isVisible(), true);
    assert.equal(await text('#gr-title'), 'Ghost run');
    if (name === 'chromium') await page.screenshot({ path: shot('result-ghost') });

    // A reckless run: spotted, chased, and the meter becomes BUST RISK.
    await page.keyboard.press('KeyR');
    await frames(3);
    r = await value(() => window.__drive('fast', 60, '(run) => run.pursuing && run.time - run.pursuitStart > 1.2'));
    assert.equal(r.pursuing, true, JSON.stringify(r));
    await frames(2);
    assert.equal(await text('.bust-head .bust-label'), 'Bust risk');
    assert.equal(await page.locator('#bust-lose').isVisible(), true);
    if (name === 'chromium') await page.screenshot({ path: shot('pursuit') });
    r = await value(() => window.__drive(null, 150));
    assert.equal(await value(() => window.__miniDrifters.game.state), 'finished');
    if (name === 'chromium') await page.screenshot({ path: shot(`result-${r.phase === 'complete' ? 'escaped' : r.reason.replace(/\s/g, '-')}`) });

    // Back on Get the Footage the meter is BUST RISK again.
    await load('?driver');
    await page.click('#getaway');
    await page.click('#get-the-footage');
    await frames(2);
    await page.click('#gymkhana-start');
    await frames(4);
    assert.equal(await text('.bust-head .bust-label'), 'Bust risk');
    assert.equal(await page.locator('#bust-lose').isVisible(), false);

    const writes = await value(() => window.__writes);
    assert.deepEqual(writes.filter((k) => /^mini-drifters-(gymkhana|getaway|records|ghosts)/.test(k)), []);
    assert.deepEqual(errors, []);
    console.log(`${name}: ok (${r.phase}${r.reason ? `, ${r.reason}` : ''})`);
  } finally {
    await browser.close();
  }
}

try {
  await check('chromium', chromium);
  await check('firefox', firefox);
} finally {
  server.close();
}
