import { chooseTracks } from './support/track-menu.mjs';
// Dockyard and Slalom Sprint on the real page, in Chromium and Firefox: Dockyard chosen and
// driven for three laps by keyboard-level input, in Classic and Power; restart, pause and return
// to title; Slalom Sprint chosen, completed, penalised, failed and retried; a mocked controller
// navigating and driving both; that the title's three circuits and the sheet's four challenges
// fit every supported window, with the game's fonts and with fallback fonts; and that the
// records and settings a v0.4.0 player already has, planted beforehand, are read, shown and
// kept intact while Dockyard and Slalom Sprint records are added beside them.
// Only the Gamepad API and the frame clock are mocked. The origin is a throwaway one on a
// random port.
//   npm install --no-save --no-package-lock playwright@1.64.1 && npm run test:dockyard-slalom:browser
//   node test/dockyard-slalom-browser.mjs /path/to/playwright/index.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
await mkdir(new URL('artifacts/', root), { recursive: true });
const shot = (name) => fileURLToPath(new URL(`artifacts/dockyard-slalom-${name}.png`, root));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!/^(index\.html|style\.css|src\/[\w-]+\.js|test\/support\/(gymkhana-)?drivers\.mjs|(?:audio-lab\/assets|radio)\/[\w/.-]+)$/.test(file) || file.includes('..')) {
    res.writeHead(404); res.end(); return;
  }
  try { const data = await readFile(new URL(file, root)); res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/plain' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

// What a v0.4.0 player already has saved in this origin. All of it must be read, and the records
// in it must survive every write untouched.
const V040_ORIGINAL = { classic: { fastestLap: 41.111, scoring: { 'scoring-2': { score: 99999, bestCombo: 8888 } } } };
const V040_PRECISION = { classic: { 'precision-180-1': { best: 6.543 } } };
// A write fills in empty entries for every circuit and mode it knows (as v0.4.0's does), so what
// must survive is the saved values themselves.
const originalKept = (tracks) => ({ fastestLap: tracks.original.classic.fastestLap, current: tracks.original.classic.scoring['scoring-2'] });
const V040_ORIGINAL_KEPT = { fastestLap: 41.111, current: { score: 99999, bestCombo: 8888 } };
const V040 = {
  'mini-drifters-records-v3': JSON.stringify({ version: 3, tracks: { original: V040_ORIGINAL } }),
  'mini-drifters-gymkhana-v1': JSON.stringify({ version: 1, challenges: { 'precision-180': V040_PRECISION } }),
  'mini-drifters-handling': 'revised',
  'mini-drifters-sound': 'off',
};
// Every key the page may write. Nothing new is introduced for Dockyard or Slalom Sprint. v0.7.0
// added one: a circuit run's flying laps save the reference ghost under its own key (GHOST.md).
const KEYS = ['mini-drifters-records-v3', 'mini-drifters-gymkhana-v1', 'mini-drifters-handling', 'mini-drifters-sound',
  'mini-drifters-ghosts-v1'];
const FALLBACKS = [null, 'Arial, sans-serif', 'Verdana, sans-serif'];
const SIZES = [[1920, 1080], [1366, 768], [1280, 720], [1024, 600]];
// A weave that stays clean in both modes when the driver is asked once a frame, as the page
// asks it, not once a tick: found by a sweep, with clean neighbours either side.
const SAFE_WEAVE = { speed: 15, amp: 3.6, lookV: 0.3 };

function harness(saved) {
  if (!localStorage.getItem('__seeded')) {
    for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
    localStorage.setItem('__seeded', '1');
  }
  window.__writes = [];
  window.__reads = [];
  const set = Storage.prototype.setItem;
  const get = Storage.prototype.getItem;
  Storage.prototype.setItem = function (k, v) { window.__writes.push(k); return set.call(this, k, v); };
  Storage.prototype.getItem = function (k) { window.__reads.push(k); return get.call(this, k); };
  window.__pads = [];
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__pads });
  window.requestAnimationFrame = (callback) => { window.__nextFrame = callback; return 1; };
  let now;
  window.__frames = (count = 2, dt = 1000 / 60) => {
    now ??= performance.now();
    for (let i = 0; i < count; i++) { now += dt; window.__nextFrame(now); }
  };
  window.__newPad = () => ({ index: 0, id: 'Mock', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })) });
  const button = (on) => ({ value: on ? 1 : 0, pressed: !!on });
  // Drives with a scripted driver until the session is over, `seconds` have passed or `stop`
  // says so. `via` is 'keys' (the page's own keyboard state) or 'pad' (the mocked controller's
  // stick, triggers and A button). `watch` collects every distinct text an element showed.
  window.__run = async ({ file, name, params, seconds = 60, via = 'keys', untilS = null, untilX = null, watch = null, fresh = true }) => {
    const drivers = await import(`/test/support/${file}.mjs`);
    const m = window.__miniDrifters;
    if (fresh || !window.__driver) window.__driver = drivers[name](params);
    const seen = new Set();
    for (let i = 0; i < seconds * 60 && m.game.state !== 'finished'; i++) {
      const keys = window.__driver(m.game);
      if (via === 'pad') {
        const pad = window.__pads[0];
        pad.axes[0] = keys.right ? 1 : keys.left ? -1 : 0;
        pad.buttons[7] = button(keys.up);
        pad.buttons[6] = button(keys.down);
        pad.buttons[0] = button(keys.handbrake);
      } else Object.assign(m.input, keys);
      window.__frames(1);
      if (watch) seen.add(document.querySelector(watch)?.hidden ? '' : document.querySelector(watch)?.textContent ?? '');
      if (untilS !== null && m.game.trackS >= untilS && m.game.trackS < untilS + 60) break;
      if (untilX !== null && m.game.car.x >= untilX) break;
    }
    // Stopping part-way leaves the controls held, so that carrying on is one unbroken drive.
    if (m.game.state === 'finished' || (untilS === null && untilX === null)) {
      for (const k of Object.keys(m.input)) m.input[k] = false;
      if (window.__pads[0]) { window.__pads[0].axes[0] = 0; for (const i of [0, 6, 7]) window.__pads[0].buttons[i] = button(false); }
      window.__frames(2);
    }
    return { state: m.game.state, seen: [...seen] };
  };
}

