// Analytics in real browsers, on the published address, with nothing able to reach the real service.
// Needs Playwright:
//   node test/analytics-browser.mjs [/path/to/playwright/index.mjs]
// The page is served from this folder at https://libertaine.github.io/mini-drifters/ by request
// interception, the tracker is a local stub (or blocked), and every other Umami address is aborted
// and recorded: a request to one fails the check. Frames are stepped by hand, on a clock the page's
// performance.now() follows, so play time is exact and takes seconds rather than minutes.
// Screenshots go to artifacts/.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');

const root = new URL('../', import.meta.url);
const artifact = (name) => fileURLToPath(new URL(`artifacts/analytics-${name}`, root));
await mkdir(new URL('artifacts/', root), { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.md': 'text/plain' };
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/' ? 'index.html' : path.slice(1);
  // The published files, plus the scripted drivers the page is driven with.
  if (!/^(index\.html|style\.css|src\/[\w-]+\.js|test\/support\/(gymkhana-)?drivers\.mjs|(?:audio-lab\/assets|radio)\/[\w/.-]+)$/.test(file) || file.includes('..')) {
    res.writeHead(404); res.end(); return;
  }
  try {
    const data = await readFile(new URL(file, root));
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/plain' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const LOCAL = `http://127.0.0.1:${server.address().port}/`;
const SITE = 'https://libertaine.github.io/mini-drifters/';
const TRACKER = 'https://cloud.umami.is/script.js';
const UMAMI = /^https:\/\/([\w-]+\.)*umami\.(is|dev)\//;
const DEG = Math.PI / 180;
const TIDY = { vCap: 24, triggerX: -8, release: 110 * DEG };
const FLAT_OUT = { triggerX: 8, release: 110 * DEG };

// The stub stands in for Umami's script: it records the calls and the attributes it was loaded with.
const stub = (mode) => `(() => {
  const script = document.currentScript;
  window.__tracker = { calls: [], identified: false,
    attributes: Object.fromEntries([...script.attributes].map((a) => [a.name, a.value])) };
  window.umami = {
    track: (name, data) => {
      window.__tracker.calls.push(data === undefined ? [name] : [name, data]);
      ${mode === 'throwing' ? "throw new Error('tracker trouble');" : ''}
    },
    identify: () => { window.__tracker.identified = true; },
  };
})();`;

// Runs before the game: sound off, hand-stepped frames on a hand-moved clock, and focus under the test's control.
function harness() {
  localStorage.setItem('mini-drifters-sound', 'off');
  let clock = performance.now();
  performance.now = () => clock;
  window.requestAnimationFrame = (callback) => { window.__nextFrame = callback; return 1; };
  window.__frames = (count = 2, dt = 1000 / 60) => {
    for (let i = 0; i < count; i += 1) { clock += dt; window.__nextFrame?.(clock); }
  };
  window.__focused = true;
  document.hasFocus = () => window.__focused;
  // Drives the live challenge with one of the scripted drivers until the session is over.
  window.__drive = async (driverName, params, maxSeconds = 70) => {
    const drivers = await import(new URL('test/support/gymkhana-drivers.mjs', document.baseURI).href);
    const m = window.__miniDrifters;
    const driver = drivers[driverName](params);
    for (let i = 0; i < maxSeconds * 60 && m.game.state !== 'finished'; i += 1) {
      Object.assign(m.input, driver(m.game));
      window.__frames(1);
    }
    for (const k of Object.keys(m.input)) m.input[k] = false;
    window.__frames(2);
    return m.game.challenge?.phase ?? null;
  };
}

async function check(name, engine) {
  const browser = await engine.launch({ headless: true });
  const ok = (message) => console.log(`${name}: ok: ${message}`);
  // Every Umami request any page tries to make, whatever the test: only the stub may be fetched.
  const service = [];

  /**
   * A fresh browser profile. `published` puts it on the published address; `tracker` is 'stub',
   * 'throwing' or 'blocked'; `visitor: false` leaves the automated browser marked as automated.
   */
  async function open({ tracker = 'stub', visitor = true, init = null, viewport = { width: 1024, height: 600 } } = {}) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const seen = { tracker: 0, errors: [] };
    page.on('pageerror', (e) => seen.errors.push(e.message));
    page.on('console', (m) => {
      // A blocked tracker is reported by the browser itself as a failed resource, and that is all.
      if (tracker === 'blocked' && m.location()?.url === TRACKER) return;
      if (m.type() === 'error') seen.errors.push(m.text());
    });
    context.on('request', (r) => {
      const url = r.url();
      if (url === TRACKER) seen.tracker += 1;
      else if (UMAMI.test(url)) service.push(url);
    });
    await context.route(UMAMI, (route) => (route.request().url() === TRACKER && tracker !== 'blocked'
      ? route.fulfill({ contentType: 'text/javascript', body: stub(tracker) })
      : route.abort()));
    await context.route('https://libertaine.github.io/**', async (route) => {
      const { pathname } = new URL(route.request().url());
      // /mini-drifters/preview/ is a whole copy of the game at another path on the same host, to show
      // that the path alone keeps a page uncounted.
      const local = pathname.startsWith('/mini-drifters/') ? pathname.slice('/mini-drifters/'.length).replace(/^preview\//, '') : '__missing__';
      const file = local === 'index.html' ? '' : local;
      try {
        await route.fulfill({ response: await page.request.get(`${LOCAL}${file}`) });
      } catch {
        await route.abort().catch(() => {});
      }
    });
    await context.addInitScript(harness);
    if (visitor) await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
    if (init) await context.addInitScript(init);
    const api = {
      page, seen,
      async go(url) {
        await page.goto(url);
        await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
        await api.frames(2);
      },
      frames: (n = 2) => page.evaluate((k) => window.__frames(k), n),
      calls: () => page.evaluate(() => window.__tracker?.calls ?? null),
      tags: () => page.locator(`script[src="${TRACKER}"]`).count(),
      state: () => page.evaluate(() => {
        const g = window.__miniDrifters.game;
        return { state: g.state, mode: g.mode, paused: g.paused, runId: g.runId, phase: g.challenge?.phase ?? null };
      }),
      // A key held for some frames, the way a player holds it.
      async hold(key, frames) {
        await page.keyboard.down(key);
        await api.frames(frames);
        await page.keyboard.up(key);
        await api.frames(2);
      },
      async press(key) {
        await page.keyboard.press(key);
        await api.frames(2);
      },
      drive: (driverName, params, maxSeconds) => page.evaluate(([d, p, s]) => window.__drive(d, p, s), [driverName, params, maxSeconds]),
      storage: () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)]))),
      close: () => context.close(),
    };
    return api;
  }

  // Uncounted: no tracker element, no umami object, no request, and the game works.
  async function assertUncounted(p, where) {
    assert.equal(await p.tags(), 0, `${where}: no tracker element`);
    assert.equal(await p.page.evaluate(() => typeof window.umami), 'undefined', where);
    assert.equal(p.seen.tracker, 0, `${where}: the tracker was never requested`);
  }

  async function startCircuit(p) {
    await p.page.locator('#tracks-open').click();
    await p.page.locator('#start').click();
    await p.frames(2);
    assert.equal((await p.state()).state, 'ready');
  }

  async function startPrecision(p) {
    await p.page.locator('#gymkhana').click();
    await p.frames(2);
    await p.page.locator('#gymkhana-start').click();
    await p.frames(2);
    const s = await p.state();
    assert.equal(s.mode, 'gymkhana');
    assert.equal(await p.page.evaluate(() => window.__miniDrifters.game.challengeDef.id), 'precision-180');
  }

  try {
    // --- The gate ------------------------------------------------------------------------------
    let p = await open();
    await p.go(SITE);
    assert.equal(await p.tags(), 1);
    assert.equal(p.seen.tracker, 1);
    assert.deepEqual(await p.page.evaluate(() => window.__tracker.attributes), {
      src: TRACKER, async: '', defer: '',
      'data-website-id': '6f121a0f-990e-4457-8269-6f4833c81820',
      'data-domains': 'libertaine.github.io',
      'data-exclude-search': 'true',
      'data-exclude-hash': 'true',
      'data-do-not-track': 'true',
    });
    await p.frames(120);
    assert.deepEqual(await p.calls(), [], 'the title sends no custom event: the pageview is Umami\'s own');
    assert.deepEqual(p.seen.errors, []);
    await p.close();
    ok('the published page loads one configured tracker, and the title sends nothing of its own');

    p = await open();
    await p.go(`${SITE}index.html`);
    assert.equal(p.seen.tracker, 1);
    await p.close();
    p = await open();
    await p.go(`${SITE}preview/`);
    await assertUncounted(p, 'another path on the host');
    await p.close();
    p = await open();
    await p.go(LOCAL);
    await assertUncounted(p, 'local play, even as a visitor');
    await p.close();
    ok('index.html is the same page; other paths and local play stay uncounted');

    for (const query of ['?analytics=off', '?analytics=OFF', '?debug', '?driver', '?replay=1']) {
      p = await open();
      await p.go(`${SITE}${query}`);
      await assertUncounted(p, query);
      await startCircuit(p);
      await p.hold('ArrowUp', 60);
      assert.equal((await p.state()).state, 'racing', `${query}: the game plays`);
      await assertUncounted(p, `${query} after driving`);
      assert.deepEqual(p.seen.errors, [], query);
      await p.close();
    }
    ok('?analytics=off in any case, ?debug, ?driver and ?replay load no tracker, and the game plays');

    p = await open({ visitor: false });
    await p.go(SITE);
    await assertUncounted(p, 'an automated browser');
    await p.close();
    p = await open({ init: () => Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' }) });
    await p.go(SITE);
    await assertUncounted(p, 'Do Not Track');
    await p.close();
    ok('an automated browser and Do Not Track load no tracker');

    // --- The events, from real keys and clicks ----------------------------------------------------
    p = await open();
    await p.go(SITE);
    await startCircuit(p);
    await p.frames(120);
    assert.deepEqual(await p.calls(), [], 'the grid is not a start');
    await p.press('KeyR');
    await p.frames(60);
    assert.deepEqual(await p.calls(), [], 'nor is restarting from it');
    await p.hold('ArrowUp', 30);
    const started = [['md_game_start'], ['md_run_start', { category: 'tracks' }]];
    assert.deepEqual(await p.calls(), started);
    await p.press('KeyP');
    assert.equal((await p.state()).paused, true);
    await p.frames(120);
    await p.press('KeyP');
    await p.hold('ArrowUp', 30);
    assert.deepEqual(await p.calls(), started, 'pausing and carrying on is the same run');
    // A driven retry is another run; the game has already started.
    await p.press('KeyR');
    await p.hold('ArrowUp', 30);
    const retried = [...started, ['md_run_start', { category: 'tracks' }]];
    assert.deepEqual(await p.calls(), retried);
    // Left for the title mid-run: nothing completes.
    await p.press('KeyP');
    await p.page.locator('#paused .return-title').click();
    await p.frames(2);
    assert.equal((await p.state()).state, 'menu');
    // The lesson and the practice pad are not normal play.
    await p.page.locator('#how-to-play').click();
    await p.page.locator('#help-try').click();
    await p.frames(2);
    assert.equal((await p.state()).mode, 'tutorial');
    await p.hold('ArrowUp', 300);
    await p.press('Escape');
    await p.page.locator('#tracks-open').click();
    await p.page.locator('#practice').click();
    await p.frames(2);
    assert.equal((await p.state()).mode, 'practice');
    await p.hold('ArrowUp', 300);
    await p.press('Escape');
    assert.deepEqual(await p.calls(), retried, 'no event for the lesson or the pad');
    // Gymkhana: a failed run, then a completed retry.
    await startPrecision(p);
    assert.equal(await p.drive('handbrake180', FLAT_OUT), 'failed');
    assert.equal(await p.page.locator('#gymkhana-results').isVisible(), true);
    await p.page.locator('#gymkhana-again').click();
    await p.frames(2);
    assert.equal(await p.drive('handbrake180', TIDY), 'complete');
    await p.frames(60);
    const runs = (await p.calls()).filter(([n]) => !n.startsWith('md_engaged'));
    assert.deepEqual(runs, [...retried, ['md_run_start', { category: 'gymkhana' }], ['md_run_start', { category: 'gymkhana' }],
      ['md_run_complete', { category: 'gymkhana' }]]);
    for (const [eventName, data] of await p.calls()) {
      assert.match(eventName, /^md_/);
      if (data !== undefined) assert.ok(['category', 'lap'].includes(Object.keys(data).join()), JSON.stringify(data));
    }
    assert.equal(await p.page.evaluate(() => window.__tracker.identified), false, 'never identified');
    assert.equal(await p.page.evaluate(() => document.cookie), '');
    assert.deepEqual(p.seen.errors, []);
    await p.page.screenshot({ path: artifact(`${name}-gymkhana-complete.png`) });
    await p.close();
    ok('starts count on the first press; the grid, restarts, pause, leaving, the lesson, the pad and a failed challenge send nothing more');

    // --- Engagement --------------------------------------------------------------------------------
    p = await open();
    await p.go(SITE);
    await startCircuit(p);
    await p.page.evaluate(() => { window.__focused = false; });
    await p.hold('ArrowUp', 40 * 60);
    const engaged = async () => (await p.calls()).filter(([n]) => n.startsWith('md_engaged'));
    assert.deepEqual(await engaged(), [], 'forty unfocused seconds count for nothing');
    await p.page.evaluate(() => { window.__focused = true; });
    await p.hold('ArrowUp', 25 * 60);
    assert.deepEqual(await engaged(), [], 'and are not caught up');
    await p.hold('ArrowUp', 6 * 60);
    assert.deepEqual(await engaged(), [['md_engaged_30s']]);
    // Sitting paused, or on the results or title, adds nothing.
    await p.press('KeyP');
    await p.frames(120 * 60);
    assert.deepEqual(await engaged(), [['md_engaged_30s']], 'two paused minutes');
    await p.press('KeyP');
    // A reload is a new page load: nothing is replayed, and nothing was kept.
    const before = await p.storage();
    await p.go(SITE);
    await p.frames(60);
    assert.deepEqual(await p.calls(), []);
    assert.deepEqual(await p.storage(), before, 'analytics stored nothing');
    assert.deepEqual(p.seen.errors, []);
    await p.close();
    ok('only focused driving time counts, nothing catches up, pause adds nothing, and a reload replays nothing');

    // --- The game never notices -------------------------------------------------------------------
    // The same driven challenge with the tracker stubbed, blocked, throwing, and turned off: the same
    // result, and byte for byte the same browser storage, records included.
    const results = {};
    for (const [label, tracker, url] of [['stubbed', 'stub', SITE], ['blocked', 'blocked', SITE], ['throwing', 'throwing', SITE],
      ['off', 'stub', `${SITE}?analytics=off`]]) {
      p = await open({ tracker });
      await p.go(url);
      await startPrecision(p);
      const phase = await p.drive('handbrake180', TIDY);
      const value = await p.page.evaluate(() => window.__miniDrifters.game.challenge.result.value);
      const storage = await p.storage();
      results[label] = { phase, value, storage };
      if (tracker === 'blocked') {
        assert.equal(p.seen.tracker, 1, 'one attempt, no retry');
        assert.equal(await p.page.evaluate(() => typeof window.umami), 'undefined');
      }
      assert.deepEqual(p.seen.errors, [], label);
      await p.close();
    }
    assert.equal(results.stubbed.phase, 'complete');
    for (const label of ['blocked', 'throwing', 'off']) assert.deepEqual(results[label], results.stubbed, label);
    const keys = Object.keys(results.stubbed.storage);
    assert.ok(keys.includes('mini-drifters-gymkhana-v1'), 'the run really was saved');
    assert.ok(keys.every((key) => key.startsWith('mini-drifters-')), keys.join());
    ok('stubbed, blocked, throwing or off: the same run, the same result and the same saved records');

    // --- The disclosure --------------------------------------------------------------------------
    for (const [width, height] of [[1920, 1080], [1366, 768], [1024, 600]]) {
      p = await open({ viewport: { width, height } });
      await p.go(SITE);
      const layout = await p.page.evaluate(() => {
        const box = (el) => el.getBoundingClientRect();
        const note = document.getElementById('analytics-note');
        const menu = document.getElementById('menu');
        const r = box(note);
        const others = ['#tracks-open', '#gymkhana', '#getaway', '#how-to-play', '.options-open', '#sound', '#controller-note']
          .map((s) => [s, box(document.querySelector(s))]);
        return { text: note.textContent, visible: note.checkVisibility(), r: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
          others: others.map(([s, b]) => [s, { left: b.left, right: b.right, top: b.top, bottom: b.bottom }]),
          scrolls: menu.scrollHeight > menu.clientHeight || document.documentElement.scrollHeight > innerHeight, width: innerWidth, height: innerHeight };
      });
      assert.ok(layout.visible, `${width}x${height}`);
      assert.match(layout.text, /cookie-free Umami analytics/);
      assert.match(layout.text, /\?analytics=off/);
      assert.match(layout.text, /No scores, inputs or saves are sent/);
      assert.equal(layout.scrolls, false, `${width}x${height}: the title scrolls`);
      assert.ok(layout.r.bottom <= layout.height && layout.r.right <= layout.width && layout.r.left >= 0, `${width}x${height}: ${JSON.stringify(layout.r)}`);
      const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      for (const [selector, other] of layout.others) assert.equal(overlaps(layout.r, other), false, `${width}x${height}: covers ${selector}`);
      await p.page.screenshot({ path: artifact(`${name}-title-${width}x${height}.png`) });
      await p.close();
    }
    ok('the title says what is counted and how to opt out, at every size, without crowding anything');

    assert.deepEqual(service, [], 'no request reached the analytics service');
    ok('no request reached Umami: the tracker was always the local stub or blocked');
  } finally {
    await browser.close();
  }
  return name;
}

try {
  const done = [await check('chromium', chromium), await check('firefox', firefox)];
  console.log(`Analytics checks passed in ${done.join(' and ')}.`);
} finally {
  server.close();
}
