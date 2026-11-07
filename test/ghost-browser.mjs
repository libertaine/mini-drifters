// The previous-lap ghost in real browsers: real keys, real frames and real pixels,
// served the same way as on GitHub Pages. Needs Playwright, like the main browser check:
//   node test/ghost-browser.mjs [/path/to/playwright/index.mjs]
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RADIO_FILES } from '../src/radio-stations.js';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');

const root = new URL('../', import.meta.url);
const artifact = (name) => fileURLToPath(new URL(`artifacts/ghost-${name}`, root));
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

const visible = (page, id) => page.locator(`#${id}`).isVisible();
const ghostState = (page) => page.evaluate(() => {
  const { game } = window.__miniDrifters;
  return {
    state: game.state,
    paused: game.paused,
    visible: game.ghostVisible,
    lapTick: game.ghost.lapTick,
    lapTime: game.laps.lapTime,
    completed: game.laps.completed,
    hasReplay: !!game.ghost.replay,
    replayTicks: game.ghost.replay?.durationTicks ?? null,
    ticks: game.ticks,
  };
});

// Helpers shared by the page-side steps: the same driver as the Node tests, the live
// game's module instances, and a second renderer that can draw a chosen frame on demand.
async function installHelpers(page) {
  await page.evaluate(async () => {
    const at = (path) => new URL(path, document.baseURI).href;
    const { tick, createGame, startRun, toggleGhost } = await import(at('src/game.js'));
    const { createRenderer, drawFrame } = await import(at('src/render.js'));
    const { ghostDisplay } = await import(at('src/ghost.js'));
    const { gripDriver, driftDriver } = await import(at('test/support/drivers.mjs'));
    const { game } = window.__miniDrifters;
    const probe = createRenderer(document.createElement('canvas'), game.track);
    const shoot = (x, y, alpha = 0) => {
      probe.cam.x = x;
      probe.cam.y = y;
      probe.cam.zoom = 11.5;
      // A zero frame time keeps the camera still and leaves the effects alone.
      drawFrame(probe, game, alpha, 0, false);
      return probe.ctx.getImageData(0, 0, probe.canvas.width, probe.canvas.height).data;
    };
    const difference = (a, b) => {
      let changed = 0;
      let total = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        if (d > 24) {
          changed += 1;
          total += d;
        }
      }
      return { changed, meanDelta: changed ? total / changed : 0 };
    };
    window.__ghostTest = { tick, createGame, startRun, toggleGhost, createRenderer, drawFrame, ghostDisplay, gripDriver, driftDriver, probe, shoot, difference, driver: gripDriver() };
  });
}

// The scripted driver times its decisions from the run's clock, so each run needs its own.
const freshDriver = (page) => page.evaluate(() => {
  window.__ghostTest.driver = window.__ghostTest.gripDriver();
});

const driveLaps = (page, laps) => page.evaluate((target) => {
  const { game } = window.__miniDrifters;
  const { tick, driver } = window.__ghostTest;
  while (game.laps.completed < target && game.state !== 'finished') tick(game, driver(game));
}, laps);

// Drives on to a moment when the ghost is close enough to share the screen, freezes
// there without the pause overlay, and lets the real camera settle.
async function showNearbyGhost(page, label) {
  const found = await page.evaluate(() => {
    const { game } = window.__miniDrifters;
    const { tick, driver, ghostDisplay } = window.__ghostTest;
    const startLap = game.laps.completed;
    // Stops short of the line, so that the last lap doesn't end the run.
    const searchEnd = game.ghost.replay.durationTicks * 0.85;
    while (game.state === 'racing' && game.laps.completed === startLap && game.ghost.lapTick < searchEnd) {
      tick(game, driver(game));
      if (game.ghost.lapTick < 360) continue;
      const shown = ghostDisplay(game.ghost, game.ghost.lapTick, game.car.x, game.car.y);
      if (!shown) continue;
      const distance = Math.hypot(shown.x - game.car.x, shown.y - game.car.y);
      if (distance > 9 && distance < 45) {
        game.paused = true;
        return distance;
      }
    }
    return null;
  });
  if (found === null) return null;
  await page.waitForTimeout(1500);
  await page.screenshot({ path: artifact(label) });
  await page.evaluate(() => { window.__miniDrifters.game.paused = false; });
  return found;
}

