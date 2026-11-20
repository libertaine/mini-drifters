import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import http from 'node:http';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
const shots = new URL('artifacts/v070-menus/', root);
await mkdir(shots, { recursive: true });
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!/^(?:index\.html|style\.css|src\/[\w-]+\.js|test\/support\/urban-drivers\.mjs)$/.test(file)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const bytes = await readFile(new URL(file, root));
    res.writeHead(200, { 'Content-Type': mime[extname(file)] }).end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port + '/';
const sizes = [[1024, 600], [1366, 768], [1920, 1080]];
const featureSaves = {
  'mini-drifters-records-v3': '{"version":3,"tracks":{"original":{"classic":{"fastestLap":48.067}}}}',
  'mini-drifters-gymkhana-v1': '{"version":1,"challenges":{"precision-180":{"classic":{"precision-180-1":{"best":7.5}}}}}',
  'mini-drifters-ghosts-v1': '{"version":1,"ghosts":{}}',
};

function installHarness(saves) {
  if (!sessionStorage.getItem('seeded')) {
    for (const [key, value] of Object.entries(saves)) localStorage.setItem(key, value);
    localStorage.setItem('mini-drifters-sound', 'off');
    sessionStorage.setItem('seeded', 'yes');
  }
  window.writes = [];
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (this === localStorage) window.writes.push(key);
    return set.call(this, key, value);
  };
  const buttons = Array.from({ length: 17 }, () => ({ value: 0, pressed: false }));
  const pad = { index: 0, id: 'Test pad', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons };
  Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
  window.requestAnimationFrame = (callback) => { window.nextFrame = callback; return 1; };
  let now;
  window.frames = (count = 2) => {
    now ??= performance.now();
    for (let i = 0; i < count; i++) { now += 1000 / 60; window.nextFrame(now); }
  };
  window.pressPad = (index) => {
    buttons[index] = { value: 1, pressed: true };
    window.frames();
    buttons[index] = { value: 0, pressed: false };
    window.frames();
  };
}

async function checkLayout(page, sheet, width, height) {
  const issues = await page.locator(sheet).evaluate((overlay, [width, height]) => {
    const rect = (el) => el.getBoundingClientRect();
    const intersects = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const sound = rect(document.getElementById('sound'));
    const text = [...overlay.querySelectorAll('h1, h2, p, li, dt, dd, button, label > span')]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).display !== 'none');
    const controls = [...overlay.querySelectorAll('button, label')]
      .filter((el) => el.getClientRects().length);
    const issues = [];
    for (const el of text) {
      const bounds = rect(el);
      if (bounds.left < -1 || bounds.top < -1 || bounds.right > width + 1 || bounds.bottom > height + 1 ||
          (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2)) issues.push('clipped: ' + el.textContent.trim());
    }
    for (const [index, el] of controls.entries()) {
      const r = rect(el);
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (!el.contains(hit) || intersects(r, sound) || controls.slice(index + 1).some((other) => intersects(r, rect(other)))) {
        issues.push('overlap: ' + el.textContent.trim());
      }
    }
    if (overlay.scrollHeight > overlay.clientHeight + 1) issues.push('overlay scrolls: ' + overlay.scrollHeight + '/' + overlay.clientHeight + ', sheet height ' + overlay.querySelector('.sheet')?.offsetHeight);
    return issues;
  }, [width, height]);
  assert.deepEqual(issues, [], sheet + ' at ' + width + '×' + height);
}

