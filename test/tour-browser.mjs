// Circuit Tour (v0.9.0 R2 research build) in real browsers, Chromium and Firefox:
//   - without ?research=tour nothing changes: no title button, no Tour key, the title unchanged
//   - with it: the title column and every Tour sheet fit 1024x600, 1366x768 and 1920x1080
//   - the Tour sheet by keyboard, mouse and a mocked standard controller; handling changes there
//   - whole rounds driven by the repo's scripted driver through the game's own tick(), so every
//     score is a real run: the Joker, a paid restart and a free one, leaving from the grid (free),
//     a page reload while driving (costs a restart), no restarts left (Leave becomes a DNF), the
//     final sheet, Rematch (same circuits and posted scores), Retire, and the Targets format
//   - a Tour round sets the ordinary circuit records; the Tour keeps its own key and touches no other
//   - denied storage: the Tour still plays and says it cannot be saved
//   - no page errors and no request leaves the page
// Needs Playwright:  node test/tour-browser.mjs [/path/to/playwright/index.mjs]
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RECORDS_KEY } from '../src/records.js';
import { TOUR_STORE_KEY } from '../src/tour-store.js';
import { SERIES_POINTS } from '../src/tour.js';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
const artifact = (name) => fileURLToPath(new URL(`artifacts/tour-${name}`, root));
await mkdir(new URL('artifacts/', root), { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.md': 'text/plain; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!/^(?:index\.html|style\.css|src\/[\w-]+\.js|test\/support\/drivers\.mjs|radio\/.+|audio-lab\/assets\/.+)$/.test(file)) {
    res.writeHead(404).end();
    return;
  }
  try {
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }).end(await readFile(new URL(file, root)));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const SIZES = [[1024, 600], [1366, 768], [1920, 1080]];
const GUARD = 560; // a Tour sheet that appears by itself ignores Enter and Space for 500 ms
const KNOWN_KEYS = new Set([RECORDS_KEY, 'mini-drifters-ghosts-v1', TOUR_STORE_KEY, 'mini-drifters-sound', 'mini-drifters-handling',
  'mini-drifters-audio', 'mini-drifters-ghost', 'mini-drifters-radio']);

// Sound off, a mocked standard gamepad, and frames only when the test asks for them.
function installHarness({ denyStorage }) {
  if (denyStorage) {
    Storage.prototype.setItem = function setItem() { throw new DOMException('denied', 'SecurityError'); };
  } else if (!sessionStorage.getItem('tour-seeded')) {
    localStorage.setItem('mini-drifters-sound', 'off');
    sessionStorage.setItem('tour-seeded', 'yes');
  }
  const buttons = Array.from({ length: 17 }, () => ({ value: 0, pressed: false }));
  window.__pad = { index: 0, id: 'Tour Test Pad', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons };
  window.__padOn = false;
  Object.defineProperty(navigator, 'getGamepads', { value: () => (window.__padOn ? [window.__pad] : []) });
  window.requestAnimationFrame = (cb) => { window.__raf = cb; return 1; };
  let now = 1000;
  window.__frames = (n = 2) => { for (let i = 0; i < n; i += 1) { now += 1000 / 60; window.__raf?.(now); } };
  window.__pressPad = (idx) => {
    buttons[idx] = { value: 1, pressed: true };
    window.__frames(2);
    buttons[idx] = { value: 0, pressed: false };
    window.__frames(2);
  };
}

