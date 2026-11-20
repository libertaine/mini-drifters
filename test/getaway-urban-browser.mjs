// Getaway Drift in town (EXPERIMENTAL, v0.7.0 R4B) on the real page, in Chromium and Firefox:
// The Getaway category opens the mission and its two environments.
// escape (a saved medal), a retry that resets everything (police car, smashed scenery, meter),
// pause and resume, a bust, a smash, the BUST RISK meter's states and its place at 1024x600,
// 1366x768 and 1920x1080, storage isolation, no page errors, and the
// frame cost against Linked Drift. Only the Gamepad API and the frame clock are mocked.
//   node test/getaway-urban-browser.mjs /path/to/playwright/index.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
await mkdir(new URL('artifacts/screens-r4b/', root), { recursive: true });
await mkdir(new URL('artifacts/results/', root), { recursive: true });
const shot = (name) => fileURLToPath(new URL(`artifacts/screens-r4b/browser-${name}.png`, root));
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
  window.__pads = [];
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__pads });
  window.__newPad = () => ({ index: 0, id: 'Mock pad', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })) });
  window.requestAnimationFrame = (callback) => { window.__nextFrame = callback; return 1; };
  let now;
  window.__frames = (count = 2, dt = 1000 / 60) => {
    now ??= performance.now();
    for (let i = 0; i < count; i++) { now += dt; window.__nextFrame(now); }
  };
  // Drives the live challenge with a city driver until it ends, `maxSeconds` pass, or the run
  // reaches `snapAt` seconds (then returns, to take a picture, and can be called again).
  window.__driver = null;
  window.__drive = async (make, maxSeconds, snapAt = Infinity) => {
    const D = await import('/test/support/urban-drivers.mjs');
    const m = window.__miniDrifters;
    if (make) window.__driver = make === 'stall' ? D.urbanStall(D.urbanGrip({ lateral: 9 }), { after: 120, seconds: 9 })
      : make === 'drift' ? D.urbanBank(D.urbanDrift({}), D.urbanGrip({ lateral: 10, cap: 30 }), { bankAt: 250 })
        : make === 'idle' ? () => ({ up: false, down: false, left: false, right: false, handbrake: false })
          : D.urbanGrip({ lateral: 9 });
    const frameMs = [];
    for (let i = 0; i < maxSeconds * 60 && m.game.state !== 'finished'; i++) {
      Object.assign(m.input, window.__driver(m.game));
      const t0 = performance.now();
      window.__frames(1);
      frameMs.push(performance.now() - t0);
      if (m.game.challenge && m.game.challenge.time >= snapAt) break;
    }
    if (m.game.state === 'finished') { for (const k of Object.keys(m.input)) m.input[k] = false; window.__frames(2); }
    frameMs.sort((a, b) => a - b);
    return { phase: m.game.challenge?.phase, time: m.game.challenge?.time ?? 0, frames: frameMs.length,
      medianMs: frameMs[Math.floor(frameMs.length / 2)] ?? 0, p95Ms: frameMs[Math.floor(frameMs.length * 0.95)] ?? 0 };
  };
}

