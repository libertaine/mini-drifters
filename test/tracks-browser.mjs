// Choosing a circuit, and driving Switchback, in real browsers: real keys, real clicks and
// real frames, served the same way as on GitHub Pages. Needs Playwright:
//   node test/tracks-browser.mjs [/path/to/playwright/index.mjs]
// Screenshots of Switchback at every supported size go to artifacts/.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RADIO_FILES } from '../src/radio-stations.js';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');

const root = new URL('../', import.meta.url);
const artifact = (name) => fileURLToPath(new URL(`artifacts/tracks-${name}`, root));
await mkdir(new URL('artifacts/', root), { recursive: true });

const siteFiles = ['index.html', 'style.css', 'audio-lab/assets/tire-foley.mp3', 'audio-lab/assets/ATTRIBUTION.md',
  ...['idle', 'mid', 'load', 'high'].map((key) => `audio-lab/assets/coyote-local/${key}.wav`), ...RADIO_FILES,
  ...(await readdir(new URL('src/', root))).map((name) => `src/${name}`)];
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.md': 'text/plain; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/mini-drifters/' ? 'index.html' : path.replace('/mini-drifters/', '');
  if (!siteFiles.includes(file)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': types[extname(file)] });
  res.end(await readFile(new URL(file, root)));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}/mini-drifters/`;
const ORIGIN = new URL(BASE).origin;

const SIZES = [[1920, 1080], [1366, 768], [1024, 600]];
const NO_KEYS = { up: false, down: false, left: false, right: false, handbrake: false };
const KEY_NAMES = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', handbrake: 'Space' };
const LAP_SECONDS = 120;
const GHOST_BODY = [70, 214, 255];

const visible = (page, id) => page.locator(`#${id}`).isVisible();
const focused = (page) => page.evaluate(() => document.activeElement.id || document.activeElement.value || document.activeElement.className || document.activeElement.tagName);
const game = (page) => page.evaluate(() => {
  const m = window.__miniDrifters;
  const g = m.game;
  const start = g.track.start;
  return {
    state: g.state,
    paused: g.paused,
    ticks: g.ticks,
    track: g.track.id,
    drawn: m.drawnTrack(),
    selected: m.selectedTrack(),
    atStart: Math.hypot(g.car.x - start.x, g.car.y - start.y) < 1e-6 && g.car.heading === start.heading,
    completed: g.laps.completed,
    voided: g.laps.voided,
    bestLap: g.laps.bestLap,
    score: g.scoring.score,
    combo: !!g.scoring.combo,
    ghost: g.ghost ? { replay: !!g.ghost.replay } : null,
    tutorial: !!m.tutorial(),
    input: { ...m.input },
  };
});
const checked = (page) => page.evaluate(() => [...document.querySelectorAll('#tracks input')].map((input) => `${input.value}${input.checked ? '*' : ''}`).join(' '));
// Lets the loop draw at least one frame, so the renderer has caught up with the session.
const frames = (page, count = 2) => page.evaluate((n) => new Promise((resolve) => {
  const next = (left) => (left ? requestAnimationFrame(() => next(left - 1)) : resolve());
  next(n);
}), count);
// The game loop shows a screen only when a frame sees the state change, so a run driven to the
// finish in one go needs a frame to have seen it on the grid first.
const frameShowsGrid = async (page) => {
  await page.waitForFunction(() => window.__miniDrifters.game.state === 'ready');
  await page.waitForSelector('#prompt:not([hidden])');
  await frames(page);
};
const finishScripted = (page) => page.evaluate(async () => {
  const { driftDriver } = await import(new URL('test/support/drivers.mjs', document.baseURI).href);
  const { tick } = await import(new URL('src/game.js', document.baseURI).href);
  const { game: g } = window.__miniDrifters;
  const driver = driftDriver();
  while (g.state !== 'finished' && g.ticks < 120 * 500) tick(g, driver(g));
  return { completed: g.laps.completed, voided: g.laps.voided };
});