async function check(name, engine) {
  console.log(`Checking ${name}...`);
  const steps = [];
  const step = (label) => { steps.push(label); console.log(`  ok: ${label}`); };
  const browser = await engine.launch({ headless: true });
  const measures = {};
  const errors = [];
  const newPage = async (viewport = { width: 1366, height: 768 }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.route('**/test/support/drivers.mjs', async (route) => route.fulfill({
      contentType: 'text/javascript',
      body: await readFile(new URL('test/support/drivers.mjs', root)),
    }));
    return page;
  };
  const start = async (page) => {
    await page.goto(BASE);
    await page.waitForFunction(() => window.__miniDrifters);
    await installHelpers(page);
  };

  let page;
  try {
    // --- The controls, on the menu and in the HUD ------------------------------
    page = await newPage();
    await start(page);
    assert.match(await page.locator('#help-keys').textContent(), /Ghost/);
    assert.equal(await page.locator('#help-keys kbd', { hasText: /^G$/ }).count(), 1);
    // Start must stay on a small laptop screen.
    await page.setViewportSize({ width: 1024, height: 600 });
    const startBottom = await page.evaluate(() => document.getElementById('start').getBoundingClientRect().bottom);
    assert.ok(startBottom <= 600, `Start ends at ${startBottom}`);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.keyboard.press('KeyG');
    assert.equal((await ghostState(page)).visible, true, 'G does nothing on the menu');
    assert.equal(await visible(page, 'ghost-status'), false);
    step('How to Play lists G, and G does nothing before a run');

    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#ghost-status').textContent(), 'Ghost On');
    assert.ok(await visible(page, 'ghost-status'));
    await page.keyboard.press('KeyG');
    assert.equal(await page.locator('#ghost-status').textContent(), 'Ghost Off');
    assert.equal((await ghostState(page)).visible, false);
    await page.keyboard.press('KeyG');
    assert.equal(await page.locator('#ghost-status').textContent(), 'Ghost On');
    assert.equal((await ghostState(page)).visible, true);
    step('a real G key press toggles the ghost and its indicator');

    // Clear of the rest of the HUD, at the window sizes the game supports.
    const overlaps = () => page.evaluate(() => {
      const box = (el) => el.getBoundingClientRect();
      const tag = box(document.getElementById('ghost-status'));
      const clash = (other) => !(tag.right <= other.left || tag.left >= other.right || tag.bottom <= other.top || tag.top >= other.bottom);
      return ['sound', 'score', 'combo', 'banner', 'debug']
        .map((id) => document.getElementById(id) ?? document.querySelector(`.${id}`))
        .filter((el) => el && !el.hidden && clash(box(el)))
        .map((el) => el.id || el.className);
    });
    assert.deepEqual(await overlaps(), []);
    await page.setViewportSize({ width: 1024, height: 600 });
    assert.deepEqual(await overlaps(), []);
    await page.setViewportSize({ width: 1366, height: 768 });
    step('the indicator overlaps nothing at 1366x768 or 1024x600');

    // --- Lap 1 -----------------------------------------------------------------
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(1200);
    await page.keyboard.up('ArrowUp');
    let s = await ghostState(page);
    assert.equal(s.state, 'racing');
    assert.equal(s.hasReplay, false);
    assert.ok(s.lapTick > 0);
    const noGhostLeak = await page.evaluate(() => {
      const { game } = window.__miniDrifters;
      const { shoot, difference } = window.__ghostTest;
      const on = shoot(game.car.x, game.car.y);
      game.ghostVisible = false;
      const off = shoot(game.car.x, game.car.y);
      game.ghostVisible = true;
      return difference(on, off).changed;
    });
    assert.equal(noGhostLeak, 0);
    step('the first lap draws no ghost, and its clock runs from real frames');

    // --- Restart ---------------------------------------------------------------
    await driveLaps(page, 1);
    assert.equal((await ghostState(page)).hasReplay, true);
    await page.keyboard.press('KeyR');
    s = await ghostState(page);
    assert.equal(s.state, 'ready');
    assert.equal(s.hasReplay, false);
    assert.equal(s.lapTick, 0);
    step('R clears the ghost');
    await page.keyboard.press('KeyG');
    await page.keyboard.press('KeyR');
    assert.equal((await ghostState(page)).visible, false);
    assert.equal(await page.locator('#ghost-status').textContent(), 'Ghost Off');
    await page.keyboard.press('KeyG');
    step('hiding the ghost is a preference that survives a restart');

    // --- Lap 2 and lap 3, as a player sees them ---------------------------------
    await page.keyboard.press('KeyR');
    await freshDriver(page);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(150);
    await page.keyboard.up('ArrowUp');
    await driveLaps(page, 1);
    s = await ghostState(page);
    assert.equal(s.hasReplay, true);
    const firstReplayTicks = s.replayTicks;
    await page.waitForTimeout(400);
    const moving = await ghostState(page);
    assert.ok(moving.lapTick > s.lapTick, 'real frames drive the playback');
    assert.ok(Math.abs(moving.lapTick / 120 - moving.lapTime) < 1e-6, 'playback time is lap time');
    step(`lap 2 replays lap 1 (${(firstReplayTicks / 120).toFixed(2)} s), on the simulation clock`);

    measures.lap2Gap = await showNearbyGhost(page, `${name}-lap2.png`);
    await driveLaps(page, 2);
    s = await ghostState(page);
    assert.notEqual(s.replayTicks, firstReplayTicks, 'the second lap took over');
    measures.lap3Gap = await showNearbyGhost(page, `${name}-lap3.png`);
    assert.ok(measures.lap3Gap !== null || measures.lap2Gap !== null, 'the ghost shared the screen at some point');
    step(`lap 3 replays lap 2 (${(s.replayTicks / 120).toFixed(2)} s), and the ghost is on screen (gaps ${measures.lap2Gap?.toFixed(0) ?? 'none'} m, ${measures.lap3Gap?.toFixed(0) ?? 'none'} m)`);

    // --- Pixels ----------------------------------------------------------------
    await page.keyboard.press('KeyP');
    assert.ok(await visible(page, 'paused'));
    const pixels = await page.evaluate(() => {
      const { game } = window.__miniDrifters;
      const { shoot, difference, ghostDisplay } = window.__ghostTest;
      const realReplay = game.ghost.replay;
      const carAt = { x: game.car.x, y: game.car.y };
      const prevAt = game.prev.x;
      const out = {};
      // Put the ghost somewhere known, far from the player, on each surface.
      const samplePose = (shift) => {
        const tick = game.ghost.lapTick - 1;
        const base = ghostDisplay(game.ghost, tick, 1e6, 1e6);
        return { x: base.x + shift.x, y: base.y + shift.y };
      };
      const measure = (shift) => {
        game.ghost.replay = realReplay;
        const pose = samplePose(shift);
        game.ghost.replay = { ...realReplay, x: realReplay.x.map((v) => v + shift.x), y: realReplay.y.map((v) => v + shift.y) };
        // The player is well away, so no overlap fade applies. At alpha 0 the car is
        // drawn at its previous pose, so that has to move as well.
        game.car.x = pose.x + 2000;
        game.prev.x = pose.x + 2000;
        const on = shoot(pose.x, pose.y);
        game.ghostVisible = false;
        const off = shoot(pose.x, pose.y);
        game.ghostVisible = true;
        game.car.x = carAt.x;
        game.prev.x = prevAt;
        game.ghost.replay = realReplay;
        return difference(on, off);
      };
      out.road = measure({ x: 0, y: 0 });
      // Far enough to the side of the road to be standing on grass.
      out.grass = measure({ x: game.track.halfWidth * 3, y: game.track.halfWidth * 3 });

      // Hidden must equal absent, pixel for pixel.
      game.ghostVisible = false;
      const hidden = shoot(carAt.x, carAt.y);
      game.ghostVisible = true;
      game.ghost.replay = null;
      const absent = shoot(carAt.x, carAt.y);
      game.ghost.replay = realReplay;
      out.hiddenAgainstAbsent = difference(hidden, absent).changed;

      // Directly under the player, the ghost must not tint the car at all.
      const poses = realReplay.x.map(() => game.car.x);
      game.ghost.replay = { ...realReplay, x: poses, y: realReplay.y.map(() => game.car.y), heading: realReplay.heading.map(() => game.car.heading + 0.5) };
      const under = shoot(carAt.x, carAt.y, 1);
      game.ghostVisible = false;
      const clear = shoot(carAt.x, carAt.y, 1);
      game.ghostVisible = true;
      game.ghost.replay = realReplay;
      const { probe } = window.__ghostTest;
      const { width, height } = probe.canvas;
      const dpr = probe.dpr;
      let tinted = 0;
      const metres = 11.5 * dpr;
      for (let along = -2; along <= 2; along += 0.25) {
        const px = Math.round(width / 2 + Math.cos(game.car.heading) * along * metres);
        const py = Math.round(height / 2 + Math.sin(game.car.heading) * along * metres);
        const i = (py * width + px) * 4;
        if (under[i] !== clear[i] || under[i + 1] !== clear[i + 1] || under[i + 2] !== clear[i + 2]) tinted += 1;
      }
      out.playerPixelsTinted = tinted;
      out.overlapChanged = difference(under, clear).changed;
      return out;
    });
    measures.pixels = pixels;
    for (const surface of ['road', 'grass']) {
      assert.ok(pixels[surface].changed > 900, `${surface}: ${JSON.stringify(pixels[surface])}`);
      assert.ok(pixels[surface].meanDelta > 90, `${surface} contrast: ${JSON.stringify(pixels[surface])}`);
    }
    step(`the ghost stands out on road (${pixels.road.changed} px, contrast ${pixels.road.meanDelta.toFixed(0)}) and grass (${pixels.grass.changed} px, contrast ${pixels.grass.meanDelta.toFixed(0)})`);
    assert.equal(pixels.hiddenAgainstAbsent, 0);
    step('a hidden ghost draws nothing at all');
    assert.equal(pixels.playerPixelsTinted, 0);
    assert.ok(pixels.overlapChanged > 0, 'the ghost does show around the car');
    step('a ghost directly under the player leaves the player\'s car untouched');

    // --- Pause -----------------------------------------------------------------
    const pausedAt = await ghostState(page);
    const shownAt = await page.evaluate(() => {
      const { game } = window.__miniDrifters;
      return window.__ghostTest.ghostDisplay(game.ghost, game.ghost.lapTick - 1 + game.accumulator * 120, game.car.x, game.car.y);
    });
    await page.waitForTimeout(350);
    const stillPaused = await ghostState(page);
    assert.equal(stillPaused.lapTick, pausedAt.lapTick);
    assert.equal(stillPaused.ticks, pausedAt.ticks);
    assert.deepEqual(await page.evaluate(() => {
      const { game } = window.__miniDrifters;
      return window.__ghostTest.ghostDisplay(game.ghost, game.ghost.lapTick - 1 + game.accumulator * 120, game.car.x, game.car.y);
    }), shownAt);
    await page.keyboard.press('KeyG');
    assert.equal(await page.locator('#ghost-status').textContent(), 'Ghost Off');
    await page.keyboard.press('KeyG');
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(200);
    assert.ok((await ghostState(page)).lapTick > pausedAt.lapTick);
    step('P freezes the ghost, G still works while paused, and resuming continues');

    // --- Results stay the same -------------------------------------------------
    const results = await page.evaluate(() => {
      const { createGame, startRun, tick, drawFrame, driftDriver, probe } = window.__ghostTest;
      const play = (mode) => {
        const game = createGame();
        startRun(game);
        if (mode === 'hidden') game.ghostVisible = false;
        if (mode === 'removed') game.ghost = null;
        const driver = driftDriver();
        let frames = 0;
        for (let i = 0; game.state !== 'finished'; i += 1) {
          tick(game, driver(game));
          if (i % 30 === 0) {
            drawFrame(probe, game, 0.5, 1 / 60, false);
            frames += 1;
          }
        }
        const { car, laps, scoring } = game;
        return { frames, summary: JSON.stringify({ results: game.results, car, laps, scoring, ticks: game.ticks }) };
      };
      return { shown: play('shown'), hidden: play('hidden'), removed: play('removed') };
    });
    assert.equal(results.shown.summary, results.removed.summary);
    assert.equal(results.hidden.summary, results.removed.summary);
    assert.ok(results.shown.frames > 100);
    step(`a drawn run gives identical results with the ghost shown, hidden or removed (${results.shown.frames} frames drawn)`);

    // --- Cost ------------------------------------------------------------------
    await page.keyboard.press('KeyR');
    await freshDriver(page);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(100);
    await page.keyboard.up('ArrowUp');
    await driveLaps(page, 1);
    await page.evaluate(() => {
      const { game } = window.__miniDrifters;
      const { tick, driver } = window.__ghostTest;
      for (let i = 0; i < 1500; i += 1) tick(game, driver(game));
    });
    const draw = await page.evaluate(() => {
      const { game } = window.__miniDrifters;
      const { drawFrame, probe } = window.__ghostTest;
      const batch = (shown) => {
        game.ghostVisible = shown;
        const begun = performance.now();
        for (let i = 0; i < 60; i += 1) drawFrame(probe, game, i / 60, 0, false);
        probe.ctx.getImageData(0, 0, 1, 1); // waits for any deferred drawing
        return (performance.now() - begun) / 60;
      };
      probe.cam.x = game.car.x;
      probe.cam.y = game.car.y;
      const on = [];
      const off = [];
      batch(true);
      for (let i = 0; i < 9; i += 1) {
        on.push(batch(true));
        off.push(batch(false));
      }
      game.ghostVisible = true;
      const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
      return { onMs: median(on), offMs: median(off) };
    });
    measures.drawCost = draw;
    assert.ok(draw.onMs - draw.offMs < Math.max(1.5, draw.offMs * 0.2), `drawing with the ghost ${draw.onMs} ms, without ${draw.offMs} ms`);
    step(`drawing a frame: ${draw.onMs.toFixed(2)} ms with the ghost, ${draw.offMs.toFixed(2)} ms without (software rendering)`);

    const framesPerSecond = (shown) => page.evaluate((visibleNow) => new Promise((resolve) => {
      window.__miniDrifters.game.ghostVisible = visibleNow;
      let frames = 0;
      const begun = performance.now();
      const count = (t) => {
        frames += 1;
        if (t - begun < 1500) requestAnimationFrame(count);
        else resolve(frames / ((t - begun) / 1000));
      };
      requestAnimationFrame(count);
    }), shown);
    await page.keyboard.down('ArrowUp');
    const fpsOn = await framesPerSecond(true);
    const fpsOff = await framesPerSecond(false);
    await page.keyboard.up('ArrowUp');
    await page.evaluate(() => { window.__miniDrifters.game.ghostVisible = true; });
    measures.fps = { on: Math.round(fpsOn), off: Math.round(fpsOff) };
    assert.ok(fpsOn > 20 && fpsOn > fpsOff * 0.7, `${fpsOn} fps with the ghost, ${fpsOff} without`);
    step(`frame rate: ${fpsOn.toFixed(0)} fps with the ghost, ${fpsOff.toFixed(0)} without`);

    await page.context().close();

    // --- Low frame rates -------------------------------------------------------
    page = await newPage();
    await page.addInitScript(() => {
      // Hands the page a frame about every 80 ms, as a struggling machine would.
      const real = window.requestAnimationFrame.bind(window);
      let lastFrame = 0;
      window.requestAnimationFrame = (callback) => {
        const wait = (t) => {
          // Everything waiting on one browser frame shares its timestamp, and runs together.
          if (t - lastFrame >= 80 || t === lastFrame) {
            lastFrame = t;
            callback(t);
          } else {
            real(wait);
          }
        };
        return real(wait);
      };
    });
    await start(page);
    await page.keyboard.press('Enter');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(200);
    await driveLaps(page, 1);
    const slow = await page.evaluate(() => new Promise((resolve) => {
      const { game } = window.__miniDrifters;
      const { ghostDisplay } = window.__ghostTest;
      const seen = [];
      const begun = performance.now();
      const sample = (t) => {
        const shown = ghostDisplay(game.ghost, game.ghost.lapTick, game.car.x, game.car.y);
        seen.push({ t, x: shown.x, y: shown.y, tick: game.ghost.lapTick, lapTime: game.laps.lapTime });
        if (t - begun < 2500) requestAnimationFrame(sample);
        else resolve(seen);
      };
      requestAnimationFrame(sample);
    }));
    await page.keyboard.up('ArrowUp');
    const seconds = (slow.at(-1).t - slow[0].t) / 1000;
    const slowFps = (slow.length - 1) / seconds;
    assert.ok(slowFps > 5 && slowFps < 16, `throttled to ${slowFps} fps`);
    for (const sample of slow) assert.ok(Math.abs(sample.tick / 120 - sample.lapTime) < 1e-6, 'the clock stays on lap time');
    let longest = 0;
    for (let i = 1; i < slow.length; i += 1) {
      const moved = Math.hypot(slow[i].x - slow[i - 1].x, slow[i].y - slow[i - 1].y);
      const elapsed = (slow[i].tick - slow[i - 1].tick) / 120;
      assert.ok(moved <= 90 * elapsed + 0.01, `the ghost jumped ${moved} m in ${elapsed} s`);
      longest = Math.max(longest, moved);
    }
    assert.ok(slow.at(-1).tick > slow[0].tick + 120, 'playback kept up');
    measures.lowFps = { fps: Number(slowFps.toFixed(1)), longestStepMetres: Number(longest.toFixed(2)) };
    step(`at ${slowFps.toFixed(0)} fps the ghost keeps lap time and moves without jumps (longest step ${longest.toFixed(1)} m)`);

    assert.deepEqual(errors, [], 'no page or console errors');
    step('no page or console errors');
    return { name, version: browser.version(), passed: true, measures, steps };
  } catch (error) {
    await page?.screenshot({ path: artifact(`${name}-failure.png`) }).catch(() => {});
    return { name, version: browser.version(), passed: false, error: error.message, errors, measures, steps };
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
