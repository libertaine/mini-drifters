// Real-browser check using real key presses. The game has no dependencies; this
// check needs Playwright, either installed here or at a path you pass in:
//   npm install --no-save --no-package-lock playwright@1.64.1 && npm run test:browser
//   node test/browser-check.mjs /path/to/playwright/index.mjs
//
// By default it serves exactly what gets deployed, under /mini-drifters/. To check
// the live site instead, and that it matches this checkout byte for byte:
//   TEST_URL=https://libertaine.github.io/mini-drifters/ npm run test:browser
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RADIO_FILES } from '../src/radio-stations.js';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');

const root = new URL('../', import.meta.url);
const PUBLIC_URL = process.env.TEST_URL;
const PREFIX = PUBLIC_URL ? 'public-' : '';
const artifact = (name) => fileURLToPath(new URL(`artifacts/${PREFIX}${name}`, root));
await mkdir(new URL('artifacts/', root), { recursive: true });

// The same files the deploy job publishes.
const siteFiles = ['index.html', 'style.css', 'audio-lab/assets/tire-foley.mp3', 'audio-lab/assets/ATTRIBUTION.md',
  ...['idle', 'mid', 'load', 'high'].map((key) => `audio-lab/assets/coyote-local/${key}.wav`), ...RADIO_FILES,
  ...(await readdir(new URL('src/', root))).map((name) => `src/${name}`)];

async function serveLikePages() {
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
  return server;
}

const server = PUBLIC_URL ? null : await serveLikePages();
const BASE = PUBLIC_URL ?? `http://127.0.0.1:${server.address().port}/mini-drifters/`;
const ORIGIN = new URL(BASE).origin;

// Git may hold line endings differently from a Windows working copy.
const normalise = (bytes) => bytes.toString('latin1').replace(/\r\n/g, '\n');

if (PUBLIC_URL) {
  for (const file of siteFiles) {
    const response = await fetch(new URL(file, BASE), { cache: 'no-store' });
    assert.equal(response.status, 200, file);
    const served = normalise(Buffer.from(await response.arrayBuffer()));
    assert.equal(served, normalise(await readFile(new URL(file, root))), `${file} differs from this checkout`);
  }
  console.log(`The live site matches this checkout (${siteFiles.length} files).`);
}

const snapshot = (page) => page.evaluate(() => {
  const { game, input } = window.__miniDrifters;
  return {
    state: game.state,
    paused: game.paused,
    ticks: game.ticks,
    runTime: game.runTime,
    speed: game.car.speed,
    x: game.car.x,
    y: game.car.y,
    heading: game.car.heading,
    forwardSpeed: game.car.forwardSpeed,
    slip: game.car.slipAngle * 180 / Math.PI,
    combo: game.scoring.combo,
    score: game.scoring.score,
    event: game.scoring.event,
    input: { ...input },
  };
});
const visible = (page, id) => page.locator(`#${id}`).isVisible();
const noKeysHeld = { up: false, down: false, left: false, right: false, handbrake: false };