async function run(engine, name) {
  console.log(`Checking ${name}...`);
  const step = (label) => console.log(`  ok: ${label}`);
  const browser = await engine.launch({ headless: true });
  const errors = [];
  const external = [];
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', (req) => { if (!req.url().startsWith(base) && !req.url().startsWith('data:')) external.push(req.url()); });
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    watch(page);
    await page.addInitScript(installHarness, { denyStorage: false });
    const frames = (n = 2) => page.evaluate((count) => window.__frames(count), n);
    const key = async (code) => { await page.keyboard.press(code); await frames(2); };
    const tour = () => page.evaluate(() => window.__miniDrifters.tour());
    const stored = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), TOUR_STORE_KEY);
    const drive = (condition) => page.evaluate(async (cond) => {
      const { driftDriver } = await import(new URL('test/support/drivers.mjs', document.baseURI).href);
      const { tick } = await import(new URL('src/game.js', document.baseURI).href);
      const g = window.__miniDrifters.game;
      if (!window.__driver || window.__driverRun !== g.runId) { window.__driver = driftDriver(); window.__driverRun = g.runId; }
      const done = new Function('g', `return ${cond};`);
      const limit = g.ticks + 120 * 600;
      while (!done(g) && g.state !== 'finished' && g.ticks < limit) tick(g, window.__driver(g));
      return { state: g.state, completed: g.laps.completed };
    }, condition);
    // Resize, then make sure the page's own resize handler (fitTitle) has run for the new size.
    const resizeTo = async (w, h) => {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForFunction(([ww, hh]) => innerWidth === ww && innerHeight === hh, [w, h], { polling: 20 });
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await frames(2);
    };
    const fit = (selector) => page.evaluate((sel) => {
      const overlay = document.querySelector(sel);
      const sheet = overlay.querySelector('.sheet') ?? overlay;
      const r = sheet.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight, scroll: overlay.scrollHeight - overlay.clientHeight };
    }, selector);
    const assertFits = async (selector, label) => {
      for (const [w, h] of SIZES) {
        await resizeTo(w, h);
        const f = await fit(selector);
        assert.ok(f.top >= 0 && f.bottom <= f.vh + 0.5 && f.left >= 0 && f.right <= f.vw + 0.5 && f.scroll <= 0, `${label} fits ${w}x${h}: ${JSON.stringify(f)}`);
        await page.screenshot({ path: artifact(`${name}-${label}-${w}x${h}.png`) });
      }
      await resizeTo(1366, 768);
    };

    // --- 1. Without the switch, nothing of the Tour is there -----------------------------------
    await page.goto(base);
    await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
    await frames(3);
    assert.equal(await page.locator('#tour-open').isVisible(), false);
    // Not merely hidden: no Tour element is in the live page at all (it waits in a <template>).
    assert.equal(await page.locator('#tour-open, #tour-hud, #tour-menu, #tour-round, #tour-result, #tour-final').count(), 0);
    assert.deepEqual(await page.locator('.title-menu button').evaluateAll((b) => b.map((x) => x.childNodes[0].textContent.trim())),
      ['Tracks', 'Gymkhana', 'Getaway', 'How to play', 'Options']);
    assert.equal((await tour()).research, false);
    assert.equal(await page.evaluate(() => document.body.dataset.research ?? null), null);
    await page.locator('#tracks-open').focus();
    await key('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'gymkhana', 'the title menu is unchanged');
    assert.equal(await stored(), null);
    step('without ?research=tour the title and storage are exactly as before');

    // --- 2. With it: the title, and the Tour sheet by keyboard -----------------------------------
    await page.goto(`${base}?research=tour`);
    await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
    await frames(3);
    assert.ok(await page.locator('#tour-open').isVisible());
    for (const [w, h] of SIZES) {
      await resizeTo(w, h);
      const col = await page.evaluate(() => ({ title: document.querySelector('.title').getBoundingClientRect().top,
        note: document.getElementById('analytics-note').getBoundingClientRect().bottom, vh: innerHeight }));
      assert.ok(col.title >= 0 && col.note <= col.vh + 0.5, `title column fits ${w}x${h}: ${JSON.stringify(col)}`);
      await page.screenshot({ path: artifact(`${name}-title-${w}x${h}.png`) });
    }
    await resizeTo(1366, 768);
    await page.locator('#tracks-open').focus();
    await key('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tour-open');
    await key('Enter');
    assert.equal((await tour()).picker, 'tour');
    assert.ok(await page.locator('#tour-menu').isVisible());
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tour-start');
    // Up and Down walk the stops; Left and Right change the focused choice.
    await key('ArrowDown'); // Back
    await key('ArrowDown'); // wraps to Length
    assert.equal(await page.evaluate(() => document.activeElement.name), 'tour-length');
    await key('ArrowRight');
    assert.equal((await tour()).choice.length, 'grand');
    await key('ArrowLeft');
    assert.equal((await tour()).choice.length, 'sprint');
    await key('ArrowDown');
    await key('ArrowRight');
    assert.equal((await tour()).choice.field, 'national');
    await key('ArrowLeft');
    await key('KeyH');
    assert.match(await page.locator('#tour-handling').textContent(), /^Power handling/);
    await key('KeyH');
    assert.match(await page.locator('#tour-handling').textContent(), /^Classic handling/);
    await assertFits('#tour-menu', 'menu');
    await key('Escape');
    assert.ok(await page.locator('#menu').isVisible());
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tour-open');
    step('the title button, the Tour sheet by keyboard (stops, choices, H for handling), Esc back; everything fits');

    // --- 3. Round 1 by mouse: the round sheet, the Joker, a free and a paid restart ----------------
    await page.locator('#tour-open').click();
    await frames(2);
    await page.locator('#tour-start').click();
    await frames(3);
    let t = await tour();
    assert.equal(t.screen, 'intro');
    assert.equal(t.live, true);
    assert.deepEqual(await page.evaluate(() => [window.__miniDrifters.game.state, window.__miniDrifters.game.paused, window.__miniDrifters.game.track.id]),
      ['ready', true, t.state.lineup[0]]);
    assert.equal(await page.locator('#tour-marks li').count(), 5);
    assert.equal(await page.locator('#paused').isVisible(), false);
    assert.match(await page.locator('#tour-round-eyebrow').textContent(), /Round 1 of 4/);
    const lineupText = await page.locator('#tour-lineup').textContent();
    const names = await page.evaluate((ids) => ids.map((id) => document.querySelector(`#tracks label[data-track="${id}"] .track-name`).textContent), t.state.lineup);
    for (const n of names) assert.ok(lineupText.includes(n), `the lineup names ${n}`);
    assert.match(await page.locator('#tour-stakes').textContent(), /win the round and you lead the Tour/i);
    await assertFits('#tour-round', 'intro');
    await page.locator('#tour-joker').click();
    await frames(2);
    assert.equal((await tour()).joker, true);
    assert.equal(await page.locator('#tour-joker').getAttribute('aria-pressed'), 'true');
    await page.locator('#tour-drive').click();
    await frames(2);
    assert.deepEqual(await page.evaluate(() => [window.__miniDrifters.game.paused, window.__miniDrifters.tour().screen]), [false, null]);
    // R on the grid is free.
    await key('KeyR');
    assert.equal((await tour()).state.restartsLeft, 2);
    // Once the car has moved, R uses one of the Tour's restarts.
    await drive('g.laps.completed >= 1');
    await frames(2);
    assert.equal((await tour()).driving, 0);
    assert.equal((await stored()).active.driving, 0, 'the store knows this round is being driven');
    assert.ok(await page.locator('#tour-hud').isVisible());
    const hud = await page.evaluate(() => {
      const g = window.__miniDrifters.game;
      const t = window.__miniDrifters.tour().state;
      const score = g.scoring.score - g.forfeited;
      return { shown: document.getElementById('tour-hud-place').textContent, expected: `P${t.marks[0].filter((m) => m.score >= score).length + 1}` };
    });
    assert.equal(hud.shown, hud.expected);
    await page.screenshot({ path: artifact(`${name}-hud.png`) });
    await key('KeyR');
    await frames(2);
    t = await tour();
    assert.equal(t.state.restartsLeft, 1);
    assert.equal(t.driving, null);
    assert.equal(await page.evaluate(() => window.__miniDrifters.game.state), 'ready');
    assert.match(await page.locator('#banner').textContent(), /RESTART — 1 LEFT/);
    assert.equal((await stored()).active.restartsLeft, 1);
    step('round sheet over the paused grid; the Joker; R free on the grid, paid once moving; the HUD place');

    // Drive the round out: the result, the points, and the ordinary circuit records.
    await drive("g.state === 'finished'");
    await frames(3);
    t = await tour();
    assert.equal(t.screen, 'result');
    assert.ok(await page.locator('#tour-result').isVisible());
    assert.equal(await page.locator('#results').isVisible(), false, 'the ordinary results sheet stays hidden');
    assert.equal(await page.locator('#tour-hud').isVisible(), false);
    const r1 = t.state.results[0];
    const runScore = await page.evaluate(() => window.__miniDrifters.game.results.score);
    assert.equal(r1.score, runScore);
    assert.equal(r1.joker, true);
    assert.equal(r1.points, SERIES_POINTS[r1.position - 1] * 2);
    const records = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), RECORDS_KEY);
    assert.equal(records.tracks[r1.trackId].classic.scoring['scoring-2'].score, runScore, 'a Tour round sets the ordinary circuit record');
    assert.equal((await stored()).active.round, 1);
    await assertFits('#tour-result', 'result');
    step(`round 1 scored ${runScore} (P${r1.position}, ${r1.points} points with the Joker) and set the ordinary circuit record`);

    // --- 4. Round 2: leave from the grid (free), continue, reload while driving (a restart) ----------
    await page.waitForTimeout(GUARD);
    await key('Enter');
    t = await tour();
    assert.equal(t.screen, 'intro');
    assert.equal(t.state.round, 1);
    assert.equal(await page.locator('#tour-joker').isVisible(), false, 'the Joker has been played');
    await key('Escape');
    t = await tour();
    assert.equal(t.picker, 'tour');
    assert.ok(await page.locator('#tour-continue').isVisible());
    assert.match(await page.locator('#tour-notice').textContent(), /Tour saved/);
    assert.equal(t.state.restartsLeft, 1, 'leaving from the grid costs nothing');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tour-resume');
    await key('Enter');
    assert.equal((await tour()).screen, 'intro');
    await page.waitForTimeout(GUARD);
    await key('Enter'); // Drive
    await drive('g.laps.completed >= 1');
    await frames(2);
    assert.equal((await stored()).active.driving, 1);
    await page.reload();
    await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
    await frames(3);
    await page.locator('#tour-open').click();
    await frames(2);
    await page.locator('#tour-resume').click();
    await frames(3);
    t = await tour();
    assert.equal(t.state.restartsLeft, 0, 'closing the page while driving used a restart');
    assert.equal(t.state.round, 1, 'and the round is driven again');
    assert.equal(t.screen, 'intro');
    step('leaving from the grid is free; a reload mid-round costs a restart on Continue');

    // --- 5. No restarts left: R refuses and Leave is a DNF; finish rounds 2 and 3 -------------------------
    await page.locator('#tour-drive').click();
    await frames(2);
    await drive('g.laps.completed >= 1');
    await frames(2);
    await key('KeyR');
    await frames(1);
    assert.match(await page.locator('#banner').textContent(), /NO RESTARTS LEFT/);
    assert.equal(await page.evaluate(() => window.__miniDrifters.game.laps.completed), 1, 'the run carries on');
    await key('KeyP');
    assert.ok(await page.locator('#paused').isVisible());
    assert.equal((await page.locator('#paused .return-title').textContent()).trim(), 'Leave (DNF)');
    assert.equal(await page.locator('#restart').isDisabled(), true);
    assert.match(await page.locator('#paused-note').textContent(), /DNF/);
    await page.screenshot({ path: artifact(`${name}-pause-no-restarts.png`) });
    await key('KeyP');
    await drive("g.state === 'finished'");
    await frames(3);
    assert.equal((await tour()).screen, 'result');
    await page.waitForTimeout(GUARD);
    await key('Enter');
    await page.waitForTimeout(GUARD);
    await key('Enter');
    await drive("g.state === 'finished'");
    await frames(3);
    assert.equal((await tour()).state.round, 3);
    step('with no restarts left, R refuses, Restart is disabled and leaving would be a DNF');

    // --- 6. Round 4 by controller, the final sheet, Rematch and Retire -----------------------------------
    await page.waitForTimeout(GUARD);
    await page.evaluate(() => { window.__padOn = true; window.__frames(3); });
    await page.evaluate(() => window.__pressPad(0)); // A: Next round
    await frames(2);
    assert.equal((await tour()).screen, 'intro');
    assert.match(await page.locator('#tour-stakes').textContent(), /^Final round: /);
    await page.screenshot({ path: artifact(`${name}-final-round-intro.png`) });
    await page.waitForTimeout(GUARD);
    await page.evaluate(() => window.__pressPad(0)); // A: Drive
    assert.equal((await tour()).screen, null);
    await page.evaluate(() => { window.__padOn = false; window.__frames(2); });
    await drive("g.state === 'finished'");
    await frames(3);
    t = await tour();
    assert.equal(t.screen, 'final');
    assert.equal(t.state.status, 'complete');
    const finalState = await stored();
    assert.equal(finalState.active, null);
    assert.equal(finalState.history[0].code, t.state.code);
    assert.equal(finalState.bests['series|sprint|club|classic'].finished, 1);
    const place = Number((await page.locator('#tour-final-standings li[data-player] .tour-place').textContent()).slice(1));
    assert.equal(finalState.history[0].outcome.place, place);
    assert.equal(await page.locator('#tour-final').getAttribute('data-trophy'), ['gold', 'silver', 'bronze'][place - 1] ?? '');
    assert.match(await page.locator('#tour-compare').textContent(), /raw total [\d,]+ · normalised [\d,]+/);
    await assertFits('#tour-final', 'final');
    // Rematch: the same circuits against the same posted scores.
    await page.waitForTimeout(GUARD);
    await key('Enter');
    const rematch = await tour();
    assert.equal(rematch.state.code, t.state.code);
    assert.deepEqual(rematch.state.lineup, t.state.lineup);
    assert.deepEqual(rematch.state.marks, t.state.marks);
    assert.equal(rematch.state.round, 0);
    await page.locator('#tour-round-leave').click();
    await frames(2);
    await page.locator('#tour-retire').click();
    await frames(2);
    const retired = await stored();
    assert.equal(retired.active, null);
    assert.equal(retired.history[0].status, 'retired');
    assert.equal(retired.bests['series|sprint|club|classic'].finished, 1, 'a retired Tour earns nothing');
    step(`round 4 by controller; finished P${place}, saved to history and bests; Rematch repeats the field; Retire`);

    // --- 7. Targets by controller on the sheet --------------------------------------------------------------
    await page.evaluate(() => { window.__padOn = true; window.__frames(3); });
    // The controller's stops on a sheet end with the Sound button, as on every sheet.
    for (const expected of ['tour-back', 'sound', 'tour-length', 'tour-field', 'tour-format']) {
      await page.evaluate(() => window.__pressPad(13)); // Down
      assert.equal(await page.evaluate(() => document.activeElement.id || document.activeElement.name), expected);
    }
    await page.evaluate(() => window.__pressPad(15)); // Right: Targets
    assert.equal((await tour()).choice.format, 'targets');
    await page.evaluate(() => window.__pressPad(13)); // Start
    await page.evaluate(() => window.__pressPad(0));
    await page.evaluate(() => { window.__padOn = false; window.__frames(2); });
    t = await tour();
    assert.equal(t.state.format, 'targets');
    assert.deepEqual(await page.locator('#tour-marks li .tour-name').allTextContents(), ['Gold', 'Silver', 'Bronze']);
    await page.locator('#tour-drive').click();
    await frames(2);
    await drive("g.state === 'finished'");
    await frames(3);
    t = await tour();
    const tr = t.state.results[0];
    const title = (await page.locator('#tour-result-title').textContent()).trim();
    assert.equal(title, tr.medal ? tr.medal[0].toUpperCase() + tr.medal.slice(1) : 'No medal');
    assert.equal(tr.points, { gold: 3, silver: 2, bronze: 1 }[tr.medal] ?? 0);
    await page.screenshot({ path: artifact(`${name}-targets-result.png`) });
    await page.waitForTimeout(GUARD);
    await key('Escape');
    assert.equal((await tour()).picker, 'tour');
    step(`Targets chosen by controller; round 1 earned ${tr.medal ?? 'no medal'} (${tr.points} ${tr.points === 1 ? 'point' : 'points'})`);

    // --- 8. Storage: the Tour's key and nobody else's --------------------------------------------------------
    const keys = await page.evaluate(() => Object.keys(localStorage));
    for (const k of keys) assert.ok(KNOWN_KEYS.has(k), `unexpected storage key ${k}`);
    assert.ok(keys.includes(TOUR_STORE_KEY));
    step(`storage keys: ${keys.sort().join(', ')}`);
    await context.close();

    // --- 9. Denied storage: the Tour still plays, and says so ------------------------------------------------
    const denied = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
    const page2 = await denied.newPage();
    watch(page2);
    await page2.addInitScript(installHarness, { denyStorage: true });
    await page2.goto(`${base}?research=tour`);
    await page2.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
    await page2.evaluate(() => window.__frames(3));
    await page2.locator('#tour-open').click();
    await page2.evaluate(() => window.__frames(2));
    await page2.locator('#tour-start').click();
    await page2.evaluate(() => window.__frames(2));
    await page2.locator('#tour-drive').click();
    await page2.evaluate(async () => {
      const { driftDriver } = await import(new URL('test/support/drivers.mjs', document.baseURI).href);
      const { tick } = await import(new URL('src/game.js', document.baseURI).href);
      const g = window.__miniDrifters.game;
      const d = driftDriver();
      while (g.state !== 'finished' && g.ticks < 120 * 600) tick(g, d(g));
      window.__frames(3);
    });
    assert.equal(await page2.evaluate(() => window.__miniDrifters.tour().screen), 'result');
    assert.match(await page2.locator('#tour-result-notes').textContent(), /could not be saved/);
    await denied.close();
    step('with storage denied the Tour plays on and says the round could not be saved');

    assert.deepEqual(errors, [], 'no page errors');
    assert.deepEqual(external, [], 'no request leaves the page');
    step('no page errors, no external requests');
  } finally {
    await browser.close();
  }
}

try {
  await run(chromium, 'chromium');
  await run(firefox, 'firefox');
  console.log('Circuit Tour browser checks passed.');
} finally {
  server.close();
}
