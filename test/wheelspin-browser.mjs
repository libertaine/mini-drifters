// v0.5.0 R2 wheelspin feedback in Chromium and Firefox, on the real page with real key presses and
// real Web Audio: Power's wheelspin raises smoke, rubber and an engine flare; Classic's picture has
// none of it; the effects stay inside their caps however long the car is driven; pause, focus loss,
// restart, the title and Sound Off all leave the effects and the sound where they should be; and
// nothing new is written to storage. Only the frame clock is mocked, so every frame is the
// renderer's own. Screenshots go to artifacts/ for a person to look at: no check here can say
// whether the smoke looks right.
//   node test/wheelspin-browser.mjs /path/to/playwright/index.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
await mkdir(new URL('artifacts/', root), { recursive: true });
const shot = (name) => fileURLToPath(new URL(`artifacts/wheelspin-${name}.png`, root));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!/^(index\.html|style\.css|src\/[\w-]+\.js|test\/support\/drivers\.mjs|(?:audio-lab\/assets|radio)\/[\w/.-]+)$/.test(file) || file.includes('..')) {
    res.writeHead(404); res.end(); return;
  }
  try { const data = await readFile(new URL(file, root)); res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/plain' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
// What the game already saved before R2. R2 must add no key of its own.
const KNOWN_KEYS = new Set(['mini-drifters-sound', 'mini-drifters-handling', 'mini-drifters-audio', 'mini-drifters-records-v3', 'mini-drifters-gymkhana-v1']);

async function check(name, engine) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const ok = (message) => console.log(`${name}: ${message}`);
  await page.addInitScript(() => {
    window.__writes = [];
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { window.__writes.push(k); return set.call(this, k, v); };
    window.requestAnimationFrame = (callback) => { window.__nextFrame = callback; return 1; };
    let now;
    window.__frames = (count = 2, dt = 1000 / 60) => {
      now ??= performance.now();
      for (let i = 0; i < count; i++) { now += dt; window.__nextFrame(now); }
    };
    // Frames in which something is sampled: peak wheelspin, peak heard spin, wheelspin puffs, caps.
    window.__sample = (count) => {
      const m = window.__miniDrifters;
      const s = { peakWheelspin: 0, peakHeard: 0, spinPuffFrames: 0, maxSkids: 0, maxSmoke: 0, finite: true, maxRpm: 0 };
      for (let i = 0; i < count; i++) {
        window.__frames(1);
        const e = m.effects();
        const a = m.audio();
        s.peakWheelspin = Math.max(s.peakWheelspin, m.game.car.wheelspin ?? 0);
        s.peakHeard = Math.max(s.peakHeard, a.wheelspin);
        if (e.spinPuffs > 0) s.spinPuffFrames += 1;
        s.maxSkids = Math.max(s.maxSkids, e.skids);
        s.maxSmoke = Math.max(s.maxSmoke, e.smoke);
        s.maxRpm = Math.max(s.maxRpm, a.rpm);
        if (![a.rpm, a.load, a.wheelspin, a.tireIntensity].every(Number.isFinite)) s.finite = false;
      }
      return s;
    };
  });
  const value = (fn, arg) => page.evaluate(fn, arg);
  const frames = (n = 2) => value((k) => window.__frames(k), n);
  const sample = (n) => value((k) => window.__sample(k), n);
  const effects = () => value(() => window.__miniDrifters.effects());
  const sound = () => value(() => window.__miniDrifters.audio());
  const game = () => value(() => { const g = window.__miniDrifters.game; return { state: g.state, paused: g.paused, mode: g.mode, handling: g.handling.id, speed: g.car.speed, wheelspin: g.car.wheelspin ?? null }; });
  const hold = async (...keys) => { for (const k of keys) await page.keyboard.down(k); };
  const release = async (...keys) => { for (const k of keys) await page.keyboard.up(k); };
  const open = async () => {
    await page.goto(base);
    await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
    await frames(2);
  };
  const toPad = async (handling) => {
    while ((await value(() => window.__miniDrifters.selectedHandling())) !== handling) await page.keyboard.press('KeyH');
    await page.locator('#practice').click();
    await frames(4);
    const g = await game();
    assert.deepEqual([g.mode, g.handling, g.state], ['practice', handling, 'ready']);
  };

  try {
    await open();

    // --- 1. Power on the practice pad: a throttle circle spins the rear wheels ----------------
    await toPad('revised');
    let e = await effects();
    assert.deepEqual([e.skids, e.smoke, e.spinMarking], [0, 0, false], 'a fresh pad has nothing on it');
    await hold('ArrowUp', 'ArrowLeft');
    let s = await sample(60 * 8);
    assert.ok(s.peakWheelspin > 0.5, `Power spins its rear wheels on a throttle circle (${s.peakWheelspin.toFixed(2)})`);
    assert.ok(s.spinPuffFrames > 60, `wheelspin smoke appears (${s.spinPuffFrames} frames)`);
    assert.ok(s.maxSkids > 0, 'rubber is laid');
    assert.ok(s.peakHeard > 0.5, `the engine hears the wheelspin (${s.peakHeard.toFixed(2)})`);
    assert.ok(s.finite, 'every sound value is finite');
    assert.ok(s.maxSmoke <= 110 && s.maxSkids <= 1800);
    await page.screenshot({ path: shot(`${name}-power-pad`) });
    ok(`Power throttle circle: wheelspin ${s.peakWheelspin.toFixed(2)}, heard ${s.peakHeard.toFixed(2)}, wheelspin smoke in ${s.spinPuffFrames}/480 frames, ${s.maxSkids} skid segments, RPM up to ${s.maxRpm.toFixed(0)}`);

    // --- 2. Pause freezes everything; focus loss pauses and silences ------------------------
    await page.keyboard.press('KeyP');
    await release('ArrowUp', 'ArrowLeft');
    const paused = await effects();
    await frames(120);
    assert.deepEqual(await effects(), paused, 'nothing ages, moves or is added while paused');
    assert.equal((await sound()).mode, 'silent', 'paused is silent');
    await page.keyboard.press('KeyP');
    await hold('ArrowUp', 'ArrowLeft');
    await frames(60);
    await value(() => window.dispatchEvent(new Event('blur')));
    const lost = await effects();
    assert.equal((await game()).paused, true, 'losing focus pauses');
    await frames(120);
    assert.deepEqual(await effects(), lost, 'and freezes the effects');
    assert.equal((await sound()).mode, 'silent', 'and silences the engine');
    await release('ArrowUp', 'ArrowLeft');
    await value(() => window.dispatchEvent(new Event('focus')));
    await frames(4);
    assert.equal((await game()).paused, true, 'focus returning does not resume by itself');
    ok('pause and focus loss freeze smoke and marks, and silence the engine');

    // --- 3. Restart clears it all; a parked car lays nothing --------------------------------
    await page.keyboard.press('KeyP');
    await page.keyboard.press('KeyR');
    await frames(2);
    e = await effects();
    assert.deepEqual([e.skids, e.smoke, e.spinMarking, e.anchored], [0, 0, false, false], 'R clears every mark, puff and mark memory');
    assert.equal((await sound()).wheelspin, 0, 'and the engine forgets the spin');
    await frames(120);
    e = await effects();
    assert.deepEqual([e.skids, e.smoke], [0, 0], 'a car standing still lays nothing');
    ok('restart clears effects and heard spin; a parked car lays nothing');

    // --- 4. A long session (100 s of donuts) stays inside the caps -----------------------
    await hold('ArrowUp', 'ArrowLeft');
    s = await sample(60 * 100);
    await release('ArrowUp', 'ArrowLeft');
    assert.ok(s.maxSkids <= 1800 && s.maxSmoke <= 110, `caps hold: ${s.maxSkids} segments, ${s.maxSmoke} puffs`);
    assert.equal(s.maxSkids, 1800, 'the skid buffer fills and then recycles');
    assert.ok(s.finite);
    ok(`100 s of throttle circles: at most ${s.maxSkids}/1800 skid segments and ${s.maxSmoke}/110 puffs`);

    // --- 5. Sound Off: the picture carries on, the engine is silent -------------------------
    // Device-less Linux Firefox never starts its output (docs/GAMEPLAY-AUDIO.md), and the button
    // then reads Sound Unavailable. The sound model still runs there, so only the toggle is skipped.
    const unavailable = (await page.locator('#sound').textContent()) === 'Sound Unavailable';
    if (!unavailable) {
      await page.locator('#sound').click();
      assert.equal(await page.locator('#sound').textContent(), 'Sound Off');
    }
    await hold('ArrowUp', 'ArrowLeft');
    s = await sample(60 * 3);
    await release('ArrowUp', 'ArrowLeft');
    assert.equal((await sound()).mode, 'silent');
    assert.ok(s.spinPuffFrames > 0, 'smoke does not depend on sound');
    assert.ok(s.finite);
    if (!unavailable) {
      await page.locator('#sound').click();
      assert.equal(await page.locator('#sound').textContent(), 'Sound On');
      ok('Sound Off silences the engine and leaves the smoke alone');
    } else {
      ok('audio output unavailable here: checked only that the smoke and the sound model carry on');
    }

    // --- 6. Back to the title clears the pad ------------------------------------------------
    await page.keyboard.press('Escape');
    await frames(4);
    assert.equal((await game()).state, 'menu');
    e = await effects();
    assert.deepEqual([e.skids, e.smoke, e.spinMarking], [0, 0, false], 'leaving the session clears the effects');

    // --- 7. Classic: the same circle, and no wheelspin effect at all ------------------------
    await toPad('classic');
    await hold('ArrowUp', 'ArrowLeft');
    s = await sample(60 * 8);
    await release('ArrowUp', 'ArrowLeft');
    assert.equal(s.peakWheelspin, 0, 'Classic has no wheelspin');
    assert.equal(s.spinPuffFrames, 0, 'so it never makes wheelspin smoke');
    assert.equal(s.peakHeard, 0, 'and the engine never hears any');
    await page.screenshot({ path: shot(`${name}-classic-pad`) });
    // A Classic handbrake slide still smokes and marks as it always has.
    await hold('ArrowUp');
    await frames(90);
    await hold('ArrowLeft', 'Space');
    s = await sample(60 * 2);
    await release('ArrowUp', 'ArrowLeft', 'Space');
    assert.ok(s.maxSkids > 0 && s.maxSmoke > 0, 'a Classic handbrake slide still marks and smokes');
    assert.equal(s.spinPuffFrames, 0);
    ok('Classic: no wheelspin smoke or flare; its handbrake slide marks and smokes as before');
    await page.keyboard.press('Escape');
    await frames(4);

    // --- 8. Power on Dockyard with the drift driver, then finish at the title ---------------
    while ((await value(() => window.__miniDrifters.selectedHandling())) !== 'revised') await page.keyboard.press('KeyH');
    while ((await value(() => window.__miniDrifters.selectedTrack())) !== 'dockyard') await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await frames(2);
    s = await value(async () => {
      const drivers = await import('/test/support/drivers.mjs');
      const m = window.__miniDrifters;
      const driver = drivers.driftDriver();
      const out = { spinPuffFrames: 0, maxSkids: 0, maxSmoke: 0, peakHeard: 0, finite: true };
      for (let i = 0; i < 60 * 40; i++) {
        Object.assign(m.input, driver(m.game));
        window.__frames(1);
        const e = m.effects(); const a = m.audio();
        if (e.spinPuffs > 0) out.spinPuffFrames += 1;
        out.maxSkids = Math.max(out.maxSkids, e.skids); out.maxSmoke = Math.max(out.maxSmoke, e.smoke);
        out.peakHeard = Math.max(out.peakHeard, a.wheelspin);
        if (![a.rpm, a.load, a.wheelspin].every(Number.isFinite)) out.finite = false;
      }
      for (const k of Object.keys(m.input)) m.input[k] = false;
      return out;
    });
    assert.ok(s.spinPuffFrames > 0 && s.peakHeard > 0.3 && s.finite, JSON.stringify(s));
    assert.ok(s.maxSkids <= 1800 && s.maxSmoke <= 110);
    await page.screenshot({ path: shot(`${name}-power-dockyard`) });
    ok(`Power drift on Dockyard: wheelspin smoke in ${s.spinPuffFrames}/2400 frames, heard spin up to ${s.peakHeard.toFixed(2)}`);

    // --- 9. Storage ---------------------------------------------------------------------------
    const written = await value(() => [...new Set(window.__writes)]);
    for (const k of written) assert.ok(KNOWN_KEYS.has(k), `unexpected storage key ${k}`);
    assert.ok(!written.some((k) => /wheelspin|smoke|effect|tyre/i.test(k)));
    ok(`storage: only existing keys written (${written.join(', ') || 'none'})`);

    assert.deepEqual(errors, [], 'no page errors');
    ok('PASS');
  } finally {
    await browser.close();
  }
}

let failed = false;
for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) {
  try { await check(name, engine); }
  catch (error) { failed = true; console.error(`${name}: FAIL ${error.stack}`); }
}
server.close();
process.exit(failed ? 1 : 0);
