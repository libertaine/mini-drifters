// Actual game loop, keyboard events and Gamepad adapter; only frame time, pad
// snapshots and storage failures are controlled. No simulation values are injected.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
const KEY = 'mini-drifters-records';
const reports = [];
await mkdir(new URL('artifacts/', root), { recursive: true });
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/mini-drifters/' ? 'index.html' : path.replace('/mini-drifters/', '');
  if (!/^(index\.html|style\.css|src\/[\w-]+\.js|test\/support\/drivers\.mjs|(?:audio-lab\/assets|radio)\/[\w/.-]+)$/.test(file) || file.includes('..')) {
    res.writeHead(404); res.end(); return;
  }
  try {
    const bytes = await readFile(new URL(file, root));
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' })[extname(file)] ?? 'text/plain' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/mini-drifters/`;

async function check(name, engine) {
  const browser = await engine.launch({ headless: true });
  let page;
  const errors = [];
  const steps = [];
  const ok = (message) => { steps.push(message); console.log(`${name}: ${message}`); };
  const frames = () => page.evaluate(() => window.__frames());
  const click = async (selector) => { await page.locator(selector).evaluate((el) => el.click()); await frames(); };
  const values = () => page.locator('.personal-bests dd').allTextContents();
  const saved = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
  const badges = async () => Promise.all(['new-score', 'new-lap', 'new-combo'].map((id) => page.locator(`#${id}`).isVisible()));
  const press = async (i) => {
    await page.evaluate((index) => { window.__pad.buttons[index] = { value: 1, pressed: true }; window.__frames(); }, i);
    await page.evaluate((index) => { window.__pad.buttons[index] = { value: 0, pressed: false }; window.__frames(); }, i);
  };
  const setup = async (denied = false) => {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const p = await context.newPage();
    p.on('pageerror', (error) => errors.push(error.message));
    await p.addInitScript(({ key, denied }) => {
      window.__recordWrites = 0;
      window.__failRecordsWrite = false;
      if (denied) Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Denied', 'SecurityError'); } });
      else {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k === key) {
            if (window.__failRecordsWrite) throw new DOMException('Full', 'QuotaExceededError');
            window.__recordWrites++;
          }
          return set.call(this, k, v);
        };
        localStorage.setItem('mini-drifters-sound', 'off');
      }
      window.__pad = { index: 0, id: 'Records mock', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })) };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.__pad] });
      window.requestAnimationFrame = (cb) => { window.__nextFrame = cb; return 1; };
      let now;
      window.__frames = (count = 2, dt = 1000 / 60) => {
        now ??= performance.now();
        for (let i = 0; i < count; i++) { now += dt; window.__nextFrame(now); }
      };
    }, { key: KEY, denied });
    await p.goto(base);
    await p.waitForFunction(() => window.__miniDrifters, null, { polling: 100 });
    return p;
  };
  // Scripted driver commands pass through keyboard DOM events or the pad adapter,
  // then the actual animation loop consumes fixed steps. Records see real lap events.
  const drive = (device = 'keyboard', boundary = 'finish') => page.evaluate(async ({ device, boundary }) => {
    const { driftDriver, lessonDriver } = await import('./test/support/drivers.mjs');
    const driver = boundary === 'lesson' ? lessonDriver() : driftDriver();
    const codes = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', handbrake: 'Space' };
    let held = {};
    const send = (keys) => {
      if (device === 'controller') {
        window.__pad.axes[0] = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        window.__pad.buttons[7].value = keys.up ? 1 : 0;
        window.__pad.buttons[6].value = keys.down ? 1 : 0;
        window.__pad.buttons[0].pressed = !!keys.handbrake;
      } else {
        for (const [key, code] of Object.entries(codes)) if (!!keys[key] !== !!held[key]) {
          window.dispatchEvent(new KeyboardEvent(keys[key] ? 'keydown' : 'keyup', { code, bubbles: true, cancelable: true }));
        }
        held = keys;
      }
    };
    const g = window.__miniDrifters.game;
    for (let i = 0; i < 6000; i++) {
      if (boundary === 'lesson' ? !window.__miniDrifters.tutorial() : boundary === 'lap' ? g.laps.completed > 0 : g.state === 'finished') break;
      const t = window.__miniDrifters.tutorial();
      const keys = boundary === 'lesson' ? driver(g, ['accelerate', 'steer', 'slide', 'countersteer', 'bank'][t.step]) : driver(g);
      send(keys);
      window.__frames(1, 1000 / 15);
    }
    send({}); window.__frames();
    return { state: g.state, completed: g.laps.completed, results: g.results, bestLap: g.laps.bestLap, score: g.scoring.score, combo: g.scoring.bestCombo };
  }, { device, boundary });
  const layout = async (label) => {
    for (const [width, height] of [[1024, 600], [1366, 768], [1920, 1080]]) {
      await page.setViewportSize({ width, height }); await frames();
      const issues = await page.locator('#menu').evaluate((menu) => [...menu.querySelectorAll('.title, .tagline, .track-select, .personal-bests h2, .personal-bests dt, .personal-bests dd, .records-note, .title-menu button, #controller-note')]
        .filter((el) => el.getClientRects().length).flatMap((el) => {
          const r = el.getBoundingClientRect();
          return r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth || el.scrollWidth > el.clientWidth + 1 ? [el.textContent] : [];
        }));
      assert.deepEqual(issues, [], `records and controls fit ${width}x${height} (${label})`);
      await page.screenshot({ path: new URL(`artifacts/records-${name}-${label}-${width}x${height}.png`, root).pathname.replace(/^\/(\w:)/, '$1') });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
  };
  try {
    page = await setup(); await frames();
    assert.deepEqual(await values(), ['--', '--', '--']);
    assert.equal(await page.evaluate(() => window.__recordWrites), 0);
    await layout('empty');
    await page.keyboard.press('Enter'); await frames();
    const first = await drive();
    assert.equal(first.completed, 3); assert.equal(first.state, 'finished');
    assert.ok(first.results.score > 0 && first.results.bestCombo > 0);
    const original = (await saved()).tracks.original;
    assert.deepEqual(original, { score: first.results.score, fastestLap: first.results.bestLap, bestCombo: first.results.bestCombo });
    assert.deepEqual(await badges(), [true, true, true]);
    assert.equal(await page.locator('#remark').textContent(), first.results.remark);
    await press(1);
    assert.ok(await page.locator('#menu').isVisible());
    await layout('saved');
    const shown = await values();
    await page.reload(); await page.waitForFunction(() => window.__miniDrifters, null, { polling: 100 }); await frames();
    assert.deepEqual(await values(), shown);
    assert.equal(await page.evaluate(() => window.__recordWrites), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('mini-drifters-sound')), 'off');
    ok('real keyboard three-lap finish saves settled records, NEW BEST and remark; reload restores them');

    await press(15);
    assert.match(await page.locator('#records-heading').textContent(), /Switchback/);
    assert.deepEqual(await values(), ['--', '--', '--']);
    await press(0); await frames();
    const second = await drive('controller');
    assert.equal(second.state, 'finished'); assert.equal(second.completed, 3);
    assert.ok(second.results.score > 0);
    assert.deepEqual(await badges(), [true, true, true]);
    const both = await saved();
    assert.deepEqual(both.tracks.original, original);
    assert.deepEqual(both.tracks.switchback, { score: second.results.score, fastestLap: second.results.bestLap, bestCombo: second.results.bestCombo });
    await press(1); const switchShown = await values();
    await press(14); assert.deepEqual(await values(), shown);
    await press(15); assert.deepEqual(await values(), switchShown);
    ok('D-pad switches records immediately; controller completes Switchback without overwriting Original');

    // Fixed seeded targets exercise the explicit no-improvement UI branch.
    await page.evaluate((key) => {
      const v = JSON.parse(localStorage.getItem(key));
      v.tracks.original = { score: 900000000, fastestLap: 0.001, bestCombo: 900000000 };
      localStorage.setItem(key, JSON.stringify(v));
    }, KEY);
    await page.reload(); await page.waitForFunction(() => window.__miniDrifters, null, { polling: 100 }); await frames();
    await page.keyboard.press('Enter'); await frames();
    assert.equal((await drive()).state, 'finished');
    assert.deepEqual(await badges(), [false, false, false]);
    assert.equal(await page.evaluate(() => window.__recordWrites), 0);
    await press(1);
    ok('a completed run below saved targets has no NEW BEST labels and makes no records writes');

    // Empty fresh profile: one actual valid lap must persist despite restart/abandon.
    await page.context().close(); page = await setup(); await frames();
    await page.keyboard.press('Enter'); await frames();
    const partial = await drive('keyboard', 'lap');
    assert.equal(partial.completed, 1); assert.ok(partial.score > 0 && partial.combo > 0);
    assert.deepEqual((await saved()).tracks.original, { score: null, fastestLap: partial.bestLap, bestCombo: null });
    await page.keyboard.press('KeyR'); await frames();
    await page.keyboard.press('KeyP'); await frames();
    await click('#paused .return-title');
    assert.deepEqual((await saved()).tracks.original, { score: null, fastestLap: partial.bestLap, bestCombo: null });
    const beforeLesson = await saved();
    await click('#how-to-play'); await click('#help-try');
    await page.keyboard.press('KeyR'); await frames();
    await drive('keyboard', 'lesson');
    assert.ok(await page.locator('#tutorial-done').isVisible());
    assert.match(await page.locator('#done-title').textContent(), /QUALIFIED/);
    assert.deepEqual(await saved(), beforeLesson);
    ok('a valid lap survives restart/abandon without score/combo; a real completed lesson and restart set no records');

    await page.context().close(); page = await setup(); await frames();
    await page.evaluate(() => { window.__failRecordsWrite = true; });
    await page.keyboard.press('Enter'); await frames();
    assert.equal((await drive()).state, 'finished');
    assert.equal(await saved(), null); assert.deepEqual(await badges(), [false, false, false]);
    assert.match(await page.locator('#results-records-note').textContent(), /cannot be saved/);
    await press(1); assert.deepEqual(await values(), ['--', '--', '--']);
    await layout('quota');
    await press(15); await press(0); await frames();
    assert.equal(await page.evaluate(() => window.__miniDrifters.game.state), 'ready');
    ok('quota failure keeps gameplay/menu navigation functional, explains failure and never claims unsaved bests');

    await page.context().close(); page = await setup(true); await frames();
    assert.match(await page.locator('#records-note').textContent(), /cannot be saved/);
    await layout('denied');
    await page.keyboard.press('Enter'); await frames();
    assert.equal((await drive()).state, 'finished');
    assert.deepEqual(await badges(), [false, false, false]);
    assert.deepEqual(errors, []);
    ok('denied localStorage still permits a full keyboard run with no page errors');
    reports.push({ name, version: browser.version(), passed: true, steps });
  } catch (error) {
    reports.push({ name, version: browser.version(), passed: false, error: error.stack, errors, steps });
    await page?.screenshot({ path: new URL(`artifacts/records-${name}-failure.png`, root).pathname.replace(/^\/(\w:)/, '$1') }).catch(() => {});
    console.error(`${name}: ${error.stack}`);
  } finally { await browser.close(); }
}
try {
  await check('chromium', chromium);
  await check('firefox', firefox);
  await writeFile(new URL('artifacts/records-browser-results.json', root), JSON.stringify(reports, null, 2) + '\n');
} finally { await new Promise((resolve) => server.close(resolve)); }
process.exitCode = reports.every((r) => r.passed) ? 0 : 1;