const perf = {};
const SIZES = [[1024, 600], [1366, 768], [1920, 1080]];
async function check(name, engine) {
  const browser = await engine.launch({ headless: true });
  const ok = (message) => console.log(`${name}: ${message}`);
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addInitScript(harness);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const value = (fn, arg) => page.evaluate(fn, arg);
    const frames = (n = 2) => value((k) => window.__frames(k), n);
    const key = async (code) => { await page.keyboard.press(code); await frames(2); };
    const text = (sel) => page.locator(sel).textContent();
    const shown = (sel) => page.locator(sel).isVisible();
    const load = async (query = '') => { await page.goto(`${base}${query}`); await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 }); await frames(2); };
    const names = () => page.locator('#challenges .station > span').evaluateAll((spans) => spans.map((s) => s.childNodes[0].textContent));
    const checked = () => page.locator('#challenges input:checked').getAttribute('value');
    const saves = () => value(() => window.__writes).then((w) => w.filter((k) => /^mini-drifters-(gymkhana|records|ghosts)/.test(k)));
    const openSheet = async (getaway = true) => {
      await page.click(getaway ? '#getaway' : '#gymkhana');
      if (getaway) await page.click('#get-the-footage');
      await frames(2);
    };
    const run = () => value(() => { const c = window.__miniDrifters.game.challenge; return c && { phase: c.phase, time: c.time, meter: c.meter, level: c.level, broken: c.broken, smashes: c.smashes, police: [c.pursuer.x, c.pursuer.y], start: [c.pursuer.prevX, c.pursuer.prevY], next: c.nextCamera, gap: c.gap }; });
    const box = (sel) => page.locator(sel).boundingBox();

    // The old URL flags cannot add challenges or change the production mission.
    await load('?getaway&pursuit=trail&tier=r4&miss=strict&time=90');
    await openSheet(false);
    assert.deepEqual(await names(), ['Precision 180', 'Linked Drift', 'One Drift', 'Slalom Sprint']);
    await key('Escape');
    await openSheet();
    assert.deepEqual(await names(), ['Downtown', 'Industrial']);
    await key('ArrowRight');
    assert.equal(await checked(), 'getaway-urban-industrial');
    await key('ArrowLeft');
    assert.equal(await checked(), 'getaway-urban-downtown');
    assert.match(await text('#challenge-brief'), /Tight downtown blocks/);
    assert.deepEqual(await page.locator('#challenge-targets li b').allTextContents(), ['1,600 pts', '600 pts', 'Escape']);
    assert.equal(await text('#challenge-best-label'), 'Personal best · Showmanship');
    assert.equal(await text('#challenge-best'), '--', 'a fresh profile has no record, not a zero');
    assert.equal(await text('#gymkhana-records-note'), '', 'records are saved: nothing to warn about');
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await frames(2);
      const fits = await page.locator('#challenges .station').evaluateAll((labels) => {
        const sheet = document.querySelector('#gymkhana-menu .sheet').getBoundingClientRect();
        return labels.every((l) => { const r = l.getBoundingClientRect(); return r.left >= sheet.left - 1 && r.right <= sheet.right + 1 && r.bottom <= window.innerHeight; });
      });
      assert.equal(fits, true, `both environments fit at ${w}x${h}`);
      await page.screenshot({ path: shot(`${name}-sheet-${w}x${h}`) });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await frames(2);
    ok('the production mission opens Downtown and Industrial; keyboard selection and three viewport sizes pass');

    // --- 3. Enter starts; BUST RISK shows; a grip escape is a provisional Bronze -----------------
    await key('Enter');
    assert.equal(await value(() => window.__miniDrifters.game.challengeDef.id), 'getaway-urban-downtown');
    assert.deepEqual(await value(() => { const d = window.__miniDrifters.game.challengeDef; return [d.pursuit, d.tier, d.missPolicy, d.timeLimit]; }),
      ['network', 'standard', 'recover', 120]);
    assert.equal(await shown('#bust'), true, 'BUST RISK shows');
    assert.equal(await text('#bust-state'), 'Clear');
    assert.equal(await text('#bust-detail'), 'Police car waiting at the start');
    assert.match(await text('#gym-gates'), /^Footage ○○○○ 0\/4 · escape gate locked$/);
    assert.match(await text('#gym-best'), /^Drift 0 · Smash \+0 · Silver at 600$/);
    await page.screenshot({ path: shot(`${name}-ready`) });
    const escape = await value(() => window.__drive('grip', 130));
    assert.equal(escape.phase, 'complete', `escaped (${JSON.stringify(escape)})`);
    assert.equal(await text('#gr-title'), 'Getaway complete');
    assert.match(await text('#gr-medal'), /^[BSG](Bronze|Silver|Gold) medal · NEW MEDAL$/, 'the first escape saves its medal');
    assert.equal(await shown('#gr-new'), true);
    const rows = await page.locator('#gr-stats dt').allTextContents();
    assert.deepEqual(rows.slice(-7), ['Footage', 'Best combo', 'Closest call', 'Bust risk peak', 'Smashed', 'Spinouts', 'Time']);
    assert.match(await text('#gr-stats'), /4 of 4 cameras/);
    await page.screenshot({ path: shot(`${name}-escaped`) });
    ok(`Enter starts Downtown; BUST RISK shows Clear at the start; a grip escape in ${escape.time.toFixed(1)} s earns and saves a medal`);

    // --- 4. Retry: a fresh run, police car on its mark, scenery whole --------------------------------
    await key('KeyR');
    const fresh = await run();
    assert.equal(fresh.phase, 'running');
    assert.equal(fresh.time, 0);
    assert.equal(fresh.meter, 0);
    assert.equal(fresh.smashes, 0);
    assert.ok(fresh.broken.every((b) => b === null), 'every breakable whole again');
    const start = await value(() => window.__miniDrifters.game.challengeDef.geometry.start);
    assert.ok(Math.abs(fresh.police[0] - (start.x - 25)) < 1e-6 && Math.abs(fresh.police[1] - start.y) < 1e-6, 'the police car is back on its mark');
    ok('R retries: a fresh run, the police car back on its mark, the meter empty, every breakable whole');

    // --- 5. A smash: the fruit stand at B2 ------------------------------------------------------------
    const smash = await value(() => {
      const m = window.__miniDrifters;
      const g = m.game;
      const stand = g.challengeDef.geometry.city.breakables.find((b) => b.kind === 'fruit' && b.cy < 120);
      Object.assign(m.input, { up: true });
      window.__frames(2);
      Object.assign(g.car, { x: stand.minX - 1, y: stand.cy - 14, heading: Math.PI / 2, vx: 0, vy: 18 });
      g.prev.x = g.car.x; g.prev.y = g.car.y; g.prev.heading = g.car.heading;
      g.challenge.edge = -1;
      let banner = '';
      for (let i = 0; i < 90 && !g.challenge.broken[stand.index]; i++) { window.__frames(1); banner = document.getElementById('banner').textContent; }
      for (let i = 0; i < 20; i++) { window.__frames(1); if (!banner.includes('FRUIT')) banner = document.getElementById('banner').textContent; }
      m.input.up = false;
      return { broken: g.challenge.broken[stand.index], banner, smashes: g.challenge.smashes };
    });
    assert.equal(smash.broken?.by, 'car');
    assert.equal(smash.smashes, 1);
    assert.match(smash.banner, /SMASH \+150 · FRUIT STAND/);
    await page.screenshot({ path: shot(`${name}-smash`) });
    ok('driving into a fruit stand smashes it once, with its banner');

    // --- 6. Pause and resume; then a mid-chase look at three sizes --------------------------------------
    await key('KeyR');
    await value(() => window.__drive('drift', 6));
    await key('KeyP');
    assert.equal(await value(() => window.__miniDrifters.game.paused), true);
    const pausedAt = (await run()).time;
    await frames(30);
    assert.equal((await run()).time, pausedAt, 'nothing moves while paused');
    await key('KeyP');
    assert.equal(await value(() => window.__miniDrifters.game.paused), false);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      // The canvas is resized (and cleared) by the page's own resize handler: let it run first.
      await page.waitForFunction(([ww, hh]) => window.innerWidth === ww && window.innerHeight === hh, [w, h]);
      await page.waitForTimeout(60);
      await frames(3);
      const bust = await box('#bust');
      const gauges = await box('.gauges');
      assert.ok(bust && gauges, 'both shown');
      assert.ok(bust.x >= gauges.x + gauges.width - 1, `${w}x${h}: BUST RISK clears the gauges (${bust.x.toFixed(0)} vs ${(gauges.x + gauges.width).toFixed(0)})`);
      // The minimap is drawn on the canvas, at most 182 px wide plus 16 px of margin, bottom right.
      assert.ok(bust.x + bust.width <= w - 16 - 182, `${w}x${h}: BUST RISK clears the minimap`);
      assert.ok(bust.y + bust.height <= h, `${w}x${h}: on screen`);
      await page.screenshot({ path: shot(`${name}-chase-${w}x${h}`) });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await frames(2);
    ok('P pauses and resumes; BUST RISK sits between the gauges and the minimap at 1024x600, 1366x768, 1920x1080');

    // --- 7. A bust: stopping dead lets the police car fill BUST RISK ---------------------------------
    await key('KeyR');
    let seenClose = false;
    let seenCritical = false;
    await value(() => window.__drive('stall', 3));
    for (let k = 0; k < 40; k++) {
      const r = await value(() => window.__drive(null, 0.5));
      const state = await text('#bust-state');
      if (state === 'Police close') seenClose = true;
      if (state === 'Critical') { seenCritical = true; assert.equal(await value(() => document.body.dataset.bust), 'critical'); }
      if (r.phase !== 'running') break;
    }
    assert.equal((await run()).phase, 'failed');
    assert.ok(seenClose && seenCritical, `the meter went through POLICE CLOSE (${seenClose}) and CRITICAL (${seenCritical})`);
    assert.equal(await text('#gr-title'), 'Busted');
    assert.equal(await shown('#gr-medal'), false, 'no medal for a bust');
    assert.match(await text('#gr-reason'), /in sight of you/);
    await page.screenshot({ path: shot(`${name}-busted`) });
    ok('a car that stops is busted: BUST RISK goes Police close -> Critical -> Busted, and the result explains it');

    // Return from an active run to its environment picker, then use the controller.
    await key('KeyR');
    await key('Escape');
    assert.ok(await shown('#gymkhana-menu'));
    await value(() => { window.__pads = [window.__newPad()]; window.__frames(4); });
    const press = async (i) => {
      await value((b) => { window.__pads[0].buttons[b] = { value: 1, pressed: true }; window.__frames(2); }, i);
      await value((b) => { window.__pads[0].buttons[b] = { value: 0, pressed: false }; window.__frames(2); }, i);
    };
    await press(12);                            // up: to the chosen challenge
    for (let i = 0; i < 6 && await checked() !== 'getaway-urban-industrial'; i++) await press(15);
    assert.equal(await checked(), 'getaway-urban-industrial', 'the D-pad reaches Industrial');
    await press(13);                            // down: to Start
    await press(0);                             // A
    await frames(4);
    assert.equal(await value(() => window.__miniDrifters.game.challengeDef?.id), 'getaway-urban-industrial');
    await value(() => { window.__pads = []; window.__frames(2); });
    const ind = await value(() => window.__drive('grip', 130));
    assert.equal(ind.phase, 'complete', `Industrial escaped (${JSON.stringify(ind)})`);
    await page.screenshot({ path: shot(`${name}-industrial-escaped`) });
    ok(`the controller chooses and starts Industrial; a grip escape there in ${ind.time.toFixed(1)} s`);

    // --- 10. Frame cost against Linked Drift -----------------------------------------------------------
    perf[name] = {};
    for (const id of ['linked-drift', 'getaway-urban-downtown', 'getaway-urban-industrial']) {
      await load();
      await openSheet(id !== 'linked-drift');
      await page.locator(`#challenges input[value="${id}"]`).evaluate((el) => el.click());
      await frames(2);
      await page.click('#gymkhana-start');
      await frames(2);
      const measure = await value((idle) => window.__drive(idle ? 'idle' : 'grip', 8), id === 'linked-drift');
      perf[name][id] = { medianMs: +measure.medianMs.toFixed(3), p95Ms: +measure.p95Ms.toFixed(3), frames: measure.frames };
    }
    ok(`frame cost (simulation + render, median/p95 ms): ${Object.entries(perf[name]).map(([k, v]) => `${k} ${v.medianMs}/${v.p95Ms}`).join(', ')}`);

    // --- 11. Nothing saved, nothing thrown -------------------------------------------------------------
    assert.deepEqual(await saves(), [], 'no record, ghost or gymkhana key written');
    assert.deepEqual(errors, []);
    ok('nothing written to record, ghost or gymkhana storage; no page errors');
  } finally {
    await browser.close();
  }
}

try {
  await check('chromium', chromium);
  await check('firefox', firefox);
  await writeFile(new URL('artifacts/results/r4b-browser-perf.json', root), JSON.stringify(perf, null, 1));
  console.log('getaway-urban-browser: all checks passed');
} finally {
  server.close();
}
