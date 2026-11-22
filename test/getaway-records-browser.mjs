// Getaway personal bests on the real page, in Chromium and Firefox, in fresh browser profiles:
// a new player's unrecorded state; a first escape saved with its medal and NEW BEST; an improvement;
// a lower escape that keeps the best and claims nothing; a bust that saves nothing; the best and
// medal back after a reload and after a browser restart (the profile's saved storage in a new
// context); separate bests per environment and handling mode; corrupt, later-version, denied and
// full storage; the other saved keys untouched; and the selection and results sheets fitting at
// 1024x600, 1366x768 and 1920x1080. Only the frame clock is mocked.
//   node test/getaway-records-browser.mjs /path/to/playwright/index.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
await mkdir(new URL('artifacts/getaway-records/', root), { recursive: true });
const shot = (name) => fileURLToPath(new URL(`artifacts/getaway-records/${name}.png`, root));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname.replace(/^\/$/, '/index.html').slice(1);
  if (!/^(index\.html|style\.css|src\/[\w-]+\.js|test\/support\/urban-drivers\.mjs)$/.test(file)) { res.writeHead(404); res.end(); return; }
  try { const data = await readFile(new URL(file, root)); res.writeHead(200, { 'Content-Type': TYPES[extname(file)] }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const KEY = 'mini-drifters-getaway-v1';
const SIZES = [[1024, 600], [1366, 768], [1920, 1080]];
// What a returning player already has saved: none of it may change.
const OTHERS = {
  'mini-drifters-records-v3': '{"version":3,"tracks":{"original":{"classic":{"fastestLap":48.067}}}}',
  'mini-drifters-gymkhana-v1': '{"version":1,"challenges":{"linked-drift":{"classic":{"linked-drift-1+scoring-2":{"best":700}}}}}',
  'mini-drifters-ghosts-v1': '{"version":1,"ghosts":{}}',
  'mini-drifters-ghost-mode': 'reference',
};

// Runs before the page's code in every document of a context. `seed` is written once per context
// (sessionStorage remembers), so a reload sees what the game itself saved.
function harness([seed, storageMode]) {
  if (seed && !sessionStorage.getItem('seeded')) {
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    sessionStorage.setItem('seeded', 'yes');
  }
  if (storageMode === 'denied') {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Denied', 'SecurityError'); } });
  }
  window.__writes = [];
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (storageMode === 'full' && k === 'mini-drifters-getaway-v1') throw new DOMException('full', 'QuotaExceededError');
    window.__writes.push(k);
    return set.call(this, k, v);
  };
  try { set.call(localStorage, 'mini-drifters-sound', 'off'); } catch { /* denied */ }
  window.requestAnimationFrame = (callback) => { window.__nextFrame = callback; return 1; };
  let now;
  window.__frames = (count = 2, dt = 1000 / 60) => {
    now ??= performance.now();
    for (let i = 0; i < count; i++) { now += dt; window.__nextFrame(now); }
  };
  window.__drive = async (kind, maxSeconds = 130) => {
    const D = await import('/test/support/urban-drivers.mjs');
    const m = window.__miniDrifters;
    const driver = kind === 'stall' ? D.urbanStall(D.urbanGrip({ lateral: 9 }), { after: 120, seconds: 9 })
      : kind === 'drift' ? D.urbanBank(D.urbanDrift({}), D.urbanGrip({ lateral: 10, cap: 30 }), { bankAt: 250 })
        : D.urbanGrip({ lateral: 10 });
    for (let i = 0; i < maxSeconds * 60 && m.game.state !== 'finished'; i++) {
      Object.assign(m.input, driver(m.game));
      window.__frames(1);
    }
    for (const k of Object.keys(m.input)) m.input[k] = false;
    window.__frames(2);
    const c = m.game.challenge;
    return { phase: c.phase, ended: c.result?.ended, value: c.result?.value ?? null, footage: c.result?.footage };
  };
}

async function check(name, engine) {
  const browser = await engine.launch({ headless: true });
  const ok = (message) => console.log(`${name}: ${message}`);
  const errors = [];
  async function open(context) {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    const value = (fn, arg) => page.evaluate(fn, arg);
    const frames = (n = 2) => value((k) => window.__frames(k), n);
    const p = {
      page, value, frames,
      key: async (code) => { await page.keyboard.press(code); await frames(2); },
      text: (sel) => page.locator(sel).textContent(),
      shown: (sel) => page.locator(sel).isVisible(),
      raw: () => value((k) => { try { return localStorage.getItem(k); } catch { return 'denied'; } }, KEY),
      writes: () => value(() => window.__writes),
      load: async () => { await page.goto(base); await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 }); await frames(2); },
      // Opens Getaway -> Get the Footage on the given environment, in the current handling mode.
      sheet: async (environment = 'downtown') => {
        await page.click('#getaway');
        await page.click('#get-the-footage');
        await frames(2);
        await page.locator(`#challenges input[value="getaway-urban-${environment}"]`).evaluate((el) => el.click());
        await frames(2);
      },
      start: async () => { await page.click('#gymkhana-start'); await frames(2); },
      drive: (kind) => value((k) => window.__drive(k), kind),
      menu: async () => ({
        label: await p.text('#challenge-best-label'), best: await p.text('#challenge-best'), medal: await p.text('#challenge-medal'),
        next: await p.text('#challenge-next'), note: await p.text('#gymkhana-records-note'),
        slots: await value(() => [...document.querySelectorAll('#challenges .medal-slot')].map((s) => s.textContent)),
        held: await value(() => [...document.querySelectorAll('#challenge-targets li[data-held]')].map((li) => li.dataset.medal)),
      }),
      results: async () => ({
        title: await p.text('#gr-title'), value: await p.text('#gr-value'), newBest: await p.shown('#gr-new'),
        medal: (await p.shown('#gr-medal')) ? await p.text('#gr-medal') : null, best: await p.text('#gr-best'), note: await p.text('#gr-records-note'),
        rows: await value(() => Object.fromEntries([...document.querySelectorAll('#gr-stats > div:not(.big)')].map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]))),
      }),
      // Every listed element is shown inside the viewport and inside its sheet, no two overlap, and
      // the sheet has no hidden overflow.
      fits: async (sheet, sels, label) => {
        for (const [w, h] of SIZES) {
          await page.setViewportSize({ width: w, height: h });
          await page.waitForFunction(([ww, hh]) => innerWidth === ww && innerHeight === hh, [w, h]);
          await page.waitForTimeout(80);
          await frames(2);
          const report = await value(([s, list]) => {
            const box = document.querySelector(s).getBoundingClientRect();
            const sheetEl = document.querySelector(s);
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
          await page.screenshot({ path: shot(`${name}-${label}-${w}x${h}`) });
        }
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.waitForTimeout(80);
        await frames(2);
      },
    };
    return p;
  }
  const MENU = ['#challenges', '#challenge-brief', '#challenge-points', '#challenge-best-label', '#challenge-best', '#challenge-medal', '#challenge-targets', '#challenge-next', '#gymkhana-handling', '#gymkhana-records-note', '#gymkhana-start', '#gymkhana-back'];
  const RESULTS = ['#gr-eyebrow', '#gr-title', '#gr-reason', '#gr-stats', '#gr-medal', '#gr-next', '#gr-best', '#gr-records-note', '#gymkhana-again', '#gymkhana-change'];

  try {
    // --- 1. A new player: no record, not a zero --------------------------------------------------------
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addInitScript(harness, [OTHERS, 'ok']);
    const p = await open(context);
    await p.load();
    await p.sheet('downtown');
    let menu = await p.menu();
    assert.equal(menu.label, 'Personal best · Showmanship');
    assert.equal(menu.best, '--');
    assert.equal(menu.medal, '');
    assert.equal(menu.next, 'No medal yet. Bronze: escape with every camera\'s footage.');
    assert.equal(menu.note, '');
    assert.deepEqual(menu.slots, ['', '']);
    assert.equal(await p.raw(), null);
    await p.fits('#gymkhana-menu .sheet', MENU, 'sheet-new');
    ok('a new player sees no record (--), the Bronze target, and no warning; the sheet fits at three sizes');

    // --- 2. First escape: saved, NEW BEST, medal ---------------------------------------------------------
    await p.start();
    const first = await p.drive('grip');
    assert.equal(first.ended, 'escaped', JSON.stringify(first));
    assert.equal(first.footage, 4);
    let r = await p.results();
    assert.equal(r.title, 'Getaway complete');
    assert.equal(r.value, first.value.toLocaleString('en-US'));
    assert.equal(r.newBest, true);
    assert.match(r.medal, /^[BSG](Bronze|Silver|Gold) medal · NEW MEDAL$/);
    assert.equal(r.best, `Personal best with Classic handling: ${first.value.toLocaleString('en-US')}`);
    assert.equal(r.note, '');
    assert.equal(Number(r.rows['Total Showmanship'].replace(/,/g, '')), first.value);
    assert.equal(Number(r.rows['Banked drift'].replace(/,/g, '')) + Number(r.rows['Destruction bonus'].replace(/[+,]/g, '')), first.value);
    const saved = JSON.parse(await p.raw());
    assert.equal(saved.version, 1);
    const rules = Object.keys(saved.missions['get-the-footage'].downtown.classic);
    assert.equal(rules.length, 1);
    assert.match(rules[0], /^getaway-r4c-downtown-.*\+scoring-2$/);
    assert.deepEqual(saved.missions['get-the-footage'].downtown.classic[rules[0]], { best: first.value });
    await p.fits('#gymkhana-results .sheet', RESULTS, 'results-new-best');
    ok(`a first escape (${first.value}) is saved under get-the-footage/downtown/classic, shown as NEW BEST with its medal; the results fit`);

    // --- 3. An improvement --------------------------------------------------------------------------------
    await p.key('KeyR');
    const better = await p.drive('drift');
    assert.equal(better.ended, 'escaped', JSON.stringify(better));
    assert.ok(better.value > first.value, `the drift run scores more (${better.value} > ${first.value})`);
    r = await p.results();
    assert.equal(r.newBest, true);
    assert.equal(r.best, `Personal best with Classic handling: ${better.value.toLocaleString('en-US')}`);
    assert.equal(JSON.parse(await p.raw()).missions['get-the-footage'].downtown.classic[rules[0]].best, better.value);
    const betterMedal = r.medal.replace(/ medal · NEW MEDAL$/, '').slice(1);
    assert.match(betterMedal, /^(Bronze|Silver|Gold)$/);
    ok(`an improvement (${better.value}) replaces the best at once: ${r.medal}`);

    // --- 4. A lower escape: its own score and medal, no NEW BEST, nothing written -------------------------
    const writesBefore = (await p.writes()).filter((k) => k === KEY).length;
    await p.key('KeyR');
    const lower = await p.drive('grip');
    assert.equal(lower.value, first.value, 'the same drive, the same score');
    r = await p.results();
    assert.equal(r.value, first.value.toLocaleString('en-US'));
    assert.equal(r.newBest, false);
    assert.match(r.medal, /^[BSG](Bronze|Silver|Gold) medal$/, 'no NEW MEDAL and nothing called not saved');
    assert.equal(r.best, `Personal best with Classic handling: ${better.value.toLocaleString('en-US')}`);
    assert.equal((await p.writes()).filter((k) => k === KEY).length, writesBefore);
    await p.fits('#gymkhana-results .sheet', RESULTS, 'results-lower');
    ok('a lower escape shows its own score and medal, keeps the best, claims nothing and writes nothing');

    // --- 5. A bust: no medal, no record ---------------------------------------------------------------------
    await p.key('KeyR');
    const bust = await p.drive('stall');
    assert.equal(bust.ended, 'busted');
    r = await p.results();
    assert.equal(r.title, 'Busted');
    assert.equal(r.value, '--');
    assert.equal(r.newBest, false);
    assert.equal(r.medal, null);
    assert.equal(r.best, `Personal best with Classic handling: ${better.value.toLocaleString('en-US')}`);
    assert.equal((await p.writes()).filter((k) => k === KEY).length, writesBefore);
    await p.fits('#gymkhana-results .sheet', RESULTS, 'results-busted');
    ok('a bust shows no medal and no new record, and saves nothing');

    // --- 6. Reload: the best and medal are back, on the sheet and in the HUD ---------------------------------
    await p.load();
    await p.sheet('downtown');
    menu = await p.menu();
    assert.equal(menu.best, better.value.toLocaleString('en-US'));
    assert.equal(menu.medal, `${betterMedal[0]}${betterMedal}`, 'badge initial and name');
    assert.equal(menu.slots[0], betterMedal[0], 'the Downtown button carries the medal');
    assert.equal(menu.slots[1], '', 'Industrial has none');
    assert.ok(menu.held.length >= 1);
    await p.fits('#gymkhana-menu .sheet', MENU, 'sheet-saved');
    await p.start();
    assert.equal(await p.text('#gym-medal'), `Best: ${better.value.toLocaleString('en-US')} · ${betterMedal}`);
    await p.key('Escape');
    assert.equal(await p.shown('#gymkhana-menu'), true, 'Escape returns to the environments');
    ok(`after a reload the sheet, the environment button and the HUD show ${better.value} and ${betterMedal}`);

    // --- 7. Separate bests: Industrial and Power have none yet ------------------------------------------------
    const choose = async (environment) => {
      await p.page.locator(`#challenges input[value="getaway-urban-${environment}"]`).evaluate((el) => el.click());
      await p.frames(2);
    };
    await choose('industrial');
    assert.equal((await p.menu()).best, '--');
    await choose('downtown');
    await p.key('KeyH');
    assert.equal(await p.value(() => window.__miniDrifters.selectedHandling()), 'revised');
    assert.equal((await p.menu()).best, '--', 'Power keeps its own best');
    await p.key('KeyH');
    assert.equal(await p.value(() => window.__miniDrifters.selectedHandling()), 'classic');
    assert.equal((await p.menu()).best, better.value.toLocaleString('en-US'));
    ok('Industrial and Power have their own (empty) bests; Classic Downtown keeps its own');

    // --- 8. A browser restart: the saved profile in a new context ---------------------------------------------
    const profile = await context.storageState();
    await context.close();
    const restarted = await browser.newContext({ viewport: { width: 1366, height: 768 }, storageState: profile });
    await restarted.addInitScript(harness, [null, 'ok']);
    const q = await open(restarted);
    await q.load();
    await q.sheet('downtown');
    assert.equal((await q.menu()).best, better.value.toLocaleString('en-US'));
    for (const [k, v] of Object.entries(OTHERS)) assert.equal(await q.value((key) => localStorage.getItem(key), k), v, `${k} untouched`);
    const keys = await q.value(() => Object.keys(localStorage).sort());
    assert.deepEqual(keys, [...Object.keys(OTHERS), KEY, 'mini-drifters-handling', 'mini-drifters-sound'].sort(), 'no unexpected key');
    await restarted.close();
    ok('a browser restart (saved profile, new context) keeps the best; circuit, Gymkhana and ghost keys are byte for byte unchanged');

    // --- 9. Damaged and refused storage ---------------------------------------------------------------------
    for (const [label, seed, mode, expectNote, expectSaved] of [
      ['corrupt', { [KEY]: '{oops' }, 'ok', '', true],
      ['later version', { [KEY]: '{"version":2,"missions":{}}' }, 'ok', 'Getaway records were saved by a newer version of Mini Drifters. They are kept, but cannot be updated here.', false],
      ['denied', null, 'denied', 'Record storage unavailable. New improvements cannot be saved.', false],
      ['full', null, 'full', 'Record storage unavailable. New improvements cannot be saved.', false],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
      await ctx.addInitScript(harness, [seed, mode]);
      const d = await open(ctx);
      await d.load();
      await d.sheet('downtown');
      assert.equal((await d.menu()).best, '--', label);
      if (mode !== 'full') assert.equal((await d.menu()).note, expectNote, label);
      await d.start();
      const escape = await d.drive('grip');
      assert.equal(escape.ended, 'escaped', label);
      const res = await d.results();
      assert.equal(res.value, escape.value.toLocaleString('en-US'), `${label}: the run is scored as ever`);
      assert.equal(res.newBest, expectSaved, label);
      if (expectSaved) {
        assert.equal(JSON.parse(await d.raw()).missions['get-the-footage'].downtown.classic[rules[0]].best, escape.value, `${label}: replaced by the escape`);
      } else {
        assert.match(res.medal, / medal · not saved$/, `${label}: the medal is shown, never as saved`);
        assert.equal(res.note, expectNote, label);
        if (mode === 'ok') assert.equal(await d.raw(), seed[KEY], `${label}: left alone`);
        await d.fits('#gymkhana-results .sheet', RESULTS, `results-${label.replace(' ', '-')}`);
      }
      await ctx.close();
    }
    ok('corrupt data is replaced by the next escape; a later version is never written; denied and full storage play on and say so');

    assert.deepEqual(errors, []);
    ok('no page errors');
  } finally {
    await browser.close();
  }
}

try {
  await check('chromium', chromium);
  await check('firefox', firefox);
  console.log('getaway-records-browser: all checks passed');
} finally {
  server.close();
}