async function run(engine, name) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(installHarness, featureSaves);
    const frames = () => page.evaluate(() => window.frames());
    const key = async (code) => { await page.keyboard.press(code); await frames(); };
    const pad = (index) => page.evaluate((i) => window.pressPad(i), index);
    const show = (id) => page.locator(id).isVisible();
    const focus = () => page.evaluate(() => document.activeElement.id);
    const session = () => page.evaluate(() => {
      const { game } = window.__miniDrifters;
      return [game.state, game.mode, game.handling.id, game.challengeDef?.id ?? game.track.id, Boolean(game.ghost)];
    });
    const load = async (query = '') => {
      await page.goto(base + query);
      await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
      await frames();
    };
    const pauseToTitle = async () => { await key('KeyP'); await page.locator('#paused .return-title').click(); await frames(); };
    const categories = ['Tracks', 'Gymkhana', 'Getaway'];
    await load();
    assert.deepEqual(await page.locator('.title-menu button').allTextContents().then((names) => names.slice(0, 3)), categories);
    assert.equal(await page.locator('.tagline').textContent(), 'ONE OVERPOWERED CAR. ZERO GOOD IDEAS.');

    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      for (const fallback of [false, true]) {
        await page.evaluate((fallback) => {
          for (const font of ['--poster', '--body']) {
            if (fallback) document.documentElement.style.setProperty(font, 'Arial, sans-serif');
            else document.documentElement.style.removeProperty(font);
          }
          window.dispatchEvent(new Event('resize'));
        }, fallback);
        await frames();
        for (const [category, button, sheet] of [
          ['title', null, '#menu'], ['tracks', '#tracks-open', '#tracks-menu'],
          ['gymkhana', '#gymkhana', '#gymkhana-menu'], ['getaway', '#getaway', '#getaway-menu'],
        ]) {
          if (button) { await page.locator(button).focus(); await key('Enter'); }
          await checkLayout(page, sheet, width, height);
          if (!fallback) await page.screenshot({ path: new URL(name + '-' + category + '-' + width + 'x' + height + '.png', shots).pathname.replace(/^\/(\w:)/, '$1') });
          if (category === 'getaway') {
            assert.equal(await page.locator('#get-the-footage-description').textContent(), 'Hit every camera. Put on a show. Lose the cops.');
            await key('Enter');
            await checkLayout(page, '#gymkhana-menu', width, height);
            if (!fallback) await page.screenshot({ path: new URL(name + '-environments-' + width + 'x' + height + '.png', shots).pathname.replace(/^\/(\w:)/, '$1') });
            await key('Escape');
            assert.equal(await focus(), 'get-the-footage');
          }
          if (button) { await key('Escape'); assert.equal('#' + await focus(), button); }
        }
      }
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await load('?getaway&pursuit=trail&tier=r4&miss=strict&time=90');
    await key('KeyH');
    for (const [index, track] of ['original', 'switchback', 'dockyard'].entries()) {
      await page.locator('#tracks-open').focus();
      await key('Enter');
      if (index) await key('ArrowRight');
      await key('Enter');
      assert.deepEqual(await session(), ['ready', 'normal', 'revised', track, true]);
      await pauseToTitle();
    }
    await key('Enter');
    await key('ArrowDown');
    assert.equal(await focus(), 'practice');
    await key('Space');
    assert.deepEqual(await session(), ['ready', 'practice', 'revised', 'practice-pad', false]);
    await key('Escape');
    for (const [index, challenge] of ['precision-180', 'linked-drift', 'one-drift', 'slalom-sprint'].entries()) {
      await page.locator('#gymkhana').focus();
      await key('Enter');
      assert.equal(await page.locator('#challenges input').count(), 4);
      if (index) await key('ArrowRight');
      await key('Enter');
      assert.deepEqual(await session(), ['ready', 'gymkhana', 'revised', challenge, false]);
      await key('Escape');
    }
    assert.equal(await focus(), 'gymkhana');
    await pad(13);
    assert.equal(await focus(), 'getaway');
    await pad(0);
    assert.equal(await focus(), 'get-the-footage');
    await pad(0);
    assert.equal(await page.locator('#challenges input').count(), 2);
    await pad(15);
    await pad(0);
    assert.deepEqual(await session(), ['ready', 'gymkhana', 'revised', 'getaway-urban-industrial', false]);
    await pad(1);
    assert.ok(await show('#gymkhana-menu'));
    await pad(1);
    assert.equal(await focus(), 'get-the-footage');
    await pad(1);
    assert.equal(await focus(), 'getaway');

    await key('Enter');
    await key('Enter');
    await key('ArrowLeft');
    await key('Enter');
    assert.deepEqual(await session(), ['ready', 'gymkhana', 'revised', 'getaway-urban-downtown', false]);
    const finished = await page.evaluate(async () => {
      const { urbanGrip } = await import('/test/support/urban-drivers.mjs');
      const { game, input } = window.__miniDrifters;
      const driver = urbanGrip({ lateral: 9 });
      for (let i = 0; i < 120 * 60 && game.state !== 'finished'; i++) {
        Object.assign(input, driver(game));
        window.frames(1);
      }
      return [game.challenge.result?.ended, game.challengeDef.timeLimit, game.challengeDef.missPolicy, game.challengeDef.pursuit];
    });
    assert.deepEqual(finished, ['escaped', 120, 'recover', 'network']);
    assert.match(await page.locator('#gr-medal').textContent(), /medal/);
    await page.locator('#gymkhana-change').click();
    const getawayBest = await page.locator('#challenge-best').textContent();
    assert.notEqual(getawayBest, '--');
    assert.deepEqual(await page.evaluate((saves) => Object.fromEntries(Object.keys(saves).map((key) => [key, localStorage.getItem(key)])), featureSaves), featureSaves);
    assert.deepEqual(await page.evaluate((saves) => window.writes.filter((key) => key in saves), featureSaves), []);
    assert.deepEqual(await page.evaluate(() => window.writes.filter((key) => key === 'mini-drifters-getaway-v1')), ['mini-drifters-getaway-v1'], 'Getaway writes only its own key, once');
    await load();
    assert.equal(await page.evaluate(() => window.__miniDrifters.selectedHandling()), 'revised');
    await page.locator('#getaway').focus();
    await key('Enter');
    await key('Enter');
    assert.equal(await page.locator('#challenge-best').textContent(), getawayBest, 'the Getaway best survives the reload');
    assert.deepEqual(errors, []);
    console.log(name + ' ' + browser.version() + ': all gameplay choices, keyboard, controller, Back, viewport bounds and reload/storage isolation passed');
  } finally {
    await browser.close();
  }
}
try {
  await run(chromium, 'chromium');
  await run(firefox, 'firefox');
} finally {
  server.close();
}
