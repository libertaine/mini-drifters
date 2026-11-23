// Browser check for Getaway Driver, served as on Pages, in Chromium and Firefox. Run:
//   node test/getaway-driver-browser.mjs [/path/to/playwright/index.mjs]
// - the Getaway sheet offers Get the Footage and Getaway Driver with no URL switch, by mouse,
//   keyboard and controller;
// - a calm run reaches the safehouse unnoticed (Ghost run); Low profile and Lost them are told
//   apart on the results sheet; a reckless run is spotted, chased with BUST RISK and the escape bar;
// - each completion is counted under its outcome, per handling mode, under the mission's own key
//   only, and the counts survive a reload; a bust counts nothing;
// - unavailable storage is reported and play goes on; the sheets fit 1024x600, 1366x768 and
//   1920x1080; Get the Footage gets its own meter back; the page raises no errors.
// Only the frame clock is mocked. Screenshots go to artifacts/screens-driver/.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
await mkdir(new URL('artifacts/screens-driver/', root), { recursive: true });
const shot = (name) => fileURLToPath(new URL(`artifacts/screens-driver/${name}.png`, root));
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

const KEY = 'mini-drifters-getaway-driver-v1';
const SIZES = [[1024, 600], [1366, 768], [1920, 1080]];
// What a returning player already has saved: none of it may change.
const OTHERS = {
  'mini-drifters-records-v3': '{"version":3,"tracks":{"original":{"classic":{"fastestLap":48.067}}}}',
  'mini-drifters-gymkhana-v1': '{"version":1,"challenges":{"linked-drift":{"classic":{"linked-drift-1+scoring-2":{"best":700}}}}}',
  'mini-drifters-getaway-v1': '{"version":1,"missions":{"get-the-footage":{"downtown":{"classic":{"x":{"best":1234}}}}}}',
  'mini-drifters-ghosts-v1': '{"version":1,"ghosts":{}}',
};
const MENU = ['#challenges', '#challenge-brief', '#challenge-points', '#challenge-best-label', '#challenge-best', '#challenge-next', '#gymkhana-handling', '#gymkhana-records-note', '#gymkhana-start', '#gymkhana-back'];
const RESULTS = ['#gr-eyebrow', '#gr-title', '#gr-reason', '#gr-stats', '#gr-next', '#gr-best', '#gr-records-note', '#gymkhana-again', '#gymkhana-change'];

// Runs before the page's code in every document of a context. `seed` is written once per context
// (sessionStorage remembers), so a reload sees what the game itself saved.
function harness([seed, storageMode]) {
  if (storageMode === 'denied') {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Denied', 'SecurityError'); } });
  } else {
    if (seed && !sessionStorage.getItem('seeded')) {
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
      sessionStorage.setItem('seeded', 'yes');
    }
    localStorage.setItem('mini-drifters-sound', 'off');
  }
  window.__writes = [];
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { window.__writes.push(k); return set.call(this, k, v); };
  // A mocked controller, unplugged until a test plugs it in (the controller suites' own mock).
  window.__pads = [];
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__pads });
  window.__newPad = () => ({ index: 0, id: 'Mock pad', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })) });
  window.requestAnimationFrame = (callback) => { window.__nextFrame = callback; return 1; };
  let now;
  window.__frames = (count = 2, dt = 1000 / 60) => {
    now ??= performance.now();
    for (let i = 0; i < count; i++) { now += dt; window.__nextFrame(now); }
  };
  window.__driver = null;
  // Drives the live run until it ends, `maxSeconds` pass, or `until(run)` holds. `history` is set on
  // the run once, after the first frame: how the results sheet tells Low profile and Lost them apart.
  window.__drive = async (make, maxSeconds, until = null, history = null) => {
    const D = await import('/test/support/urban-drivers.mjs');
    const m = window.__miniDrifters;
    if (make) window.__driver = make === 'calm' ? D.urbanGrip({ lateral: 8, cap: 17 }) : D.urbanGrip({ lateral: 10 });
    const stop = until ? new Function('run', `return (${until})(run);`) : null;
    for (let i = 0; i < maxSeconds * 60 && m.game.state !== 'finished'; i++) {
      Object.assign(m.input, window.__driver(m.game));
      window.__frames(1);
      if (i === 0 && history) Object.assign(m.game.challenge, history);
      if (stop && m.game.challenge && stop(m.game.challenge)) break;
    }
    if (m.game.state === 'finished') { for (const k of Object.keys(m.input)) m.input[k] = false; window.__frames(2); }
    const c = m.game.challenge;
    return { phase: c?.phase, reason: c?.reason, outcome: c?.result?.outcome ?? null, time: c?.time ?? 0, pursuing: c?.pursuing, detections: c?.detections };
  };
}

