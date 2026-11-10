// Real DOM and existing animation loop; only Gamepad API snapshots and frame time
// are mocked. No physical hardware is required, including on Firefox CI.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/mini-drifters/' ? 'index.html' : path.replace('/mini-drifters/', '');
  if (!/^(index\.html|style\.css|src\/[\w-]+\.js|test\/support\/drivers\.mjs|(?:audio-lab\/assets|radio)\/[\w/.-]+)$/.test(file) || file.includes('..')) {
    res.writeHead(404); res.end(); return;
  }
  try {
    const data = await readFile(new URL(file, root));
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' })[extname(file)] ?? 'text/plain' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/mini-drifters/`;
const results = [];

async function check(name, engine) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const steps = [];
  const ok = (message) => { steps.push(message); console.log(`${name}: ${message}`); };
  try {
    await page.addInitScript(() => {
      window.__pads = [];
      window.__apiFails = false;
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => {
        if (window.__apiFails) throw new Error('Mock permissions denial');
        return window.__pads;
      } });
      window.requestAnimationFrame = (callback) => { window.__nextFrame = callback; return 1; };
      let now;
      window.__frames = (count = 2, dt = 1000 / 60) => {
        now ??= performance.now();
        for (let i = 0; i < count; i++) { now += dt; window.__nextFrame(now); }
      };
      window.__newPad = (index = 0) => ({ index, id: `Mock ${index}`, mapping: 'standard', connected: true,
        axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })) });
    });
    await page.goto(base);
    await page.waitForFunction(() => window.__miniDrifters, null, { polling: 100 });
    const frames = (count = 2) => page.evaluate((n) => window.__frames(n), count);
    const value = (fn) => page.evaluate(fn);
    const press = async (index) => {
      await page.evaluate((i) => { window.__pads[0].buttons[i] = { value: 1, pressed: true }; window.__frames(); }, index);
      await page.evaluate((i) => { window.__pads[0].buttons[i] = { value: 0, pressed: false }; window.__frames(); }, index);
    };
    const focus = () => value(() => document.activeElement.id || document.activeElement.className);
    const visible = (id) => page.locator(`#${id}`).isVisible();
    const layout = async (id) => {
      for (const [width, height] of [[1024, 600], [1366, 768], [1920, 1080]]) {
        await page.setViewportSize({ width, height });
        await frames();
        const issues = await page.locator(`#${id}`).evaluate((sheet) => {
          const parts = [...sheet.querySelectorAll('button, .lesson-text, .lesson-hint, .lesson-keys')];
          return parts.filter((el) => el.getClientRects().length).flatMap((el) => {
            const r = el.getBoundingClientRect();
            return r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight || el.scrollWidth > el.clientWidth + 1 ? [el.textContent] : [];
          });
        });
        assert.deepEqual(issues, [], `${id} fits ${width}x${height}`);
      }
      await page.setViewportSize({ width: 1366, height: 768 });
    };
    const untilFocus = async (id, direction = 13) => {
      for (let i = 0; i < 14 && await focus() !== id; i++) await press(direction);
      assert.equal(await focus(), id);
    };
    await frames();
    await value(() => { window.__pads = [window.__newPad()]; window.__frames(); });
    assert.match(await page.locator('#controller-note').textContent(), /ready/);
    await press(15);
    assert.equal(await value(() => window.__miniDrifters.selectedTrack()), 'switchback');
    await press(13);
    assert.equal(await focus(), 'how-to-play');
    assert.ok(await page.locator('#how-to-play').evaluate((el) => getComputedStyle(el).outlineStyle !== 'none'));
    await value(() => { window.__pads[0].buttons[0] = { value: 1, pressed: true }; window.__frames(30); });
    assert.ok(await visible('help'), 'held A opens Help once');
    await layout('help');
    await value(() => { window.__pads[0].buttons[0] = { value: 0, pressed: false }; window.__frames(); });
    await press(1);
    assert.ok(await visible('menu'));
    await press(13);
    await press(0);
    assert.ok(await visible('options'));
    const beforeStation = await value(() => window.__miniDrifters.audio().station);
    await press(15);
    assert.notEqual(await value(() => window.__miniDrifters.audio().station), beforeStation);
    await untilFocus('music-volume');
    const beforeVolume = await page.locator('#music-volume').inputValue();
    await press(14);
    assert.equal(Number(await page.locator('#music-volume').inputValue()), Number(beforeVolume) - 5);
    await untilFocus('effects-volume');
    await press(14);
    assert.equal(await page.locator('#effects-volume').inputValue(), '95');
    await press(1);
    await untilFocus('start');
    await press(0);
    assert.equal(await value(() => window.__miniDrifters.game.track.id), 'switchback');
    assert.equal(await value(() => window.__miniDrifters.game.state), 'ready');
    assert.match(await page.locator('#prompt').textContent(), /RT/);
    assert.equal(await value(() => window.__miniDrifters.game.car.handbrake), false);
    ok('track choice, visible focus, held-A isolation, Help, Options, radio and volume without keyboard');

    await value(() => {
      window.__pads[0].axes[0] = 0.575;
      window.__pads[0].buttons[7].value = 0.5;
      window.__frames(60);
    });
    assert.equal(await value(() => window.__miniDrifters.game.state), 'racing');
    assert.equal(await value(() => window.__miniDrifters.game.car.throttle), 0.5);
    assert.ok(Math.abs(await value(() => window.__miniDrifters.game.car.steer) - 0.5) < 1e-12);
    await press(2);
    assert.equal(await value(() => window.__miniDrifters.game.ghostVisible), false);
    const radio = await value(() => window.__miniDrifters.audio().station);
    await press(3);
    assert.notEqual(await value(() => window.__miniDrifters.audio().station), radio);
    await press(9);
    assert.ok(await visible('paused'));
    await layout('paused');
    const ticks = await value(() => window.__miniDrifters.game.ticks);
    await press(9); // RT and stick still held, so resuming is gated
    await frames(20);
    assert.equal(await value(() => window.__miniDrifters.game.ticks), ticks);
    await value(() => { window.__pads[0] = window.__newPad(); window.__frames(); });
    await press(9);
    assert.equal(await visible('paused'), false);
    assert.equal(await value(() => window.__miniDrifters.game.car.handbrake), false);
    ok('partial pedals/stick, ghost/radio actions, pause and neutral-before-resume');

    // Keyboard wins over an already held controller pedal. Release cannot uncover it.
    await value(() => { window.__pads[0].buttons[7].value = 1; window.__frames(5); });
    await page.keyboard.down('ArrowDown');
    await frames(15);
    assert.equal(await value(() => window.__miniDrifters.game.car.throttle), 0);
    await page.keyboard.up('ArrowDown');
    await frames(15);
    assert.equal(await value(() => window.__miniDrifters.game.car.throttle), 0);
    await page.keyboard.down('ArrowUp');
    await frames(20);
    await value(() => { window.__pads = []; window.__frames(20); });
    assert.equal(await value(() => window.__miniDrifters.game.paused), false);
    assert.equal(await value(() => window.__miniDrifters.input.up), true, 'unused pad loss preserves held keyboard');
    await page.keyboard.up('ArrowUp');
    await value(() => { window.__pads = [window.__newPad()]; window.__frames(); window.__pads[0].buttons[7].value = 1; window.__frames(10); });
    // Polling detects loss even when the browser omits its connection event.
    await value(() => { window.__pads = []; window.__frames(); });
    assert.ok(await visible('paused'));
    await value(() => { const p = window.__newPad(); p.buttons[7].value = 1; window.__pads = [p]; window.__frames(10); });
    assert.ok(await visible('paused'), 'reconnection does not resume');
    await value(() => { window.__pads[0] = window.__newPad(); window.__frames(); });
    await value(() => { window.__pads[0].buttons[7].value = 1; window.__frames(); });
    await untilFocus('restart'); await press(0);
    assert.equal(await value(() => window.__miniDrifters.game.state), 'ready');
    assert.equal(await value(() => window.__miniDrifters.game.car.throttle), 0);
    await frames(20);
    assert.equal(await value(() => window.__miniDrifters.game.state), 'ready', 'RT held through Restart cannot accelerate');
    assert.equal(await value(() => window.__miniDrifters.game.car.handbrake), false);
    await value(() => { window.__pads[0] = window.__newPad(); window.__frames(); });
    await press(9);
    await untilFocus('resume'); await press(0);
    await value(() => { window.__pads[0].buttons[7].value = 1; window.__frames(10); window.dispatchEvent(new Event('blur')); });
    assert.ok(await visible('paused'));
    await frames(10);
    await value(() => { window.dispatchEvent(new Event('focus')); window.__pads[0] = window.__newPad(); window.__frames(); });
    assert.ok(await visible('paused'));
    ok('keyboard arbitration, unused/active loss, reconnection, restart and focus-loss safety');

    // Exercise immediate disconnect events separately from polling and hidden-tab loss.
    await press(9);
    await value(() => { window.__pads[0].buttons[7].value = 1; window.__frames(10); window.__pads[0].buttons[7].value = 0; window.__frames(); });
    await value(() => {
      const e = new Event('gamepaddisconnected');
      Object.defineProperty(e, 'gamepad', { value: { index: 0 } });
      window.__pads = [];
      window.dispatchEvent(e);
    });
    assert.ok(await visible('paused'), 'disconnect while coasting pauses immediately');
    await value(() => { window.__pads = [window.__newPad()]; window.__frames(); });
    await press(9);
    await value(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.__frames();
    });
    assert.ok(await visible('paused'));
    await value(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); window.__frames(); });
    assert.ok(await visible('paused'));
    await value(() => {
      Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
      window.__pads[0].buttons[9] = { value: 1, pressed: true };
      window.__frames();
    });
    assert.ok(await visible('paused'), 'visible background window cannot resume from controller input');
    await value(() => {
      delete document.hasFocus;
      window.__pads[0] = window.__newPad();
      window.__frames();
    });
    ok('immediate disconnect event while coasting and hidden-tab pause never resume automatically');

    // Complete a real three-lap run through the adapter and the actual frame loop.
    await untilFocus('restart'); await press(0);
    await value(async () => {
      const { driftDriver } = await import('./test/support/drivers.mjs');
      const driver = driftDriver();
      const { game } = window.__miniDrifters;
      for (let i = 0; i < 5000 && game.state !== 'finished'; i++) {
        const keys = driver(game); const p = window.__pads[0];
        p.axes[0] = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        p.buttons[7].value = keys.up ? 1 : 0; p.buttons[6].value = keys.down ? 1 : 0;
        p.buttons[0].pressed = !!keys.handbrake;
        window.__frames(1, 1000 / 15);
      }
      window.__pads[0] = window.__newPad(); window.__frames();
    });
    assert.ok(await visible('results'));
    assert.ok(await value(() => window.__miniDrifters.game.results.score > 0));
    assert.ok(await value(() => window.__miniDrifters.game.ghost.replay !== null));
    await press(1);
    assert.ok(await visible('menu'));
    ok('complete scored three-lap run, compatible ghost and Results-to-title without keyboard');

    await untilFocus('how-to-play'); await press(0);
    await untilFocus('help-try'); await press(0);
    assert.match(await page.locator('#prompt').textContent(), /RT/);
    await layout('prompt');
    await value(async () => {
      const { lessonDriver } = await import('./test/support/drivers.mjs');
      const ids = ['accelerate', 'steer', 'slide', 'countersteer', 'bank'];
      const driver = lessonDriver(); window.__lessonSeen = [];
      for (let i = 0; i < 18000 && window.__miniDrifters.tutorial(); i++) {
        const t = window.__miniDrifters.tutorial(); const { game } = window.__miniDrifters;
        if (!window.__lessonSeen.includes(t.step)) window.__lessonSeen.push(t.step);
        const keys = driver(game, ids[t.step]); const p = window.__pads[0];
        p.axes[0] = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
        p.buttons[7].value = keys.up ? 1 : 0; p.buttons[6].value = keys.down ? 1 : 0;
        p.buttons[0].pressed = !!keys.handbrake;
        window.__frames(1);
      }
      window.__pads[0] = window.__newPad(); window.__frames();
    });
    assert.ok(await visible('tutorial-done'));
    assert.deepEqual(await value(() => window.__lessonSeen), [0, 1, 2, 3, 4]);
    assert.match(await page.locator('#done-title').textContent(), /QUALIFIED/);
    assert.match(await page.locator('#done-banked').textContent(), /[1-9]/);
    await new Promise((resolve) => setTimeout(resolve, 550));
    await press(1);
    assert.ok(await visible('menu'));
    ok('all five tutorial concepts completed with real scoring and no skipped steps');

    // Pause-menu tutorial actions: skip and restart remain available.
    await untilFocus('how-to-play'); await press(0); await untilFocus('help-try'); await press(0);
    await value(() => { window.__pads[0].buttons[7].value = 0.7; window.__frames(10); });
    assert.match(await page.locator('#prompt').textContent(), /RT/);
    await press(9);
    await value(() => { window.__pads[0] = window.__newPad(); window.__frames(); });
    await untilFocus('tutorial-skip'); await press(0);
    assert.equal(await value(() => window.__miniDrifters.tutorial().step), 1);
    await press(9);
    await untilFocus('restart'); await press(0);
    assert.equal(await value(() => window.__miniDrifters.tutorial().step), 1);
    await press(9);
    // Return to title via the actual pause menu action.
    for (let i = 0; i < 10; i++) {
      if (await page.locator('#paused .return-title').evaluate((el) => el === document.activeElement)) break;
      await press(13);
    }
    await press(0);
    assert.ok(await visible('menu'));
    await value(() => { window.__apiFails = true; window.__frames(); });
    assert.match(await page.locator('#controller-note').textContent(), /unavailable/);
    await page.keyboard.press('Enter'); await frames();
    assert.equal(await value(() => window.__miniDrifters.game.state), 'ready');
    assert.deepEqual(errors, []);
    ok('tutorial pause actions and graceful API failure retain keyboard access');
    results.push({ name, version: browser.version(), steps });
  } finally { await browser.close(); }
}
try {
  await check('chromium', chromium);
  await check('firefox', firefox);
  await mkdir(new URL('artifacts/', root), { recursive: true });
  await writeFile(new URL('artifacts/controller-browser-results.json', root), JSON.stringify(results, null, 2) + '\n');
} finally { await new Promise((resolve) => server.close(resolve)); }
