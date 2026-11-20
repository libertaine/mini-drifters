// Gymkhana medals on the real page, in Chromium and Firefox: records saved by an earlier version
// earn their medals on load without a write; the sheet's medals, targets and next-medal line follow
// the challenge and the handling mode by keyboard and by a mocked controller; the HUD names the
// next target and never a medal for the run; the results sheet tells a new medal from one
// already held, shows no medal for a failed run, and claims nothing it could not save; and the
// sheets fit the window from 1024x600 to 1920x1080. Only the Gamepad API and the frame clock are
// mocked, and every origin is a throwaway one on a random port, so no real save is touched.
//   node test/medals-browser.mjs /path/to/playwright/index.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
await mkdir(new URL('artifacts/', root), { recursive: true });
const shot = (name) => fileURLToPath(new URL(`artifacts/medals-${name}.png`, root));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!/^(index\.html|style\.css|src\/[\w-]+\.js|test\/support\/gymkhana-drivers\.mjs|(?:audio-lab\/assets|radio)\/[\w/.-]+)$/.test(file) || file.includes('..')) {
    res.writeHead(404); res.end(); return;
  }
  try { const data = await readFile(new URL(file, root)); res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/plain' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const KEY = 'mini-drifters-gymkhana-v1';
const CIRCUIT_KEY = 'mini-drifters-records-v3';
const DEG = Math.PI / 180;
const TIDY = { vCap: 24, triggerX: -8, release: 110 * DEG };     // 7.36 s in Classic: Gold
const GRIP = { vTurn: 5 };                                        // about 9.5 s: Bronze
const FLAT_OUT = { triggerX: 8, release: 110 * DEG };             // leaves the box: fails
const SIZES = [[1920, 1080], [1366, 768], [1280, 720], [1024, 600]];

// Records exactly as v0.4.0 to v0.6.0 save them (schema 1). Seeded once, before the harness
// starts counting writes, so the page's own writes are all that __writes sees.
const SEEDED = JSON.stringify({ version: 1, challenges: {
  'precision-180': { revised: { 'precision-180-1': { best: 8.1 } } },
  'linked-drift': { classic: { 'linked-drift-1+scoring-2': { best: 900 } }, revised: { 'linked-drift-1+scoring-2': { best: 900 } } },
  'one-drift': { classic: { 'one-drift-1+scoring-2': { best: 0 } } },
} });

function harness([key, seeded]) {
  if (seeded && sessionStorage.getItem('seeded') !== 'yes') { localStorage.setItem(key, seeded); sessionStorage.setItem('seeded', 'yes'); }
  localStorage.setItem('mini-drifters-sound', 'off');
  window.__writes = [];
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { if (this === localStorage) window.__writes.push(k); return set.call(this, k, v); };
  window.__pads = [];
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__pads });
  window.requestAnimationFrame = (callback) => { window.__nextFrame = callback; return 1; };
  let now;
  window.__frames = (count = 2, dt = 1000 / 60) => { now ??= performance.now(); for (let i = 0; i < count; i++) { now += dt; window.__nextFrame(now); } };
  window.__newPad = () => ({ index: 0, id: 'Mock', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })) });
  window.__drive = async (driverName, params, maxSeconds, watch) => {
    const drivers = await import('/test/support/gymkhana-drivers.mjs');
    const m = window.__miniDrifters;
    const driver = drivers[driverName](params);
    const seen = new Set();
    for (let i = 0; i < maxSeconds * 60 && m.game.state !== 'finished'; i++) {
      Object.assign(m.input, driver(m.game));
      window.__frames(1);
      // Only while the run is still being driven: once it is over the record may be saved.
      if (watch && m.game.challenge.phase === 'running') seen.add(document.querySelector(watch)?.textContent ?? '');
    }
    for (const k of Object.keys(m.input)) m.input[k] = false;
    window.__frames(2);
    return { phase: m.game.challenge.phase, value: m.game.challenge.result?.value ?? null, seen: [...seen] };
  };
}