async function check(name, engine) {
  const browser = await engine.launch({ headless: true });
  const errors = [];
  const passed = [];
  const ok = (what) => passed.push(what);
  try {
    // A context per profile: `seed` and `storageMode` as harness() takes them.
    const open = async (seed, storageMode = 'normal') => {
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      await context.addInitScript(harness, [seed, storageMode]);
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
      const value = (fn, arg) => page.evaluate(fn, arg);
      const frames = (n = 2) => value((k) => window.__frames(k), n);
      const text = (sel) => page.locator(sel).textContent();
      return {
        page, value, frames, text, context,
        load: async (query = '') => { await page.goto(`${base}${query}`); await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 }); await frames(2); },
        missions: () => page.locator('#getaway-missions button').evaluateAll((b) => b.map((x) => [x.id, x.textContent])),
        // Title -> Getaway -> Getaway Driver, by mouse.
        openDriver: async () => { await page.click('#getaway'); await frames(2); await page.click('#getaway-driver'); await frames(2); },
        start: async () => { await page.click('#gymkhana-start'); await frames(4); },
        raw: () => value((k) => localStorage.getItem(k), KEY),
        writes: () => value(() => window.__writes.filter((k) => k !== 'mini-drifters-sound')),
        results: async () => ({
          title: await text('#gr-title'), driver: await value(() => document.querySelector('#gymkhana-results').dataset.driver),
          color: await value(() => getComputedStyle(document.querySelector('#gr-title')).color),
          next: await text('#gr-next'), best: await text('#gr-best'), note: await text('#gr-records-note'),
        }),
        // Every listed element is inside the viewport and its sheet, no two overlap, and the sheet
        // has no hidden overflow (the Getaway records check's own test).
        fits: async (sheet, sels, label) => {
          for (const [w, h] of SIZES) {
            await page.setViewportSize({ width: w, height: h });
            await page.waitForFunction(([ww, hh]) => innerWidth === ww && innerHeight === hh, [w, h]);
            await page.waitForTimeout(80);
            await frames(2);
            const report = await value(([s, list]) => {
              const sheetEl = document.querySelector(s);
              const box = sheetEl.getBoundingClientRect();
              const boxes = list.map((sel) => [sel, document.querySelector(sel)]).filter(([, el]) => el && el.getClientRects().length && el.textContent.trim())
                .map(([sel, el]) => [sel, el.getBoundingClientRect()]);
              const outside = boxes.filter(([, r]) => r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5
                || r.left < -0.5 || r.right > innerWidth + 0.5).map(([sel]) => sel);
              const overlaps = [];
              for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
                const [a, ra] = boxes[i]; const [b, rb] = boxes[j];
                if (ra.left < rb.right - 0.5 && rb.left < ra.right - 0.5 && ra.top < rb.bottom - 0.5 && rb.top < ra.bottom - 0.5) overlaps.push(`${a}/${b}`);
              }
              const clipped = [...sheetEl.querySelectorAll('p, dd, dt, span, b')].filter((el) => el.getClientRects().length && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible').map((el) => el.id || el.className);
              return { outside, overlaps, clipped, scroll: sheetEl.scrollHeight - sheetEl.clientHeight };
            }, [sheet, sels]);
            assert.deepEqual(report.outside, [], `${label} ${w}x${h}: inside the sheet and the screen`);
            assert.deepEqual(report.overlaps, [], `${label} ${w}x${h}: nothing overlaps`);
            assert.deepEqual(report.clipped, [], `${label} ${w}x${h}: no clipped text`);
            assert.ok(report.scroll <= 1, `${label} ${w}x${h}: no hidden overflow (${report.scroll}px)`);
            if (name === 'chromium') await page.screenshot({ path: shot(`${label}-${w}x${h}`) });
          }
          await page.setViewportSize({ width: 1366, height: 768 });
          await page.waitForTimeout(80);
          await frames(2);
        },
      };
    };

    // --- 1. On the Getaway sheet, with no switch --------------------------------------------------------
    const p = await open(OTHERS);
    await p.load();
    await p.page.click('#getaway');
    await p.frames(2);
    assert.deepEqual(await p.missions(), [['get-the-footage', 'Get the Footage'], ['getaway-driver', 'Getaway Driver']]);
    assert.equal(await p.text('#getaway-driver-description'), 'Lie low. Reach the safehouse. If they spot you, lose them first.');
    // The retired research switch changes nothing.
    await p.load('?driver');
    await p.page.click('#getaway');
    await p.frames(2);
    assert.deepEqual(await p.missions(), [['get-the-footage', 'Get the Footage'], ['getaway-driver', 'Getaway Driver']]);
    ok('the Getaway sheet lists Get the Footage then Getaway Driver, with or without ?driver');

    // By keyboard: Getaway, then Down to the second mission, Enter.
    await p.load();
    await p.page.focus('#getaway');
    await p.page.keyboard.press('Enter');
    await p.frames(2);
    assert.equal(await p.value(() => document.activeElement.id), 'get-the-footage');
    await p.page.keyboard.press('ArrowDown');
    await p.frames(1);
    assert.equal(await p.value(() => document.activeElement.id), 'getaway-driver');
    await p.page.keyboard.press('Enter');
    await p.frames(2);
    assert.equal(await p.text('#gymkhana-title'), 'Getaway Driver');
    assert.equal(await p.value(() => document.activeElement.id), 'gymkhana-start');
    // Esc goes back to the missions, on Getaway Driver.
    await p.page.keyboard.press('Escape');
    await p.frames(2);
    assert.equal(await p.value(() => document.activeElement.id), 'getaway-driver');
    ok('keyboard: Getaway, Down, Enter opens Getaway Driver; Esc returns to it');

    // The sheet: no best or medal, the counts for this handling mode.
    await p.page.keyboard.press('Enter');
    await p.frames(2);
    assert.match(await p.text('#challenge-brief'), /safehouse/);
    assert.equal(await p.text('#challenge-best-label'), 'Finishes');
    assert.equal(await p.text('#challenge-best'), '0');
    assert.equal(await p.text('#challenge-next'), 'Ghost run 0 · Low profile 0 · Lost them 0');
    assert.match(await p.text('#gymkhana-handling'), /Each handling mode keeps its own count\./);
    assert.equal(await p.text('#gymkhana-records-note'), '');
    assert.equal(await p.page.locator('#challenge-targets li').count(), 0);
    assert.doesNotMatch(await p.text('#gymkhana-menu'), /research|no records/i);
    await p.fits('#gymkhana-menu .sheet', MENU, 'sheet-new');
    ok('a new player sees 0 finishes and the three outcomes at 0; no research wording; the sheet fits at three sizes');

    // --- 2. A Ghost run, counted ---------------------------------------------------------------------
    await p.start();
    assert.equal(await p.value(() => window.__miniDrifters.game.challengeDef.id), 'getaway-driver-downtown');
    assert.equal(await p.page.locator('#bust').isVisible(), true);
    assert.equal(await p.text('.bust-head .bust-label'), 'Attention');
    let r = await p.value(() => window.__drive('calm', 4));
    assert.equal(await p.text('#gym-medal'), 'On for: Ghost run');
    if (name === 'chromium') await p.page.screenshot({ path: shot('calm-start') });
    r = await p.value(() => window.__drive(null, 120));
    assert.equal(r.phase, 'complete', JSON.stringify(r));
    assert.equal(r.outcome, 'ghost');
    let res = await p.results();
    assert.equal(res.title, 'Ghost run');
    assert.equal(res.driver, 'ghost');
    assert.equal(res.color, 'rgb(95, 211, 138)');
    assert.equal(res.next, 'The cleanest way home: never even suspicious.');
    assert.equal(res.best, 'Finishes with Classic handling: Ghost run 1 · Low profile 0 · Lost them 0 (+1 Ghost run)');
    assert.equal(res.note, '');
    assert.deepEqual(JSON.parse(await p.raw()), { version: 1, environments: { downtown: { classic: { ghost: 1 } } } });
    assert.deepEqual(await p.writes(), [KEY]);
    await p.fits('#gymkhana-results .sheet', RESULTS, 'results-ghost');
    ok('a calm run is a Ghost run: green title, +1 under downtown/classic/ghost, only its own key written; results fit');

    // --- 3. Low profile and Lost them ----------------------------------------------------------------
    // The same calm route, with the run's history set at the start (noticed; chased and lost).
    await p.page.click('#gymkhana-again');
    await p.frames(3);
    r = await p.value(() => window.__drive('calm', 120, null, { peakAttention: 0.5 }));
    assert.equal(r.outcome, 'low profile', JSON.stringify(r));
    res = await p.results();
    assert.equal(res.title, 'Low profile');
    assert.equal(res.driver, 'low-profile');
    assert.equal(res.color, 'rgb(255, 182, 39)');
    assert.match(res.next, /stay under SUSPICIOUS all the way for a Ghost run/);
    assert.equal(res.best, 'Finishes with Classic handling: Ghost run 1 · Low profile 1 · Lost them 0 (+1 Low profile)');
    await p.page.keyboard.press('KeyR');
    await p.frames(3);
    r = await p.value(() => window.__drive('calm', 120, null, { peakAttention: 1, detections: 1, escapes: 1 }));
    assert.equal(r.outcome, 'lost them', JSON.stringify(r));
    res = await p.results();
    assert.equal(res.title, 'Lost them');
    assert.equal(res.driver, 'lost-them');
    assert.equal(res.color, 'rgb(255, 122, 61)');
    assert.match(await p.text('#gr-reason'), /^Spotted 1 time, and lost them every time\./);
    assert.equal(res.best, 'Finishes with Classic handling: Ghost run 1 · Low profile 1 · Lost them 1 (+1 Lost them)');
    if (name === 'chromium') await p.page.screenshot({ path: shot('result-lost-them') });
    await p.fits('#gymkhana-results .sheet', RESULTS, 'results-lost-them');
    ok('Low profile (amber) and Lost them (orange) are told apart, each with its own line and count');

    // --- 4. A reckless run: chased, and a bust counts nothing ------------------------------------------
    await p.page.keyboard.press('KeyR');
    await p.frames(3);
    r = await p.value(() => window.__drive('fast', 60, '(run) => run.pursuing && run.time - run.pursuitStart > 1.2'));
    assert.equal(r.pursuing, true, JSON.stringify(r));
    await p.frames(2);
    assert.equal(await p.text('.bust-head .bust-label'), 'Bust risk');
    assert.equal(await p.page.locator('#bust-lose').isVisible(), true);
    assert.equal(await p.text('#gym-medal'), 'Lose them first');
    if (name === 'chromium') await p.page.screenshot({ path: shot('pursuit') });
    const before = await p.raw();
    r = await p.value(() => window.__drive(null, 150));
    assert.equal(await p.value(() => window.__miniDrifters.game.state), 'finished');
    res = await p.results();
    if (r.phase === 'failed') {
      assert.equal(res.driver, '');
      assert.equal(await p.raw(), before, 'a failed run counts nothing');
      assert.doesNotMatch(res.best, /\+1/);
    } else assert.equal(r.outcome, 'lost them');
    if (name === 'chromium') await p.page.screenshot({ path: shot(`result-${r.phase === 'complete' ? 'escaped' : r.reason.replace(/\s/g, '-')}`) });
    ok(`a reckless run is spotted and chased (BUST RISK, escape bar, "Lose them first"), ending ${r.phase === 'complete' ? 'Lost them' : r.reason}${r.phase === 'failed' ? ', counting nothing' : ''}`);

    // --- 5. Kept, per handling mode --------------------------------------------------------------------
    await p.load();
    await p.openDriver();
    assert.equal(await p.text('#challenge-best'), '3');
    assert.equal(await p.text('#challenge-next'), 'Ghost run 1 · Low profile 1 · Lost them 1');
    await p.fits('#gymkhana-menu .sheet', MENU, 'sheet-saved');
    await p.page.keyboard.press('KeyH');
    await p.frames(2);
    assert.match(await p.text('#gymkhana-handling'), /^Power handling/);
    assert.equal(await p.text('#challenge-best'), '0');
    await p.start();
    r = await p.value(() => window.__drive('calm', 120));
    assert.equal(r.outcome, 'ghost');
    assert.equal((await p.results()).best, 'Finishes with Power handling: Ghost run 1 · Low profile 0 · Lost them 0 (+1 Ghost run)');
    assert.deepEqual(JSON.parse(await p.raw()), { version: 1, environments: { downtown: {
      classic: { ghost: 1, 'low-profile': 1, 'lost-them': 1 }, revised: { ghost: 1 } } } });
    ok('after a reload the counts are kept and the sheet fits; Power keeps its own');

    // Nothing else saved was touched, and Get the Footage gets its sheet and meter back.
    const saved = await p.value((keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])), Object.keys(OTHERS));
    assert.deepEqual(saved, OTHERS);
    assert.deepEqual([...new Set(await p.writes())].filter((k) => k !== 'mini-drifters-handling'), [KEY]);
    await p.load();
    await p.page.click('#getaway');
    await p.page.click('#get-the-footage');
    await p.frames(2);
    assert.match(await p.text('#challenge-best-label'), /Personal best · Showmanship/);
    await p.start();
    assert.equal(await p.text('.bust-head .bust-label'), 'Bust risk');
    assert.equal(await p.page.locator('#bust-lose').isVisible(), false);
    await p.context.close();
    ok('circuit, Gymkhana, Get the Footage and ghost keys are unchanged; Get the Footage shows its own sheet and meter');

    // --- 6. By controller ----------------------------------------------------------------------------
    const c = await open(null);
    await c.load();
    const press = async (i) => {
      await c.value((b) => { window.__pads[0].buttons[b] = { value: 1, pressed: true }; window.__frames(2); }, i);
      await c.value((b) => { window.__pads[0].buttons[b] = { value: 0, pressed: false }; window.__frames(2); }, i);
    };
    await c.page.focus('#getaway');
    await c.value(() => { window.__pads = [window.__newPad()]; window.__frames(4); });
    await press(0);   // A
    assert.equal(await c.value(() => document.activeElement.id), 'get-the-footage');
    await press(13);  // D-pad down
    assert.equal(await c.value(() => document.activeElement.id), 'getaway-driver');
    await press(0);
    assert.equal(await c.text('#gymkhana-title'), 'Getaway Driver');
    assert.match(await c.text('#gymkhana-handling'), /chosen on the title screen\. Each handling mode keeps its own count\./);
    await c.context.close();
    ok('controller: A, D-pad down, A opens Getaway Driver');

    // --- 7. Storage unavailable ------------------------------------------------------------------------
    const d = await open(null, 'denied');
    await d.load();
    await d.openDriver();
    assert.equal(await d.text('#challenge-best'), '0');
    assert.equal(await d.text('#gymkhana-records-note'), 'Storage unavailable. Finishes cannot be counted on this device.');
    await d.fits('#gymkhana-menu .sheet', MENU, 'sheet-denied');
    await d.start();
    r = await d.value(() => window.__drive('calm', 120));
    assert.equal(r.outcome, 'ghost');
    res = await d.results();
    assert.equal(res.title, 'Ghost run');
    assert.equal(res.best, 'Finishes with Classic handling: Ghost run 0 · Low profile 0 · Lost them 0');
    assert.equal(res.note, 'Storage unavailable. Finishes cannot be counted on this device.');
    await d.fits('#gymkhana-results .sheet', RESULTS, 'results-denied');
    await d.context.close();
    ok('denied storage: the run plays to a Ghost run, nothing is counted, and both sheets say so and fit');

    assert.deepEqual(errors, []);
    for (const line of passed) console.log(`${name}: ok - ${line}`);
  } catch (error) {
    for (const line of passed) console.log(`${name}: ok - ${line}`);
    throw error;
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