async function check(name, engine) {
  const browser = await engine.launch({ headless: true });
  const ok = (message) => console.log(`${name}: ${message}`);
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addInitScript(harness, V040);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const value = (fn, arg) => page.evaluate(fn, arg);
    const frames = (n = 2) => value((k) => window.__frames(k), n);
    const load = async () => {
      await page.goto(base);
      await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
      await frames(2);
    };
    const key = async (code) => { await page.keyboard.press(code); await frames(2); };
    const text = (sel) => value((s) => document.querySelector(s)?.textContent ?? null, sel);
    const shown = (sel) => value((s) => { const el = document.querySelector(s); return !!el && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0; }, sel);
    const status = () => value(() => {
      const m = window.__miniDrifters;
      const g = m.game;
      return { state: g.state, kind: m.sessionKind(), track: g.track.id, drawn: m.drawnTrack(), chosenTrack: m.selectedTrack(), handling: g.handling.id, selected: m.selectedHandling(), paused: g.paused,
        sheet: m.gymkhana().open, chosen: m.gymkhana().selected, challenge: g.challengeDef?.id ?? null, phase: g.challenge?.phase ?? null, reason: g.challenge?.reason ?? null,
        time: g.challenge?.time ?? null, result: g.challenge?.result ?? null, next: g.challenge?.next ?? null, hit: g.challenge?.cones.filter((c) => c.hit).length ?? null,
        laps: { ...g.laps }, results: g.results, runTime: g.runTime, s: g.trackS, speed: g.car.speed, surface: g.car.surface, wheelspin: g.car.wheelspin ?? null, ghost: !!g.ghost?.replay,
        x: g.car.x, y: g.car.y };
    });
    const run = (options) => value((o) => window.__run(o), options);
    const press = async (index) => {
      await value((i) => { window.__pads[0].buttons[i] = { value: 1, pressed: true }; window.__frames(); }, index);
      await value((i) => { window.__pads[0].buttons[i] = { value: 0, pressed: false }; window.__frames(); }, index);
    };
    const outside = (sels) => value((list) => list.filter((sel) => {
      const el = document.querySelector(sel);
      if (!el || !el.getClientRects().length) return true;
      const r = el.getBoundingClientRect();
      return r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5;
    }), sels);
    const sizes = async (label, sels, picture) => {
      for (const [w, h] of SIZES) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(120);
        await frames(2);
        assert.deepEqual(await outside(sels), [], `${label} fits at ${w}x${h}`);
        if (picture && (w === 1366 || w === 1024)) await page.screenshot({ path: shot(`${name}-${picture}-${w}x${h}`) });
      }
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.waitForTimeout(120);
      await frames(2);
    };
    const saved = (k) => value((keyName) => JSON.parse(localStorage.getItem(keyName)), k);
    // Each listed element is inside the window and does not overflow its own box, with the game's
    // fonts and with two fallbacks, at every supported size (as records-browser.mjs measures).
    // `within` is [row, items]: each item must also sit inside its row, give or take the 4 px the
    // buttons' skew leans past their box.
    const fitsWithFonts = async (label, sels, within = null) => {
      for (const fallback of FALLBACKS) {
        await value((f) => {
          for (const property of ['--poster', '--body']) {
            if (f) document.documentElement.style.setProperty(property, f);
            else document.documentElement.style.removeProperty(property);
          }
        }, fallback);
        for (const [w, h] of SIZES) {
          await page.setViewportSize({ width: w, height: h });
          await value(() => window.dispatchEvent(new Event('resize')));
          await frames(2);
          const issues = await value((list) => list.flatMap((sel) => [...document.querySelectorAll(sel)]).filter((el) => el.getClientRects().length).flatMap((el) => {
            const r = el.getBoundingClientRect();
            return r.top < -0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5 || el.scrollWidth > el.clientWidth + 1
              ? [{ el: el.id || el.className || el.tagName, text: el.textContent.trim().slice(0, 40), right: Math.round(r.right), bottom: Math.round(r.bottom), scroll: el.scrollWidth, client: el.clientWidth }] : [];
          }), sels);
          assert.deepEqual(issues, [], `${label} fits at ${w}x${h} (${fallback ?? 'game fonts'})`);
          if (within) {
            const spill = await value(([row, items]) => {
              const box = document.querySelector(row).getBoundingClientRect();
              return [...document.querySelectorAll(items)].map((el) => el.getBoundingClientRect()).filter((r) => r.left < box.left - 4 || r.right > box.right + 4).map((r) => [Math.round(r.left), Math.round(r.right), Math.round(box.right)]);
            }, within);
            assert.deepEqual(spill, [], `every choice stays inside its row at ${w}x${h} (${fallback ?? 'game fonts'})`);
          }
          if (w === 1024 && fallback) await page.screenshot({ path: shot(`${name}-${label.replace(/\W+/g, '-')}-${fallback.split(',')[0]}-${w}x${h}`) });
        }
      }
      await value(() => { document.documentElement.style.removeProperty('--poster'); document.documentElement.style.removeProperty('--body'); });
      await page.setViewportSize({ width: 1366, height: 768 });
      await value(() => window.dispatchEvent(new Event('resize')));
      await frames(2);
    };
    // Every circuit choice can be pressed where it is drawn.
    const pressable = (sel) => value((s) => [...document.querySelectorAll(s)].every((label) => {
      const r = label.getBoundingClientRect();
      return label.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    }), sel);
    const toTitle = async () => {
      await page.locator('.return-title:visible').first().click();
      await frames(3);
      assert.equal((await status()).state, 'menu');
    };

    // --- The title ---------------------------------------------------------------------------
    await load();
    assert.doesNotMatch(await text('.release-version'), /PROTOTYPE/i);
    assert.doesNotMatch(await page.title(), /PROTOTYPE/i);
    assert.deepEqual(await value(() => [...document.querySelectorAll('#tracks input')].map((i) => i.value)), ['original', 'switchback', 'dockyard']);
    assert.deepEqual(await page.locator('#tracks label').allInnerTexts().then((t) => t.map((x) => x.trim().toUpperCase())), ['ORIGINAL', 'SWITCHBACK', 'DOCKYARD']);
    let s = await status();
    assert.equal(s.selected, 'revised', 'the saved handling choice (Power) is read');
    await sizes('the category title', ['.title', '#handlings', '#tracks-open', '#gymkhana', '#getaway', '.release-version'], 'title');
    await chooseTracks(page);
    await key('KeyH');
    assert.equal((await status()).selected, 'classic');
    assert.ok(await value(() => document.querySelector('.personal-bests').textContent.includes('99,999')), 'the saved Original record is shown');
    await fitsWithFonts('the three circuits', ['#tracks-title', '.track-select', '#tracks label', '#tracks-menu .actions button'], ['.track-select', '#tracks label']);
    for (const [w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await value(() => window.dispatchEvent(new Event('resize')));
      await frames(2);
      assert.ok(await pressable('#tracks label'), `every circuit can be pressed at ${w}x${h}`);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await frames(2);
    ok('title: three circuits, fits every window with game and fallback fonts, saved records and handling read');

    // The title by mouse: each circuit is chosen by a click.
    for (const want of ['dockyard', 'switchback', 'original']) {
      await page.locator('#tracks label', { hasText: new RegExp(want, 'i') }).click();
      await frames(2);
      assert.equal((await status()).chosenTrack, want);
    }
    ok('title: a click chooses each of the three circuits');

    // --- Dockyard, Classic, three laps ---------------------------------------------------------
    await chooseTracks(page);
    await key('ArrowRight');
    await key('ArrowRight');
    assert.equal((await status()).chosenTrack, 'dockyard');
    await key('Enter');
    s = await status();
    assert.deepEqual([s.state, s.kind, s.track, s.drawn, s.handling], ['ready', 'normal', 'dockyard', 'dockyard', 'classic']);
    await page.screenshot({ path: shot(`${name}-dockyard-grid`) });
    await run({ file: 'drivers', name: 'gripDriver', untilS: 225, seconds: 30 });
    s = await status();
    assert.ok(s.state === 'racing' && s.s >= 225 && s.surface !== 'grass', `in the Hook at s=${s.s.toFixed(0)}`);
    await page.screenshot({ path: shot(`${name}-dockyard-hook`) });
    await run({ file: 'drivers', name: 'gripDriver', untilS: 440, seconds: 30, fresh: false });
    await page.screenshot({ path: shot(`${name}-dockyard-chicane`) });
    await run({ file: 'drivers', name: 'gripDriver', untilS: 660, seconds: 30, fresh: false });
    await page.screenshot({ path: shot(`${name}-dockyard-basin`) });
    await run({ file: 'drivers', name: 'gripDriver', seconds: 150, fresh: false });
    s = await status();
    assert.equal(s.state, 'finished');
    assert.deepEqual([s.laps.completed, s.laps.voided], [3, 0]);
    assert.ok(s.laps.bestLap > 28 && s.laps.bestLap < 33, `best lap ${s.laps.bestLap}`);
    assert.ok(s.results && s.results.voidedLaps === 0 && s.results.runTime > 85 && s.results.runTime < 100, 'results');
    assert.ok(s.ghost, 'a counted lap became the ghost');
    assert.ok(await shown('#results'));
    assert.ok((await text('#r-best')).length > 3 && (await text('#r-time')).length > 3);
    await page.screenshot({ path: shot(`${name}-dockyard-results`) });
    const circuit = await saved('mini-drifters-records-v3');
    assert.ok(Math.abs(circuit.tracks.dockyard.classic.fastestLap - s.laps.bestLap) < 1e-6, 'Dockyard\'s fastest lap is saved, in the existing key');
    assert.deepEqual(originalKept(circuit.tracks), V040_ORIGINAL_KEPT, 'and the saved Original record is untouched');
    ok(`Dockyard, Classic: three counted laps by key input, best ${s.laps.bestLap.toFixed(2)} s, results and record`);

    // Drive again, restart mid-run, pause, and back to the title.
    await key('KeyR');
    s = await status();
    assert.deepEqual([s.state, s.track, s.laps.completed, s.runTime], ['ready', 'dockyard', 0, 0]);
    await run({ file: 'drivers', name: 'gripDriver', seconds: 6, untilS: 9999 });
    assert.equal((await status()).state, 'racing');
    await value(() => { for (const k of Object.keys(window.__miniDrifters.input)) window.__miniDrifters.input[k] = false; });
    await key('KeyR');
    s = await status();
    assert.deepEqual([s.state, s.runTime, s.speed], ['ready', 0, 0]);
    await run({ file: 'drivers', name: 'gripDriver', seconds: 3, untilS: 9999 });
    await value(() => { for (const k of Object.keys(window.__miniDrifters.input)) window.__miniDrifters.input[k] = false; });
    await key('KeyP');
    assert.equal((await status()).paused, true);
    const pausedAt = (await status()).runTime;
    await frames(30);
    assert.equal((await status()).runTime, pausedAt, 'the clock stops while paused');
    await toTitle();
    assert.equal((await status()).chosenTrack, 'dockyard', 'the choice of circuit is kept for the visit');
    ok('Dockyard: drive again, restart mid-run, pause and return to title');

    // --- Dockyard, Power -----------------------------------------------------------------------
    await chooseTracks(page);
    await key('KeyH');
    assert.equal((await status()).selected, 'revised');
    await key('Enter');
    await run({ file: 'drivers', name: 'driftDriver', seconds: 150 });
    s = await status();
    assert.equal(s.state, 'finished');
    assert.deepEqual([s.handling, s.laps.completed, s.laps.voided], ['revised', 3, 0]);
    assert.equal(typeof s.wheelspin, 'number', 'Power\'s wheelspin state is live');
    assert.ok(s.results.score > 1000, `score ${s.results.score}`);
    const both = await saved('mini-drifters-records-v3');
    assert.ok(both.tracks.dockyard.revised.scoring['scoring-2'].score === s.results.score && both.tracks.dockyard.classic.fastestLap > 0, 'each handling mode keeps its own Dockyard record');
    await toTitle();
    assert.ok(await value((n) => document.querySelector('.personal-bests').textContent.includes(Math.round(n).toLocaleString('en-US')), s.results.score), 'the title shows the new Dockyard Power best');
    ok(`Dockyard, Power: three counted laps drifting, score ${s.results.score}, a record of its own`);

    // --- Dockyard by controller ----------------------------------------------------------------
    await value(() => { window.__pads = [window.__newPad()]; window.__frames(3); });
    await chooseTracks(page);
    await frames(2);
    // D-pad Left and Right walk the three circuits and wrap, as Left and Right do on the keyboard.
    const walked = [];
    for (const button of [15, 15, 15, 14, 14, 14]) { await press(button); walked.push((await status()).chosenTrack); }
    assert.deepEqual(walked, ['original', 'switchback', 'dockyard', 'switchback', 'original', 'dockyard']);
    assert.equal(await value(() => document.activeElement.id), 'start', 'and the focus stays on Start');
    await press(0); // A on Start driving
    s = await status();
    assert.deepEqual([s.state, s.track], ['ready', 'dockyard']);
    await run({ file: 'drivers', name: 'gripDriver', via: 'pad', untilS: 440, seconds: 40 });
    s = await status();
    assert.ok(s.state === 'racing' && s.s >= 440 && s.surface !== 'grass', `the stick and triggers drove it through the Hook to s=${s.s.toFixed(0)}`);
    await value(() => { const p = window.__pads[0]; p.axes[0] = 0; for (const i of [0, 6, 7]) p.buttons[i] = { value: 0, pressed: false }; window.__frames(2); });
    await press(9); // Menu: pause
    assert.equal((await status()).paused, true);
    await toTitle();
    ok('Dockyard by controller: D-pad walks the three circuits and wraps, A starts, stick and triggers drive, Menu pauses');

    // --- Slalom Sprint: the sheet ----------------------------------------------------------------
    await page.locator('#gymkhana').focus();
    await press(0); // A on Gymkhana
    assert.equal((await status()).sheet, true);
    // Up from Start reaches the chosen challenge (the first, on a new visit to the sheet); Left
    // then wraps the choice round to Slalom Sprint, the last, and the focus follows it.
    assert.equal((await status()).chosen, 'precision-180');
    await press(12);
    assert.equal(await value(() => document.activeElement.value), 'precision-180');
    await press(14);
    assert.equal((await status()).chosen, 'slalom-sprint');
    assert.equal(await value(() => document.activeElement.value), 'slalom-sprint');
    await press(13); await press(12);
    assert.equal(await value(() => document.activeElement.value), 'slalom-sprint', 'Up from Start comes back to it');
    await value(() => { window.__pads = []; window.__frames(3); });
    assert.deepEqual(await value(() => [...document.querySelectorAll('#challenges input')].map((i) => i.value)), ['precision-180', 'linked-drift', 'one-drift', 'slalom-sprint']);
    assert.match(await text('#challenge-brief'), /seven cones/);
    assert.match(await text('#challenge-points'), /adds 2 seconds/);
    assert.equal(await text('#challenge-best'), '--');
    await sizes('the challenge sheet with four challenges', ['#challenges', '#challenge-brief', '#challenge-points', '#gymkhana-start', '#gymkhana-back'], 'sheet');
    await fitsWithFonts('the challenge sheet with four challenges', ['#gymkhana-menu .sheet', '#challenges .station', '#challenge-brief', '#gymkhana-start', '#gymkhana-back'], ['#gymkhana-menu .sheet', '#challenges .station']);
    assert.ok(await pressable('#challenges .station'), 'every challenge can be pressed');
    ok('Slalom Sprint: chosen on the sheet by controller, explained, fits every window');

    // Back to Classic for the first runs: H on the sheet changes the handling as on the title.
    await key('KeyH');
    assert.equal((await status()).selected, 'classic');
    await key('Enter');
    s = await status();
    assert.deepEqual([s.state, s.kind, s.challenge, s.handling, s.time], ['ready', 'gymkhana', 'slalom-sprint', 'classic', 0]);
    assert.match(await text('#prompt'), /Weave through the seven cones/);
    for (const [w, h] of [[1024, 600], [1366, 768]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(120);
      await frames(90); // let the view settle between the car and the course
      await page.screenshot({ path: shot(`${name}-slalom-ready-${w}x${h}`) });
    }

    // --- A clean run ---------------------------------------------------------------------------
    await run({ file: 'gymkhana-drivers', name: 'slalomWeave', params: SAFE_WEAVE, untilX: -30 });
    await page.screenshot({ path: shot(`${name}-slalom-weaving`) });
    assert.match(await text('#gym-gates'), /^Cones \d\/7$/);
    await run({ file: 'gymkhana-drivers', name: 'slalomWeave', params: SAFE_WEAVE, fresh: false });
    s = await status();
    assert.deepEqual([s.state, s.phase, s.result.cones, s.result.passed], ['finished', 'complete', 0, 7]);
    assert.ok(s.result.value > 12 && s.result.value < 15 && s.result.value === s.result.total, `${s.result.value} s`);
    const clean = s.result.value;
    assert.equal(await text('#gr-title'), 'Complete');
    assert.equal(await text('#gr-value'), `${clean.toFixed(2)} s`);
    assert.equal(await value(() => document.querySelector('#gr-new').hidden), false, 'NEW BEST');
    const rows = await text('#gr-stats');
    for (const want of ['Driving time', 'Penalties', 'None', 'Total time', 'Cones passed', '7 of 7']) assert.ok(rows.includes(want), `the result shows ${want}`);
    await page.screenshot({ path: shot(`${name}-slalom-result`) });
    assert.deepEqual(await saved('mini-drifters-gymkhana-v1'), { version: 1, challenges: { 'precision-180': V040_PRECISION, 'slalom-sprint': { classic: { 'slalom-sprint-1': { best: clean } } } } });
    ok(`Slalom Sprint, Classic: a clean run in ${clean.toFixed(2)} s, driving time + penalties + total shown, record saved`);

    // --- Retry, with penalties -----------------------------------------------------------------
    await key('KeyR');
    s = await status();
    assert.deepEqual([s.state, s.time, s.next, s.hit, s.phase, s.x], ['ready', 0, 0, 0, 'running', -99]);
    const clipped = await run({ file: 'gymkhana-drivers', name: 'slalomWeave', params: { speed: 12, amp: 1.3 }, watch: '#banner' });
    s = await status();
    assert.equal(s.phase, 'complete');
    assert.ok(s.result.cones >= 3, `${s.result.cones} cones`);
    assert.equal(s.result.penalty, 2 * s.result.cones);
    assert.equal(s.result.total, Math.round((s.result.time + s.result.penalty) * 1000) / 1000);
    assert.ok(clipped.seen.some((b) => /CONE \+2 S/.test(b)), `the banner said so: ${clipped.seen.join('|')}`);
    assert.ok((await text('#gr-stats')).includes(`+${s.result.penalty} s`));
    assert.equal(await value(() => document.querySelector('#gr-new').hidden), true);
    assert.equal((await saved('mini-drifters-gymkhana-v1')).challenges['slalom-sprint'].classic['slalom-sprint-1'].best, clean, 'a slower total does not replace the best');
    await page.screenshot({ path: shot(`${name}-slalom-penalties`) });
    ok(`Slalom Sprint: retry resets car, clock and cones; ${s.result.cones} cones cost ${s.result.penalty} s on the result`);

    // --- Failing -------------------------------------------------------------------------------
    await key('KeyR');
    await run({ file: 'gymkhana-drivers', name: 'slalomStraight' });
    s = await status();
    assert.deepEqual([s.phase, s.reason, s.result.value], ['failed', 'wrong side of cone 1', null]);
    assert.equal(await text('#gr-title'), 'Run failed');
    assert.match(await text('#gr-reason'), /cone 1 on the wrong side/);
    assert.equal(await text('#gr-value'), '--');
    await page.screenshot({ path: shot(`${name}-slalom-failed`) });
    await key('KeyR');
    await run({ file: 'gymkhana-drivers', name: 'slalomWeave', params: { speed: 15, amp: 2.8, exitY: 9 } });
    s = await status();
    assert.deepEqual([s.phase, s.reason], ['failed', 'missed the finish']);
    assert.equal((await saved('mini-drifters-gymkhana-v1')).challenges['slalom-sprint'].classic['slalom-sprint-1'].best, clean, 'failed runs change nothing');
    ok('Slalom Sprint: straight over the cones and a missed finish both fail, explained, with no record');

    // --- By controller, in Power ----------------------------------------------------------------
    await value(() => { window.__pads = [window.__newPad()]; window.__frames(3); });
    await press(0); // A: Try again
    s = await status();
    assert.deepEqual([s.state, s.time], ['ready', 0]);
    await run({ file: 'gymkhana-drivers', name: 'slalomWeave', params: { speed: 8.8, amp: 3.5 }, via: 'pad' });
    s = await status();
    assert.deepEqual([s.state, s.phase, s.result.passed], ['finished', 'complete', 7]);
    await press(13); await press(13); // down to Challenges
    await press(0);
    s = await status();
    assert.deepEqual([s.state, s.sheet, s.chosen], ['menu', true, 'slalom-sprint']);
    await value(() => { window.__pads = []; window.__frames(3); });
    await key('KeyH');
    assert.equal((await status()).selected, 'revised');
    assert.equal(await text('#challenge-best'), '--', 'Power has no best yet');
    await key('Enter');
    await run({ file: 'gymkhana-drivers', name: 'slalomWeave', params: SAFE_WEAVE });
    s = await status();
    assert.deepEqual([s.phase, s.handling], ['complete', 'revised']);
    const inPower = s.result.value;
    const gym = await saved('mini-drifters-gymkhana-v1');
    assert.equal(gym.challenges['slalom-sprint'].revised['slalom-sprint-1'].best, inPower);
    assert.ok(gym.challenges['slalom-sprint'].classic['slalom-sprint-1'].best <= clean);
    ok(`Slalom Sprint: completed by controller; Power keeps its own best (${inPower.toFixed(2)} s)`);

    // --- Leaving, a normal run afterwards, and a reload -------------------------------------------
    await page.locator('#gymkhana-results .return-title').click();
    await frames(3);
    assert.equal((await status()).state, 'menu');
    await chooseTracks(page);
    await key('ArrowLeft');
    await key('ArrowLeft');
    assert.equal((await status()).chosenTrack, 'original');
    await key('Enter');
    await run({ file: 'drivers', name: 'gripDriver', seconds: 8, untilS: 9999 });
    s = await status();
    assert.deepEqual([s.kind, s.track, s.challenge], ['normal', 'original', null]);
    // Everything the page itself has written so far, before this check reads anything.
    const written = () => value(() => [...new Set(window.__writes)].filter((k) => k !== '__seeded').sort());
    const unexpected = (list) => list.filter((k) => !KEYS.includes(k));
    assert.deepEqual(unexpected(await written()), [], 'no new storage key');
    await load();
    s = await status();
    assert.equal(s.selected, 'revised', 'the handling choice is remembered');
    assert.deepEqual((await saved('mini-drifters-gymkhana-v1')).challenges['slalom-sprint'], gym.challenges['slalom-sprint'], 'bests survive a reload');
    ok('leaving for the title, a normal run on Original afterwards, and a reload');

    // --- The v0.4.0 saves --------------------------------------------------------------------------
    assert.deepEqual(unexpected(await written()), [], 'still no new storage key after the reload');
    const store = await value(() => Object.keys(localStorage).filter((k) => k !== '__seeded').sort());
    assert.deepEqual(store, [...KEYS].sort(), 'the same four keys as v0.4.0, and no others');
    const records = await saved('mini-drifters-records-v3');
    assert.equal(records.version, 3);
    assert.deepEqual(originalKept(records.tracks), V040_ORIGINAL_KEPT, 'the v0.4.0 Original record is exactly as it was');
    await chooseTracks(page);
    await page.locator('#tracks label', { hasText: /original/i }).click();
    await key('KeyH');
    assert.deepEqual([(await status()).chosenTrack, (await status()).selected], ['original', 'classic']);
    assert.ok(await value(() => document.querySelector('.personal-bests').textContent.includes('99,999')), 'and still shown');
    await key('KeyH');
    assert.deepEqual(Object.keys(records.tracks.dockyard).sort(), ['classic', 'revised']);
    await key('Escape');
    const challenges = await saved('mini-drifters-gymkhana-v1');
    assert.equal(challenges.version, 1);
    assert.deepEqual(challenges.challenges['precision-180'], V040_PRECISION, 'the v0.4.0 Precision 180 record is exactly as it was');
    await page.locator('#gymkhana').click();
    await frames(2);
    await key('KeyH');
    assert.equal((await status()).selected, 'classic');
    assert.equal(await text('#challenge-best'), '6.54 s', 'and it is still shown');
    await key('Escape');
    assert.deepEqual(errors, [], 'no page errors');
    ok('v0.4.0 saves were read, shown and kept intact; Dockyard and Slalom Sprint records sit beside them in the same keys');
  } finally {
    await browser.close();
  }
}

let failed = false;
for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) {
  try { await check(name, engine); }
  catch (error) { failed = true; console.error(`${name}: FAILED\n${error.stack ?? error}`); }
}
server.close();
process.exit(failed ? 1 : 0);