// A sample of the canvas in one part of the window, to tell two pictures apart.
const stamp = (page, [x0, y0, x1, y1]) => page.evaluate(([a, b, c, d]) => {
  const canvas = document.getElementById('view');
  const s = canvas.width / innerWidth;
  const data = canvas.getContext('2d').getImageData(Math.round(a * canvas.width), Math.round(b * canvas.height), Math.round((c - a) * canvas.width), Math.round((d - b) * canvas.height)).data;
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 1) hash = Math.imul(hash ^ data[i], 0x01000193);
  return `${(hash >>> 0).toString(16)}:${s}`;
}, [x0, y0, x1, y1]);
const POSTER = [0.5, 0, 1, 1];
const MINIMAP = [0.75, 0.6, 1, 1];
const countPixels = (page, [r, g, b]) => page.evaluate(({ r, g, b }) => {
  const canvas = document.getElementById('view');
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  let hits = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (Math.abs(data[i] - r) < 24 && Math.abs(data[i + 1] - g) < 24 && Math.abs(data[i + 2] - b) < 24) hits += 1;
  }
  return hits;
}, { r, g, b });

async function check(name, engine) {
  console.log(`Checking ${name}...`);
  const steps = [];
  const step = (label) => { steps.push(label); console.log(`  ok: ${label}`); };
  const browser = await engine.launch({ headless: true });
  const errors = [];
  const external = [];
  const open = async (options = {}) => {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, ...options });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', (r) => { if (new URL(r.url()).origin !== ORIGIN) external.push(r.url()); });
    // Changing station quickly cancels the last one's download, which isn't a failure.
    page.on('requestfailed', (r) => { if (!/abort/i.test(r.failure()?.errorText ?? '')) errors.push(`failed: ${r.url()} ${r.failure()?.errorText}`); });
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()}: ${r.url()}`); });
    await page.route('**/test/support/drivers.mjs', async (route) => route.fulfill({
      contentType: 'text/javascript',
      body: await readFile(new URL('test/support/drivers.mjs', root)),
    }));
    await page.goto(BASE);
    await page.waitForFunction(() => window.__miniDrifters);
    await frames(page, 3);
    return page;
  };

  // Drives with real key presses, deciding from the car's live state, until `until` is true.
  const playWithKeys = async (page, driverName, { until, onSample, seconds = LAP_SECONDS }) => {
    await page.evaluate(async (which) => {
      const drivers = await import(new URL('test/support/drivers.mjs', document.baseURI).href);
      const driver = drivers[which]();
      window.__decide = () => {
        const m = window.__miniDrifters;
        const g = m.game;
        return {
          keys: driver(g),
          state: g.state,
          s: g.trackS,
          track: g.track.id,
          drawn: m.drawnTrack(),
          completed: g.laps.completed,
          voided: g.laps.voided,
          slip: g.scoring.drifting ? Math.abs(g.car.slipAngle) * 180 / Math.PI : 0,
          speed: g.car.speed,
          surface: g.car.surface,
          score: g.scoring.score,
          combo: g.scoring.combo ? g.scoring.combo.points : 0,
        };
      };
    }, driverName);
    const held = new Set();
    const deadline = Date.now() + seconds * 1000;
    const seen = { maxSlip: 0, samples: 0, mismatched: 0, grass: 0 };
    let now;
    for (;;) {
      assert.ok(Date.now() < deadline, `driving finished within ${seconds} s`);
      now = await page.evaluate(() => window.__decide());
      seen.samples += 1;
      if (now.track !== now.drawn) seen.mismatched += 1;
      if (now.surface === 'grass') seen.grass += 1;
      seen.maxSlip = Math.max(seen.maxSlip, now.slip);
      if (onSample) await onSample(now);
      if (until(now)) break;
      for (const key of Object.keys(KEY_NAMES)) {
        if (now.keys[key] && !held.has(key)) {
          held.add(key);
          await page.keyboard.down(KEY_NAMES[key]);
        } else if (!now.keys[key] && held.has(key)) {
          held.delete(key);
          await page.keyboard.up(KEY_NAMES[key]);
        }
      }
      await page.waitForTimeout(12);
    }
    for (const key of held) await page.keyboard.up(KEY_NAMES[key]);
    return { ...seen, last: now };
  };

  let page;
  try {
    // --- The selector on a fresh visit ---------------------------------------------------
    // Reduced motion holds the poster still, so its pixels can be compared exactly.
    page = await open({ reducedMotion: 'reduce' });
    assert.deepEqual(await page.locator('#tracks label').allInnerTexts().then((t) => t.map((s) => s.trim().toUpperCase())), ['ORIGINAL', 'SWITCHBACK']);
    assert.equal(await checked(page), 'original* switchback');
    let g = await game(page);
    assert.equal(g.selected, 'original');
    assert.equal(g.track, 'original');
    assert.equal(await focused(page), 'start', 'Start keeps the focus');
    const words = await page.locator('.title-menu button').evaluateAll((buttons) => buttons.map((b) => b.childNodes[0].textContent.trim().toUpperCase()));
    assert.deepEqual(words, ['START DRIVING', 'PRACTICE PAD', 'HOW TO PLAY', 'OPTIONS'], 'the menu is v0.2.0\'s, with v0.3.0\'s Practice pad');
    const poster = await stamp(page, POSTER);
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await frames(page);
      const fit = await page.evaluate(() => {
        const box = (el) => el.getBoundingClientRect();
        const select = box(document.querySelector('.track-select'));
        const tagline = box(document.querySelector('.tagline'));
        const start = box(document.getElementById('start'));
        const labels = [...document.querySelectorAll('#tracks label')].map((label) => {
          const r = box(label);
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { right: r.right, bottom: r.bottom, reachable: label.contains(hit) };
        });
        const menu = document.getElementById('menu');
        return { select, tagline, start, labels, scrolls: menu.scrollHeight > menu.clientHeight };
      });
      assert.equal(fit.scrolls, false, `the title scrolls at ${width}x${height}`);
      assert.ok(fit.select.top >= fit.tagline.bottom && fit.select.bottom <= fit.start.top, `the choice sits between the tagline and Start at ${width}x${height}`);
      assert.ok(fit.labels.every((l) => l.reachable && l.right <= width * 0.5 && l.bottom <= height), `both choices are pressable at ${width}x${height}`);
      await page.screenshot({ path: artifact(`${name}-title-${width}x${height}.png`) });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await frames(page);
    step('a fresh visit offers Original and Switchback, with Original chosen and the menu as before');

    await page.keyboard.press('ArrowRight');
    assert.equal(await checked(page), 'original switchback*');
    assert.equal(await focused(page), 'start', 'choosing does not move the focus off Start');
    await page.keyboard.press('ArrowRight');
    assert.equal(await checked(page), 'original* switchback', 'Right wraps');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await checked(page), 'original switchback*', 'Left wraps');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(page), 'practice', 'Up and Down still walk the menu');
    await page.keyboard.press('ArrowUp');
    g = await game(page);
    assert.equal(g.state, 'menu');
    assert.equal(g.ticks, 0);
    assert.deepEqual(g.input, NO_KEYS, 'Left and Right on the title are not steering');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await focused(page), 'classic', 'the handling choice sits between Start and the circuits');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await focused(page), 'switchback', 'Tab reaches the chosen circuit');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await checked(page), 'original* switchback');
    assert.equal(await focused(page), 'original', 'and the focus follows the choice');
    await page.keyboard.press('Space');
    assert.equal(await checked(page), 'original* switchback');
    assert.deepEqual((await game(page)).input, NO_KEYS, 'Space on the choice is not the handbrake');
    await page.locator('#tracks label', { hasText: 'Switchback' }).click();
    assert.equal(await checked(page), 'original switchback*', 'a click chooses');
    await page.locator('#tracks label', { hasText: 'Original' }).click();
    assert.equal(await checked(page), 'original* switchback');
    await page.locator('#tracks label', { hasText: 'Switchback' }).click();
    assert.equal((await game(page)).selected, 'switchback');
    await frames(page);
    assert.equal(await stamp(page, POSTER), poster, 'the poster is the same whichever circuit is chosen');
    step('Left, Right, Tab, Space and clicks choose a circuit, without touching the menu or the poster');

    // --- Driving Switchback with real keys ------------------------------------------------
    await page.locator('#start').focus();
    await page.keyboard.press('Enter');
    await frameShowsGrid(page);
    g = await game(page);
    assert.equal(g.state, 'ready');
    assert.deepEqual([g.track, g.drawn], ['switchback', 'switchback'], 'the run and the picture are both Switchback');
    assert.ok(g.atStart, "the car is on Switchback's grid");
    assert.ok(g.ghost && !g.ghost.replay, 'with no ghost yet');
    const switchbackMap = await stamp(page, MINIMAP);

    const shots = { staircase: false, tight: false };
    const lap = await playWithKeys(page, 'driftDriver', {
      until: (now) => now.completed >= 1,
      onSample: async (now) => {
        if (!shots.staircase && now.s > 470 && now.s < 560) {
          shots.staircase = true;
          await page.screenshot({ path: artifact(`${name}-switchback-staircase-1366x768.png`) });
        }
        if (!shots.tight && now.s > 845 && now.s < 900) {
          shots.tight = true;
          await page.screenshot({ path: artifact(`${name}-switchback-tight-1366x768.png`) });
        }
      },
    });
    assert.equal(lap.mismatched, 0, 'the picture showed Switchback throughout');
    assert.equal(lap.last.voided, 0, 'the lap counted');
    assert.ok(lap.maxSlip > 20, `a scoring drift: ${lap.maxSlip.toFixed(0)} degrees`);
    assert.ok(lap.last.score + lap.last.combo > 0, 'and it scored');
    assert.ok(lap.grass < lap.samples * 0.1, `${lap.grass} of ${lap.samples} samples on the grass`);
    assert.ok(shots.staircase && shots.tight);
    step(`a lap of Switchback with real keys counts, drifting at up to ${lap.maxSlip.toFixed(0)}° for ${Math.round(lap.last.score + lap.last.combo)} points`);

    // The ghost of that lap now drives alongside.
    let ghostPixels = 0;
    await playWithKeys(page, 'driftDriver', {
      seconds: 20,
      until: () => ghostPixels > 0,
      onSample: async () => { ghostPixels = await countPixels(page, GHOST_BODY); },
    });
    g = await game(page);
    assert.ok(g.ghost.replay, 'the lap became the ghost');
    assert.ok(ghostPixels > 0, 'and the ghost is drawn');
    await page.screenshot({ path: artifact(`${name}-switchback-ghost-1366x768.png`) });
    step('the ghost of the Switchback lap replays on Switchback');

    // The radio and engine carry on as on Original.
    const stationBefore = await page.evaluate(() => window.__miniDrifters.audio().station);
    await page.keyboard.press('KeyN');
    assert.notEqual(await page.evaluate(() => window.__miniDrifters.audio().station), stationBefore, 'N changes station');
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('KeyN');
    assert.equal(await page.evaluate(() => window.__miniDrifters.audio().station), stationBefore, 'and comes back round');
    const sound = await page.evaluate(() => window.__miniDrifters.audio());
    assert.equal(typeof sound.engine, 'string');
    assert.ok(sound.rpm > 0, `the engine follows the car: ${sound.rpm} rpm`);
    step('the radio stations and engine work on Switchback');

    await page.keyboard.press('KeyR');
    await frameShowsGrid(page);
    g = await game(page);
    assert.deepEqual([g.track, g.drawn, g.state, g.completed, g.score], ['switchback', 'switchback', 'ready', 0, 0], 'Restart stays on Switchback');
    assert.ok(g.atStart && !g.ghost.replay, 'from the grid, with the ghost cleared');
    step('Restart goes back to the Switchback grid with a fresh session');

    await page.keyboard.press('KeyP');
    await page.locator('#paused .return-title').click();
    assert.ok(await visible(page, 'menu'));
    assert.equal(await checked(page), 'original switchback*', 'the title remembers the choice for this visit');
    await frames(page);
    assert.equal(await stamp(page, POSTER), poster, 'the poster is still the original hairpin');
    step('Return to Title keeps the choice, and the poster is unchanged after driving Switchback');

    // --- The lesson is always on Original ---------------------------------------------------
    await page.locator('#how-to-play').click();
    await page.locator('#help-try').click();
    await frameShowsGrid(page);
    g = await game(page);
    assert.equal(g.tutorial, true);
    assert.deepEqual([g.track, g.drawn], ['original', 'original'], 'the lesson drives Original');
    assert.ok(g.atStart);
    await page.keyboard.press('Escape');
    assert.ok(await visible(page, 'menu'));
    assert.equal(await checked(page), 'original switchback*', 'leaving the lesson keeps the choice');
    step('the lesson uses Original while Switchback is chosen, and leaves the choice alone');

    // --- Drive Again, and going back to Original --------------------------------------------
    await page.keyboard.press('Enter');
    await frameShowsGrid(page);
    assert.equal((await game(page)).track, 'switchback');
    let done = await finishScripted(page);
    assert.deepEqual(done, { completed: 3, voided: 0 });
    await page.waitForSelector('#results:not([hidden])');
    await page.keyboard.press('Enter');
    await frameShowsGrid(page);
    g = await game(page);
    assert.deepEqual([g.track, g.drawn, g.completed, g.score], ['switchback', 'switchback', 0, 0], 'Drive Again is Switchback again, from scratch');
    step('three scripted laps of Switchback finish the run, and Drive Again stays on Switchback');

    await page.keyboard.press('KeyP');
    await page.locator('#paused .return-title').click();
    await page.locator('#tracks label', { hasText: 'Original' }).click();
    await page.locator('#start').click();
    await frameShowsGrid(page);
    g = await game(page);
    assert.deepEqual([g.track, g.drawn, g.completed, g.score], ['original', 'original', 0, 0]);
    assert.ok(g.atStart && g.ghost && !g.ghost.replay, "Original's grid, with nothing from Switchback");
    assert.notEqual(await stamp(page, MINIMAP), switchbackMap, 'the minimap shows the other circuit');
    const originalLap = await playWithKeys(page, 'driftDriver', { seconds: 30, until: (now) => now.s > 300 && now.s < 400 });
    assert.equal(originalLap.mismatched, 0);
    assert.ok(originalLap.maxSlip > 20, `a scoring drift on Original: ${originalLap.maxSlip.toFixed(0)} degrees`);
    done = await finishScripted(page);
    assert.equal(done.completed, 3);
    await page.waitForSelector('#results:not([hidden])');
    step('choosing Original again drives Original, drifts with real keys and finishes a run');
    await page.context().close();

    // --- Switchback's driving view at each size ----------------------------------------------
    for (const [width, height] of SIZES) {
      page = await open({ viewport: { width, height } });
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await frameShowsGrid(page);
      // The simulation runs ahead to the first switchback, then real keys take over for a few
      // seconds, so the camera, smoke and skid marks are those of a car really being driven.
      await page.evaluate(async () => {
        const { driftDriver } = await import(new URL('test/support/drivers.mjs', document.baseURI).href);
        const { tick } = await import(new URL('src/game.js', document.baseURI).href);
        const { game: g } = window.__miniDrifters;
        const driver = driftDriver();
        while (!(g.trackS > 330 && g.trackS < 400) && g.ticks < 120 * 120) tick(g, driver(g));
      });
      const view = await playWithKeys(page, 'driftDriver', { seconds: 20, until: (now) => now.s > 480 && now.s < 560 });
      assert.equal(view.mismatched, 0);
      const fit = await page.evaluate(() => {
        const canvas = document.getElementById('view');
        return { canvas: [canvas.width / devicePixelRatio, canvas.height / devicePixelRatio], scrolls: document.documentElement.scrollHeight > innerHeight };
      });
      assert.deepEqual(fit, { canvas: [width, height], scrolls: false });
      await page.screenshot({ path: artifact(`${name}-switchback-driving-${width}x${height}.png`) });
      await page.context().close();
    }
    step('Switchback drives and draws at 1920x1080, 1366x768 and 1024x600');

    assert.deepEqual(errors, [], 'no page errors, console errors or failed requests');
    assert.deepEqual(external, [], 'no external requests');
    step('no page errors, console errors, failed requests or external requests');
    return { name, version: browser.version(), passed: true, steps };
  } catch (error) {
    await page?.screenshot({ path: artifact(`${name}-failure.png`) }).catch(() => {});
    return { name, version: browser.version(), passed: false, error: error.message, errors, steps };
  } finally {
    await browser.close();
  }
}

const report = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) report.push(await check(name, engine));
} finally {
  server.close();
}
await writeFile(artifact('report.json'), JSON.stringify(report, null, 2));
for (const r of report) console.log(`${r.name} ${r.version}: ${r.passed ? 'PASSED' : `FAILED: ${r.error}`}`);
process.exit(report.every((r) => r.passed) ? 0 : 1);