async function check(name, engine) {
  console.log(`Checking ${name}...`);
  const steps = [];
  const step = (label) => { steps.push(label); console.log(`  ok: ${label}`); };
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (new URL(r.url()).origin !== ORIGIN) external.push(r.url()); });
  page.on('requestfailed', (r) => errors.push(`failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()}: ${r.url()}`); });
  // Lets the page import the same scripted driver the Node tests use.
  await page.route('**/test/support/drivers.mjs', async (route) => route.fulfill({
    contentType: 'text/javascript',
    body: await readFile(new URL('test/support/drivers.mjs', root)),
  }));

  try {
    const response = await page.goto(BASE);
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => window.__miniDrifters);
    assert.ok(await visible(page, 'menu'));
    assert.equal(await visible(page, 'hud'), false);
    assert.match(await page.locator('#menu').innerText(), /MINI\s+DRIFTERS/);
    assert.match(await page.locator('#help').textContent(), /Accelerate[\s\S]*Scoring|Scoring[\s\S]*Accelerate/);
    step('start screen shows the title, and How to Play holds the controls and scoring');
    await page.waitForTimeout(150);
    await page.screenshot({ path: artifact(`${name}-menu.png`) });

    // Nothing scrolls, and the game keys are claimed from the page.
    await page.evaluate(() => {
      window.__prevented = {};
      window.addEventListener('keydown', (e) => { window.__prevented[e.code] = e.defaultPrevented; });
    });

    await page.keyboard.press('Enter');
    assert.equal((await snapshot(page)).state, 'ready');
    assert.ok(await visible(page, 'hud'));
    await page.waitForTimeout(600);
    let s = await snapshot(page);
    assert.equal(s.runTime, 0);
    step('Enter starts a run, and the clock waits on the grid');

    // Throttle, steering and handbrake together.
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(3800);
    await page.screenshot({ path: artifact(`${name}-speed.png`) });
    s = await snapshot(page);
    assert.equal(s.state, 'racing');
    assert.ok(s.speed > 20, `speed ${s.speed}`);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(150);
    await page.keyboard.down('Space');
    s = await snapshot(page);
    assert.deepEqual(s.input, { up: true, down: false, left: false, right: true, handbrake: true });
    step('throttle, steering and handbrake register at the same time');
    await page.waitForTimeout(320);
    await page.keyboard.up('Space');
    await page.waitForTimeout(420);
    s = await snapshot(page);
    assert.ok(Math.abs(s.slip) > 12, `slip ${s.slip}`);
    assert.ok(s.combo, 'a combo started');
    await page.screenshot({ path: artifact(`${name}-drift.png`) });
    step(`a real-key handbrake turn produces a drift and a combo (${Math.abs(s.slip).toFixed(0)} degrees)`);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowUp');

    // However that slide ends, the combo must resolve and the score must agree with it.
    await page.waitForFunction(() => !window.__miniDrifters.game.scoring.combo, null, { timeout: 8000 });
    s = await snapshot(page);
    assert.ok(s.event && s.event.points > 0, 'the combo ended with a result');
    assert.ok(['banked', 'lost'].includes(s.event.type));
    assert.equal(s.score, s.event.type === 'banked' ? s.event.points : 0);
    step(`the combo resolves and scoring agrees (${s.event.points} ${s.event.type})`);

    // Steering and braking, from a fresh run.
    await page.keyboard.press('KeyR');
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(1500);
    const straightHeading = (await snapshot(page)).heading;
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(350);
    await page.keyboard.up('ArrowLeft');
    const leftHeading = (await snapshot(page)).heading;
    assert.ok(leftHeading < straightHeading - 0.05, `left turned from ${straightHeading} to ${leftHeading}`);
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowRight');
    const rightHeading = (await snapshot(page)).heading;
    assert.ok(rightHeading > leftHeading, `right turned from ${leftHeading} to ${rightHeading}`);
    step('left and right steer the car');
    await page.keyboard.up('ArrowUp');
    const brakeFrom = (await snapshot(page)).speed;
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(400);
    const braked = (await snapshot(page)).speed;
    assert.ok(braked < brakeFrom - 4, `braked from ${brakeFrom} to ${braked}`);
    await page.waitForFunction(() => window.__miniDrifters.game.car.forwardSpeed < -0.5, null, { timeout: 6000 });
    await page.keyboard.up('ArrowDown');
    step('Down brakes hard, then reverses');
    await page.keyboard.press('KeyR');

    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(400);
    await page.keyboard.up('ArrowUp');
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']) {
      await page.keyboard.press(code);
      assert.equal(await page.evaluate((c) => window.__prevented[c], code), true, code);
    }
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    step('arrow keys and space are claimed, and the page does not scroll');

    // Focus loss clears held keys, then stops the clock.
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowLeft');
    assert.equal((await snapshot(page)).input.up, true);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    s = await snapshot(page);
    assert.deepEqual(s.input, noKeysHeld);
    assert.equal(s.paused, true);
    assert.ok(await visible(page, 'paused'));
    step('losing focus clears held keys and pauses');
    await page.keyboard.up('ArrowUp');
    await page.keyboard.up('ArrowLeft');

    // Pause and resume.
    const before = (await snapshot(page)).ticks;
    await page.waitForTimeout(300);
    assert.equal((await snapshot(page)).ticks, before);
    await page.keyboard.press('KeyP');
    assert.equal(await visible(page, 'paused'), false);
    await page.waitForTimeout(200);
    assert.ok((await snapshot(page)).ticks > before);
    await page.keyboard.press('KeyP');
    assert.ok(await visible(page, 'paused'));
    step('P pauses and resumes');

    // Debug panel.
    assert.equal(await visible(page, 'debug'), false);
    await page.keyboard.press('KeyD');
    await page.waitForTimeout(100);
    assert.ok(await visible(page, 'debug'));
    const debugText = await page.locator('#debug').textContent();
    for (const field of ['forward', 'lateral', 'slip', 'yaw rate', 'steer', 'handbrake', 'traction', 'drift', 'checkpoint']) {
      assert.ok(debugText.includes(field), `debug shows ${field}`);
    }
    await page.screenshot({ path: artifact(`${name}-debug.png`) });
    await page.keyboard.press('KeyD');
    assert.equal(await visible(page, 'debug'), false);
    step('D toggles a debug panel with every requested value');

    // Restart from a pause, without any menu.
    await page.keyboard.press('KeyR');
    s = await snapshot(page);
    assert.equal(s.state, 'ready');
    assert.equal(s.paused, false);
    assert.equal(s.runTime, 0);
    assert.equal(s.speed, 0);
    assert.equal(s.score, 0);
    assert.equal(await visible(page, 'paused'), false);
    assert.equal(await visible(page, 'menu'), false);
    step('R restarts instantly, without a menu');

    // Measure the frame rate while driving, with a full set of effects on screen.
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('Space');
    const fps = await page.evaluate(() => new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      const count = (t) => {
        frames += 1;
        if (t - start < 2000) requestAnimationFrame(count);
        else resolve(frames / ((t - start) / 1000));
      };
      requestAnimationFrame(count);
    }));
    await page.keyboard.up('ArrowUp');
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('Space');
    assert.ok(fps > 20, `fps ${fps}`);
    step(`frame rate while sliding: ${fps.toFixed(0)} fps (software rendering, headless)`);

    // A complete run, driven by the scripted driver, ending on the results screen.
    await page.keyboard.press('KeyR');
    await page.evaluate(async () => {
      const { driftDriver } = await import(new URL('test/support/drivers.mjs', document.baseURI).href);
      const { tick } = await import(new URL('src/game.js', document.baseURI).href);
      const { game } = window.__miniDrifters;
      const driver = driftDriver();
      while (game.state !== 'finished') tick(game, driver(game));
    });
    await page.waitForSelector('#results:not([hidden])');
    const results = await page.locator('#results').textContent();
    assert.match(results, /Run complete/);
    const score = await page.locator('#r-score').textContent();
    assert.ok(Number(score.replace(/,/g, '')) > 1000, `score ${score}`);
    for (const id of ['r-best', 'r-time', 'r-combo', 'r-spins', 'remark']) {
      assert.ok((await page.locator(`#${id}`).textContent()).trim().length > 0, id);
    }
    await page.screenshot({ path: artifact(`${name}-results.png`) });
    step(`a full run ends with results (score ${score})`);

    await page.keyboard.press('KeyR');
    await page.waitForTimeout(80);
    assert.equal(await visible(page, 'results'), false);
    assert.equal((await snapshot(page)).state, 'ready');
    step('results can be dismissed straight into a new run');

    // The start screen still fits a small laptop window.
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.reload();
    await page.waitForFunction(() => window.__miniDrifters);
    await page.locator('#start').scrollIntoViewIfNeeded();
    assert.ok(await page.locator('#start').isVisible());
    await page.locator('#start').click();
    assert.equal((await snapshot(page)).state, 'ready');
    await page.waitForTimeout(150);
    await page.screenshot({ path: artifact(`${name}-small.png`) });
    step('the Start button works at 1024x600');

    assert.deepEqual(errors, [], 'no page or console errors');
    assert.deepEqual(external, [], 'no external requests');
    step('no page errors, no console errors, no external requests');
    return { name, version: browser.version(), passed: true, fps: Math.round(fps), steps };
  } catch (error) {
    await page.screenshot({ path: artifact(`${name}-failure.png`) }).catch(() => {});
    return { name, version: browser.version(), passed: false, error: error.message, errors, steps };
  } finally {
    await browser.close();
  }
}

const report = [];
try {
  for (const [name, engine] of Object.entries({ chromium, firefox })) report.push(await check(name, engine));
} finally {
  server?.close();
}
await writeFile(artifact('browser-report.json'), JSON.stringify(report, null, 2));
for (const r of report) console.log(`${r.name} ${r.version}: ${r.passed ? 'PASSED' : `FAILED: ${r.error}`}`);
process.exit(report.every((r) => r.passed) ? 0 : 1);