async function check(name, engine) {
  const browser = await engine.launch({ headless: true });
  const ok = (message) => console.log(`${name}: ${message}`);
  const errors = [];

  async function open(context) {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const value = (fn, arg) => page.evaluate(fn, arg);
    const api = {
      page, value,
      load: async () => { await page.goto(base); await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 }); await value(() => window.__frames(2)); },
      frames: (n = 2) => value((k) => window.__frames(k), n),
      key: async (code) => { await page.keyboard.press(code); await value(() => window.__frames(2)); },
      text: (sel) => value((s) => document.querySelector(s)?.textContent ?? null, sel),
      attr: (sel, a) => value(([s, x]) => document.querySelector(s)?.getAttribute(x) ?? null, [sel, a]),
      shown: (sel) => value((s) => { const el = document.querySelector(s); return !!el && !el.hidden && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0; }, sel),
      focused: () => value(() => { const el = document.activeElement; return el?.id || el?.value || el?.tagName; }),
      chosen: () => value(() => window.__miniDrifters.gymkhana().selected),
      handling: () => value(() => window.__miniDrifters.selectedHandling()),
      drive: (driverName, params, watch = null, maxSeconds = 70) => value(([d, p, s, w]) => window.__drive(d, p, s, w), [driverName, params, maxSeconds, watch]),
      raw: () => value((k) => localStorage.getItem(k), KEY),
      writes: () => value(() => [...new Set(window.__writes.filter((k) => k !== 'mini-drifters-sound' && !k.startsWith('mini-drifters-radio') && !k.startsWith('mini-drifters-audio')))]),
      // The medal on each challenge button, by the initial its disc carries ('' for none).
      slots: () => value(() => [...document.querySelectorAll('#challenges .medal-slot')].map((s) => s.textContent)),
      targets: () => value(() => [...document.querySelectorAll('#challenge-targets li')].map((li) => `${li.textContent.trim()}${li.dataset.held ? ' held' : ''}`)),
      press: async (index) => {
        await value((i) => { window.__pads[0].buttons[i] = { value: 1, pressed: true }; window.__frames(); }, index);
        await value((i) => { window.__pads[0].buttons[i] = { value: 0, pressed: false }; window.__frames(); }, index);
      },
      outside: (sels) => value((list) => list.filter((sel) => {
        const el = document.querySelector(sel);
        if (!el || !el.getClientRects().length) return true;
        const r = el.getBoundingClientRect();
        return r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5;
      }), sels),
      sizes: async (label, sels, picture) => {
        for (const [w, h] of SIZES) {
          await page.setViewportSize({ width: w, height: h });
          await page.waitForTimeout(120);
          await value(() => window.__frames(2));
          assert.deepEqual(await api.outside(sels), [], `${label} fits at ${w}x${h}`);
          if (picture) await page.screenshot({ path: shot(`${name}-${picture}-${w}x${h}`) });
        }
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.waitForTimeout(120);
        await value(() => window.__frames(2));
      },
    };
    return api;
  }

  try {
    // --- 1. Records from an earlier version earn their medals on load, with no write ----------
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addInitScript(harness, [KEY, SEEDED]);
    const p = await open(context);
    const { page, value, key, text, attr, shown, focused, chosen, handling, drive, raw, writes, slots, targets, press, frames } = p;
    await p.load();
    assert.equal(await raw(), SEEDED, 'the seeded records are as saved');
    assert.deepEqual(await writes(), [], 'loading writes nothing');
    await page.locator('#gymkhana').click();
    await frames();
    assert.equal(await chosen(), 'precision-180');
    assert.equal(await handling(), 'classic');
    // Precision 180, Classic: no record.
    assert.equal(await text('#challenge-best'), '--');
    assert.equal(await text('#challenge-medal'), '', 'no record, so no medal and no invented one');
    assert.deepEqual(await targets(), ['GGold 7.600 s', 'SSilver 8.300 s', 'BBronze 30.000 s']);
    assert.equal(await text('#challenge-next'), 'No medal yet. Bronze: 30.000 s total or faster.');
    assert.deepEqual(await slots(), ['', 'G', '', ''], 'Linked Drift holds Gold in Classic; One Drift\'s 0 is a record without a medal');
    assert.equal(await attr('#challenges input[value="linked-drift"]', 'aria-label'), 'Linked Drift, Gold medal', 'the medal is in the name, not only the picture');
    assert.equal(await attr('#challenges input[value="precision-180"]', 'aria-label'), 'Precision 180');
    await page.screenshot({ path: shot(`${name}-sheet-none`) });
    // Keyboard: Right to Linked Drift, Classic Gold.
    await key('ArrowRight');
    assert.equal(await chosen(), 'linked-drift');
    assert.equal(await text('#challenge-best'), '900');
    assert.equal(await text('#challenge-medal'), 'GGold');
    assert.deepEqual(await targets(), ['GGold 850 pts held', 'SSilver 450 pts held', 'BBronze 1 pt held']);
    assert.match(await text('#challenge-next'), /^Gold held with this handling\./);
    await page.screenshot({ path: shot(`${name}-sheet-gold`) });
    // H: Power. The same 900 is Silver there, and the targets are Power's own.
    await key('KeyH');
    assert.equal(await handling(), 'revised');
    assert.equal(await text('#challenge-best'), '900');
    assert.equal(await text('#challenge-medal'), 'SSilver');
    assert.deepEqual(await targets(), ['GGold 950 pts', 'SSilver 450 pts held', 'BBronze 1 pt held']);
    assert.equal(await text('#challenge-next'), 'Next: Gold, 950 points or more.');
    assert.deepEqual(await slots(), ['S', 'S', '', ''], 'Power: Precision 180 at 8.10 s is Silver');
    // One Drift in Power: no record. Back to Classic: a 0-point record, no medal.
    await key('ArrowRight');
    assert.equal(await chosen(), 'one-drift');
    assert.equal(await text('#challenge-next'), 'No medal yet. Bronze: 1 point or more.');
    await key('KeyH');
    assert.equal(await handling(), 'classic');
    assert.equal(await text('#challenge-best'), '0');
    assert.equal(await text('#challenge-medal'), 'No medal');
    assert.equal(await text('#challenge-next'), 'Next: Bronze, 1 point or more.');
    await key('ArrowRight');
    assert.equal(await chosen(), 'slalom-sprint');
    assert.deepEqual(await targets(), ['GGold 14.800 s', 'SSilver 18.500 s', 'BBronze 40.000 s']);
    assert.equal(await raw(), SEEDED, 'browsing medals writes nothing');
    assert.deepEqual((await writes()).filter((k) => k !== 'mini-drifters-handling'), [],
      'nothing but the handling preference H has always saved (v0.3.0 on)');
    ok('records from an earlier version earn medals on load; Left/Right and H update medals, targets and the next medal; nothing is written');

    // --- 2. Controller: D-pad choice updates the medals ------------------------------------
    await value(() => { window.__pads = [window.__newPad()]; window.__frames(3); });
    await press(12); // up, onto the chosen challenge
    await press(15); // right: wraps to Precision 180
    assert.equal(await chosen(), 'precision-180');
    assert.equal(await text('#challenge-medal'), '');
    await press(15); // Linked Drift
    assert.equal(await chosen(), 'linked-drift');
    assert.equal(await text('#challenge-medal'), 'GGold');
    await press(14); // left: back to Precision 180
    await press(13); // down to Start
    assert.equal(await focused(), 'gymkhana-start');
    await value(() => { window.__pads = []; window.__frames(3); });
    await p.sizes('the Gymkhana sheet with medals', ['#gymkhana-menu .sheet', '#challenge-targets', '#challenge-next', '#gymkhana-start', '#gymkhana-back'], 'sheet');
    ok('controller: the D-pad chooses, and the medals follow; the sheet fits from 1024x600 to 1920x1080');

    // --- 3. A first Gold, newly earned and saved --------------------------------------------
    await key('Enter');
    assert.equal(await shown('#gym-medal'), true);
    assert.equal(await text('#gym-medal'), 'Next: Bronze 30.000 s total', 'a target, measured on the total');
    assert.equal(await text('#gym-best'), 'Best: --');
    let r = await drive('handbrake180', TIDY, '#gym-medal');
    assert.equal(r.phase, 'complete');
    assert.ok(r.value <= 7.6, `the tidy run is Gold: ${r.value}`);
    assert.deepEqual(r.seen, ['Next: Bronze 30.000 s total'], 'the HUD never gives the run a medal while it is driven');
    assert.equal(await text('#gr-title'), 'Complete');
    assert.equal(await shown('#gr-new'), true, 'NEW BEST, as before');
    assert.equal(await text('#gr-medal'), 'GGold medal · NEW MEDAL');
    assert.equal(await attr('#gr-medal', 'data-new'), 'true');
    assert.match(await text('#gr-next'), /^Gold held with this handling\./);
    const saved = JSON.parse(await raw());
    assert.equal(saved.version, 1, 'still schema 1');
    assert.equal(saved.challenges['precision-180'].classic['precision-180-1'].best, r.value, 'the time is saved as a record, nothing more');
    assert.deepEqual(Object.keys(saved.challenges['precision-180'].classic['precision-180-1']), ['best'], 'no medal is stored');
    assert.deepEqual(saved.challenges['linked-drift'], JSON.parse(SEEDED).challenges['linked-drift'], 'other records untouched');
    assert.ok((await writes()).includes(KEY), 'the record was written');
    assert.ok(!(await writes()).includes(CIRCUIT_KEY), 'the circuit records are never written');
    await p.sizes('the results sheet with a medal', ['#gymkhana-results .sheet', '#gr-medal', '#gr-next', '#gymkhana-again', '#gymkhana-results .return-title'], 'results-gold');
    ok('a first Gold: NEW MEDAL and NEW BEST, only the record is saved, and the HUD only ever showed a target');

    // --- 4. A slower Bronze run: the Gold stands, and nothing is announced ------------------
    await key('KeyR');
    r = await drive('gripUturn', GRIP);
    assert.equal(r.phase, 'complete');
    assert.ok(r.value > 8.3 && r.value <= 30, `the grip run is Bronze: ${r.value}`);
    assert.equal(await shown('#gr-new'), false);
    assert.equal(await text('#gr-medal'), 'BBronze medal', 'this run\'s medal, not new, and nothing "not saved" since a better one is held');
    assert.equal(await attr('#gr-medal', 'data-new'), 'false');
    assert.match(await text('#gr-best'), /^Personal best with Classic handling: 7\.\d\d s$/);
    assert.match(await text('#gr-next'), /^Gold held with this handling\./, 'a worse run takes nothing away');

    // --- 5. A failed run: no medal line, the reason as before, nothing saved -----------------
    const before = await raw();
    await key('KeyR');
    r = await drive('handbrake180', FLAT_OUT);
    assert.equal(r.phase, 'failed');
    assert.equal(await text('#gr-title'), 'Run failed');
    assert.match(await text('#gr-reason'), /^You left the box\./);
    assert.equal(await shown('#gr-medal'), false, 'a failed run earns nothing');
    assert.equal(await text('#gr-next'), '');
    assert.equal(await raw(), before, 'and saves nothing');
    await key('KeyR');
    assert.equal(await value(() => window.__miniDrifters.game.state), 'ready', 'R still retries');
    ok('a slower run shows its own medal without taking the Gold away or calling it new; a failed run shows no medal and keeps its reason');

    // --- 6. Reload: the Gold is derived again from the saved record --------------------------
    await p.load();
    await page.locator('#gymkhana').click();
    await frames();
    assert.deepEqual(await slots(), ['G', 'G', '', ''], 'Precision 180 and Linked Drift hold Gold in Classic');
    assert.deepEqual(await writes(), [], 'and loading still writes nothing');
    await context.close();
    ok('reload: medals come back from the saved records alone');

    // --- 7. Storage denied: the run's medal is shown, and called not saved -------------------
    const denied = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await denied.addInitScript(() => Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Denied', 'SecurityError'); } }));
    await denied.addInitScript(() => {
      window.requestAnimationFrame = (callback) => { window.__nextFrame = callback; return 1; };
      let now;
      window.__frames = (count = 2, dt = 1000 / 60) => { now ??= performance.now(); for (let i = 0; i < count; i++) { now += dt; window.__nextFrame(now); } };
      window.__drive = async (driverName, params, maxSeconds) => {
        const drivers = await import('/test/support/gymkhana-drivers.mjs');
        const m = window.__miniDrifters;
        const driver = drivers[driverName](params);
        for (let i = 0; i < maxSeconds * 60 && m.game.state !== 'finished'; i++) { Object.assign(m.input, driver(m.game)); window.__frames(1); }
        for (const k of Object.keys(m.input)) m.input[k] = false;
        window.__frames(2);
        return { phase: m.game.challenge.phase, value: m.game.challenge.result?.value ?? null, seen: [] };
      };
    });
    const d = await open(denied);
    await d.load();
    await d.page.locator('#gymkhana').click();
    await d.frames();
    assert.equal(await d.text('#challenge-medal'), '');
    await d.page.locator('#gymkhana-start').click();
    await d.frames();
    assert.equal((await d.drive('handbrake180', TIDY)).phase, 'complete');
    assert.equal(await d.shown('#gr-new'), false);
    assert.equal(await d.text('#gr-medal'), 'GGold medal · not saved', 'earned by the run, never claimed as saved or new');
    assert.equal(await d.attr('#gr-medal', 'data-new'), 'false');
    assert.match(await d.text('#gr-records-note'), /^Record storage unavailable/);
    await d.sizes('the results sheet with a medal and a storage note', ['#gymkhana-results .sheet', '#gr-medal', '#gymkhana-again', '#gymkhana-results .return-title'], 'results-denied');
    await denied.close();
    ok('storage denied: the run\'s medal is shown as not saved, never as new, and the sheet still fits');

    // --- 8. Timed-result precision at Gold, Silver and Bronze boundaries ---------------------
    // 7.604 s must never display as 7.60 s beside a 7.600 s Gold target, on the sheet, HUD or
    // results sheet. Check 7.599, 7.600, 7.601, 7.604 plus Silver/Bronze and Slalom boundaries.
    const boundaryCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await boundaryCtx.addInitScript(harness, [KEY, JSON.stringify({
      version: 1,
      challenges: {
        'precision-180': {
          classic: { 'precision-180-1': { best: 7.604 } },
          revised: { 'precision-180-1': { best: 7.600 } },
        },
        'slalom-sprint': {
          classic: { 'slalom-sprint-1': { best: 14.804 } },
          revised: { 'slalom-sprint-1': { best: 18.504 } },
        },
      },
    })]);
    const b = await open(boundaryCtx);
    await b.load();
    await b.page.locator('#gymkhana').click();
    await b.frames();
    // Precision 180 Classic: 7.604 s misses 7.600 s Gold by 0.004 s.
    assert.equal(await b.text('#challenge-best'), '7.604 s');
    assert.equal(await b.text('#challenge-medal'), 'SSilver');
    assert.equal(await b.text('#challenge-next'), 'Next: Gold, 7.600 s total or faster. Missed by 0.004 s.');
    await b.sizes('the Gymkhana sheet at a millisecond near-miss', ['#gymkhana-menu .sheet', '#challenge-targets', '#challenge-next', '#gymkhana-start', '#gymkhana-back']);
    // Precision 180 Power: exact 7.600 s earns Gold and displays as 7.600 s.
    await b.key('KeyH');
    assert.equal(await b.text('#challenge-best'), '7.600 s');
    assert.equal(await b.text('#challenge-medal'), 'GGold');
    assert.equal(await b.text('#challenge-next'), 'Gold held with this handling.');
    // Slalom Sprint Power (18.504 s -> Bronze, missed Silver 18.500 s by 0.004 s) and Classic (14.804 s -> Silver).
    await b.key('ArrowLeft');
    assert.equal(await b.chosen(), 'slalom-sprint');
    assert.equal(await b.text('#challenge-best'), '18.504 s');
    assert.equal(await b.text('#challenge-medal'), 'BBronze');
    assert.equal(await b.text('#challenge-next'), 'Next: Silver, 18.500 s total or faster. Missed by 0.004 s.');
    await b.key('KeyH');
    assert.equal(await b.text('#challenge-best'), '14.804 s');
    assert.equal(await b.text('#challenge-medal'), 'SSilver');
    assert.equal(await b.text('#challenge-next'), 'Next: Gold, 14.800 s total or faster. Missed by 0.004 s.');
    // Back to Precision 180 Classic: check HUD shows 7.604 s and 7.600 s target, and a slower
    // run keeps 7.604 s on the results sheet with a consistent missed-by message.
    await b.key('ArrowRight');
    assert.equal(await b.chosen(), 'precision-180');
    await b.key('Enter');
    assert.equal(await b.text('#gym-best'), 'Best: 7.604 s');
    assert.equal(await b.text('#gym-medal'), 'Silver held · Next: Gold 7.600 s total');
    await b.drive('gripUturn', GRIP);
    assert.equal(await b.text('#gr-best'), 'Personal best with Classic handling: 7.604 s');
    assert.equal(await b.text('#gr-next'), 'Next: Gold, 7.600 s total or faster. Missed by 0.004 s.');
    // Verify showResults directly across exact boundary run times (7.599, 7.600, 7.601, 7.604,
    // Silver 8.304, Bronze 30.004, Slalom 14.804 and 40.004) against the live DOM.
    const checked = await b.value(async () => {
      const { PRECISION_180, SLALOM_SPRINT } = await import('/src/gymkhana.js');
      const { createGymkhanaUi } = await import('/src/gymkhana-ui.js');
      const cases = [
        [PRECISION_180, 7.599, '7.599 s', 'GGold medal', 'Gold held with this handling.'],
        [PRECISION_180, 7.600, '7.600 s', 'GGold medal', 'Gold held with this handling.'],
        [PRECISION_180, 7.601, '7.601 s', 'SSilver medal', 'Next: Gold, 7.600 s total or faster. Missed by 0.001 s.'],
        [PRECISION_180, 7.604, '7.604 s', 'SSilver medal', 'Next: Gold, 7.600 s total or faster. Missed by 0.004 s.'],
        [PRECISION_180, 8.304, '8.304 s', 'BBronze medal', 'Next: Silver, 8.300 s total or faster. Missed by 0.004 s.'],
        [PRECISION_180, 30.004, '30.004 s', 'No medal this run', 'Next: Bronze, 30.000 s total or faster. Missed by 0.004 s.'],
        [SLALOM_SPRINT, 14.804, '14.804 s', 'SSilver medal', 'Next: Gold, 14.800 s total or faster. Missed by 0.004 s.'],
        [SLALOM_SPRINT, 40.004, '40.004 s', 'No medal this run', 'Next: Bronze, 40.000 s total or faster. Missed by 0.004 s.'],
      ];
      const out = [];
      for (const [def, t, wantVal, wantMedal, wantNext] of cases) {
        const fakeRecords = { available: true, readOnly: false, newBest: false, previousBest: null, bestFor: () => t };
        // Keep the existing radio list untouched by cloning #challenges momentarily.
        const saved = document.getElementById('challenges').innerHTML;
        const ui = createGymkhanaUi({ records: fakeRecords, onChoose: () => {} });
        document.getElementById('challenges').innerHTML = saved;
        const result = def.layout === 'slalom'
          ? { value: t, time: t, penalty: 0, total: t, cones: 0, passed: 7, count: 7, weaveSpeed: 14, topSpeed: 20 }
          : { value: t, time: t, penalty: 0, total: t, cones: 0, entrySpeed: 20, technique: 'slide', peakSlip: 0.7, exitOffset: 0.1, exitSpeed: 18 };
        ui.showResults({ challengeDef: def, handling: { id: 'classic', name: 'Classic' }, challenge: { phase: 'complete', reason: '', result } });
        out.push({
          t,
          val: document.getElementById('gr-value').textContent,
          stats: document.getElementById('gr-stats').textContent,
          medal: document.getElementById('gr-medal').textContent,
          next: document.getElementById('gr-next').textContent,
          best: document.getElementById('gr-best').textContent,
          wantVal, wantMedal, wantNext,
        });
      }
      return out;
    });
    for (const c of checked) {
      assert.equal(c.val, c.wantVal, `results value for ${c.t}`);
      assert.ok(c.stats.includes(`Driving time${c.wantVal}`), `driving time matches for ${c.t}: ${c.stats}`);
      assert.equal(c.medal, c.wantMedal, `results medal for ${c.t}`);
      assert.equal(c.next, c.wantNext, `results next for ${c.t}`);
      assert.equal(c.best, `Personal best with Classic handling: ${c.wantVal}`, `results best for ${c.t}`);
    }
    await boundaryCtx.close();
    ok('timed-result precision: 7.599, 7.600, 7.601, 7.604 and Silver/Bronze/Slalom boundaries display consistently to three decimals');

    assert.deepEqual(errors, [], 'no page errors');
    ok('no page errors');
  } finally {
    await browser.close();
  }
}

try {
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) await check(name, engine);
  console.log('medals browser check passed');
} finally {
  server.close();
}
