// What the player is told when a lap won't count, in real browsers, served the same way as on
// GitHub Pages: the warning the moment a checkpoint is missed, what the voided line cost, and
// the note on the results screen. Needs Playwright:
//   node test/scoring-browser.mjs [/path/to/playwright/index.mjs]
// Screenshots go to artifacts/.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RADIO_FILES } from '../src/radio-stations.js';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');

const root = new URL('../', import.meta.url);
const artifact = (name) => fileURLToPath(new URL(`artifacts/scoring-${name}`, root));
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

const SIZES = [[1920, 1080], [1366, 768], [1024, 600]];
const SUPPORT = ['drivers.mjs', 'exploit-drivers.mjs'];
const digits = (text) => Number(String(text).replace(/[^\d]/g, ''));
const frames = (page, count = 3) => page.evaluate((n) => new Promise((resolve) => {
  const next = (left) => (left ? requestAnimationFrame(() => next(left - 1)) : resolve());
  next(n);
}), count);

// Drives in the page with a scripted driver, a step at a time, until the condition holds. The
// driver is kept on the window so that later calls carry on with the same one.
const driveUntil = (page, condition, { cut = null, fresh = false } = {}) => page.evaluate(async ({ condition, cut, fresh }) => {
  const base = new URL('test/support/', document.baseURI).href;
  const { driftDriver } = await import(`${base}drivers.mjs`);
  const { cutterDriver } = await import(`${base}exploit-drivers.mjs`);
  const { tick } = await import(new URL('src/game.js', document.baseURI).href);
  const { game: g } = window.__miniDrifters;
  if (fresh || !window.__scoringDriver) window.__scoringDriver = cut ? cutterDriver(driftDriver(), cut) : driftDriver();
  const done = new Function('g', `return ${condition};`);
  const limit = g.ticks + 120 * 600;
  while (!done(g) && g.state !== 'finished' && g.ticks < limit) tick(g, window.__scoringDriver(g));
  return { met: done(g), state: g.state, valid: g.laps.valid, voided: g.laps.voided, completed: g.laps.completed, lapEvent: g.lapEvent };
}, { condition, cut, fresh });

async function check(name, engine) {
  console.log(`Checking ${name}...`);
  const step = (label) => console.log(`  ok: ${label}`);
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()}: ${r.url()}`); });
  for (const file of SUPPORT) {
    await page.route(`**/test/support/${file}`, async (route) => route.fulfill({
      contentType: 'text/javascript',
      body: await readFile(new URL(`test/support/${file}`, root)),
    }));
  }
  await page.goto(BASE);
  await page.waitForFunction(() => window.__miniDrifters);
  await frames(page);

  try {
    await page.locator('#start').click();
    await page.waitForFunction(() => window.__miniDrifters.game.state === 'ready');
    await frames(page);

    // A cut that skips a checkpoint: the lap is known to be void at the next gate.
    let s = await driveUntil(page, '!g.laps.valid', { cut: { from: 562, to: 800, times: 1 }, fresh: true });
    assert.ok(s.met, `the lap was detected as void: ${JSON.stringify(s)}`);
    await frames(page);
    assert.ok(await page.locator('#prompt').isVisible());
    assert.equal((await page.locator('#prompt').textContent()).trim(), 'Checkpoint missed. This lap and its points will not count.');
    await page.screenshot({ path: artifact(`${name}-warning.png`) });
    step('the warning appears as soon as the missed checkpoint is detected');

    s = await driveUntil(page, "g.lapEvent === 'void'");
    assert.ok(s.met, `the lap was voided at the line: ${JSON.stringify(s)}`);
    await frames(page);
    const cost = await page.evaluate(() => window.__miniDrifters.game.lastForfeit);
    const bannerText = (await page.locator('#banner').textContent()).trim();
    if (cost > 0) assert.match(bannerText, /^LAP NOT COUNTED — [\d,]+ POINTS LOST$/);
    else assert.equal(bannerText, 'LAP NOT COUNTED — CHECKPOINT MISSED');
    if (cost > 0) assert.equal(digits(bannerText), cost);
    const shown = digits(await page.locator('#score').textContent());
    const kept = await page.evaluate(() => window.__miniDrifters.game.scoring.score - window.__miniDrifters.game.forfeited);
    assert.equal(shown, kept);
    await page.screenshot({ path: artifact(`${name}-void-banner.png`) });
    step(`the voided line says what it cost (${bannerText}), and the HUD score drops to what the run keeps`);

    s = await driveUntil(page, "g.state === 'finished'", { fresh: true });
    assert.equal(s.state, 'finished');
    await page.waitForSelector('#results:not([hidden])');
    const r = await page.evaluate(() => window.__miniDrifters.game.results);
    assert.ok(r.voidedLaps >= 1 && r.forfeited >= 0);
    assert.equal(digits(await page.locator('#r-score').textContent()), r.score);
    assert.ok(await page.locator('#r-void').isVisible());
    const laps = r.voidedLaps === 1 ? '1 lap' : `${r.voidedLaps} laps`;
    assert.equal((await page.locator('#r-void').textContent()).trim().replace(/,/g, ''), `${laps} not counted: ${r.forfeited} points left out of the score.`);
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height });
      await frames(page);
      const fit = await page.evaluate(() => {
        const overlay = document.getElementById('results');
        const note = document.getElementById('r-void').getBoundingClientRect();
        const sheet = overlay.querySelector('.sheet').getBoundingClientRect();
        return { scrolls: overlay.scrollHeight > overlay.clientHeight, inside: note.bottom <= sheet.bottom && note.right <= sheet.right && note.left >= sheet.left };
      });
      assert.deepEqual(fit, { scrolls: false, inside: true }, `${width}x${height}`);
      await page.screenshot({ path: artifact(`${name}-results-${width}x${height}.png`) });
    }
    step('the results screen notes the laps left out, and fits every size');

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.locator('#again').click();
    await page.waitForFunction(() => window.__miniDrifters.game.state === 'ready');
    await frames(page);
    s = await driveUntil(page, "g.state === 'finished'", { fresh: true });
    await page.waitForSelector('#results:not([hidden])');
    assert.equal(s.voided, 0);
    assert.equal(await page.locator('#r-void').isVisible(), false);
    assert.equal(digits(await page.locator('#r-score').textContent()), await page.evaluate(() => window.__miniDrifters.game.scoring.score));
    step('a clean run shows no note, and its score is every point banked');

    assert.deepEqual(errors, []);
    step('no errors');
  } finally {
    await browser.close();
  }
}

try {
  await check('chromium', chromium);
  await check('firefox', firefox);
  console.log('Scoring messages pass in Chromium and Firefox.');
} finally {
  server.close();
}
