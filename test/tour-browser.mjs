// Circuit Tour (v0.9.0) in real browsers, Chromium and Firefox:
//   - a production mode: the title button is there with no URL switch, second after Tracks, and
//     the title column and every Tour sheet fit 1024x600, 1280x720, 1366x768 and 1920x1080
//   - the Tour sheet by keyboard, mouse and a mocked standard controller; handling changes there;
//     the Joker's rules card on the sheet
//   - whole rounds driven by the repo's scripted driver through the game's own tick(), so every
//     score is a real run: the Joker (available, selected, used; the points shown doubled and the
//     result's breakdown), a paid restart and a free one, leaving from the grid (free), a page
//     reload while driving (costs a restart), no restarts left (Leave becomes a DNF), the final
//     sheet, Rematch (same circuits and posted scores), the Joker toggled by keyboard and by
//     controller, and Retire
//   - the Joker's last chance and its locked state in the double-points final, from saved Tours
//   - a Tour round sets the ordinary circuit records; the Tour keeps its own key and touches no
//     other; an R2 research save is never read or changed; damaged data is set aside
//   - denied storage: the Tour still plays and says it cannot be saved
//   - no page errors and no request leaves the page
// Needs Playwright:  node test/tour-browser.mjs [/path/to/playwright/index.mjs]
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RECORDS_KEY } from '../src/records.js';
import { TOUR_STORE_KEY, RESEARCH_TOUR_KEY } from '../src/tour-store.js';
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
const SIZES = [[1024, 600], [1280, 720], [1366, 768], [1920, 1080]];
const GUARD = 560; // a Tour sheet that appears by itself ignores Enter and Space for 500 ms
const KNOWN_KEYS = new Set([RECORDS_KEY, 'mini-drifters-ghosts-v1', TOUR_STORE_KEY, RESEARCH_TOUR_KEY, 'mini-drifters-sound', 'mini-drifters-handling',
  'mini-drifters-audio', 'mini-drifters-ghost', 'mini-drifters-radio']);
const JOKER_HEADLINE = 'Double your championship points in one round. Choose wisely.';

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
    const focused = () => page.evaluate(() => document.activeElement.id || document.activeElement.name);
    const joker = () => page.evaluate(() => ({
      state: document.getElementById('tour-joker-panel').dataset.joker,
      badge: document.getElementById('tour-joker-badge').textContent,
      text: document.getElementById('tour-joker-text').textContent,
      button: !document.getElementById('tour-joker').hidden && document.getElementById('tour-joker').getClientRects().length > 0,
      label: document.getElementById('tour-joker').textContent,
      pressed: document.getElementById('tour-joker').getAttribute('aria-pressed'),
      head: document.getElementById('tour-marks-head').textContent,
      points: [...document.querySelectorAll('#tour-marks .tour-points')].map((el) => el.textContent),
    }));
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
    // Write a saved Tour straight into the Tour's key, keeping its history and bests.
    const saveActive = (build) => page.evaluate(async ([k, source]) => {
      const T = await import(new URL('src/tour.js', document.baseURI).href);
      const active = new Function('T', `return (${source})(T);`)(T);
      const cur = JSON.parse(localStorage.getItem(k) ?? 'null') ?? { version: 1, active: null, history: [], bests: {} };
      localStorage.setItem(k, JSON.stringify({ ...cur, active: { ...active, driving: null } }));
    }, [TOUR_STORE_KEY, build.toString()]);
    const reopenTourMenu = async () => {
      if (await page.locator('#tour-menu').isVisible()) await key('Escape');
      await page.locator('#tour-open').click();
      await frames(2);
    };

    // --- 1. A production mode: no URL switch, and a research save is ignored -------------------------
    await page.goto(base);
    await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
    await frames(3);
    assert.ok(await page.locator('#tour-open').isVisible(), 'Circuit Tour is on the title without ?research=tour');
    assert.deepEqual(await page.locator('.title-menu button').evaluateAll((b) => b.map((x) => x.childNodes[0].textContent.trim())),
      ['Tracks', 'Circuit Tour', 'Gymkhana', 'Getaway', 'How to play', 'Options']);
    assert.equal(await page.locator('template').count(), 0, 'nothing waits in a template');
    assert.equal(await page.evaluate(() => document.body.dataset.research ?? null), null);
    assert.equal(await stored(), null, 'nothing is written on load');
    // A save from the R2 research build stays where it is, and is never offered to continue.
    const research = JSON.stringify({ version: 1, active: { rules: 'tour-r2-1', format: 'series', seed: 7, code: '0000007', length: 'sprint', field: 'club', handling: 'classic',
      lineup: ['original', 'dockyard', 'switchback', 'runway-27'], marks: [], round: 0, results: [], restartsLeft: 2, jokerRound: null, finalDouble: true, status: 'active', driving: null }, history: [], bests: {} });
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [RESEARCH_TOUR_KEY, research]);
    await page.reload();
    await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
    await frames(3);
    for (const [w, h] of SIZES) {
      await resizeTo(w, h);
      const col = await page.evaluate(() => ({ title: document.querySelector('.title').getBoundingClientRect().top,
        note: document.getElementById('analytics-note').getBoundingClientRect().bottom, vh: innerHeight,
        tour: document.getElementById('tour-open').getBoundingClientRect().right, half: innerWidth / 2 }));
      assert.ok(col.title >= 0 && col.note <= col.vh + 0.5 && col.tour <= col.half, `title column fits ${w}x${h}: ${JSON.stringify(col)}`);
      await page.screenshot({ path: artifact(`${name}-title-${w}x${h}.png`) });
    }
    await resizeTo(1366, 768);
    step('Circuit Tour is a title button with no URL switch, second after Tracks; the title fits every size');

    // --- 2. The Tour sheet by keyboard, and the Joker's rules card ---------------------------------
    await page.locator('#tracks-open').focus();
    await key('ArrowDown');
    assert.equal(await focused(), 'tour-open');
    await key('Enter');
    assert.equal((await tour()).picker, 'tour');
    assert.ok(await page.locator('#tour-menu').isVisible());
    assert.equal(await focused(), 'tour-start');
    assert.equal(await page.locator('#tour-continue').isVisible(), false, 'the research save is not offered');
    assert.equal((await page.locator('#tour-notice').textContent()).trim(), '', 'nor reported as set aside');
    assert.equal(await page.locator('#tour-formats, #tour-compare').count(), 0, 'no research Scoring choice');
    assert.ok(await page.locator('#tour-joker-rules').isVisible());
    const rules = await page.locator('#tour-joker-rules').innerText();
    assert.ok(rules.includes(JOKER_HEADLINE), rules);
    assert.match(rules, /One per Tour\. Play it on a round.s sheet before you drive, in any round but the final, which already counts double for everyone\. Save it for a circuit you.re strong on\./);
    assert.match(await page.locator('#tour-choice-note').textContent(), /Places score 10-7-5-3-2-1, and the final round counts double for everyone\. 2 restarts for the whole Tour\./);
    // Up and Down walk the stops; Left and Right change the focused choice.
    await key('ArrowDown'); // Back
    await key('ArrowDown'); // wraps to Length
    assert.equal(await focused(), 'tour-length');
    await key('ArrowRight');
    assert.equal((await tour()).choice.length, 'grand');
    assert.match(await page.locator('#tour-choice-note').textContent(), /^7 circuits.*3 restarts/);
    await key('ArrowLeft');
    assert.equal((await tour()).choice.length, 'sprint');
    await key('ArrowDown');
    assert.equal(await focused(), 'tour-field');
    await key('ArrowRight');
    assert.equal((await tour()).choice.field, 'national');
    await key('ArrowLeft');
    await key('ArrowDown');
    assert.equal(await focused(), 'tour-start', 'Length, Field, Start, Back: no Scoring stop');
    await key('KeyH');
    assert.match(await page.locator('#tour-handling').textContent(), /^Power handling/);
    await key('KeyH');
    assert.match(await page.locator('#tour-handling').textContent(), /^Classic handling/);
    await assertFits('#tour-menu', 'menu');
    await key('Escape');
    assert.ok(await page.locator('#menu').isVisible());
    assert.equal(await focused(), 'tour-open');
    step('the Tour sheet by keyboard (Length, Field, Start, Back; H for handling), the Joker rules card, Esc back; it fits');

    // --- 3. Round 1 by mouse: the Joker, a free and a paid restart ------------------------------------
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
    let j = await joker();
    assert.deepEqual([j.state, j.badge, j.button, j.label, j.pressed], ['available', 'Joker available', true, 'Play Joker', 'false']);
    assert.match(j.text, /^Play it to double your points in this round: a win would score 20 instead of 10\. One per Tour, never in the final\./);
    assert.deepEqual(j.points, SERIES_POINTS.slice(0, 5).map((p) => `${p} pts`.replace(/^1 pts$/, '1 pt')));
    await assertFits('#tour-round', 'intro');
    await page.locator('#tour-joker').click();
    await frames(2);
    assert.equal((await tour()).joker, true);
    j = await joker();
    assert.deepEqual([j.state, j.badge, j.label, j.pressed], ['selected', 'Joker selected ×2', 'Joker selected ×2', 'true']);
    assert.equal(j.head, 'Scores to beat · your points ×2');
    assert.deepEqual(j.points, SERIES_POINTS.slice(0, 5).map((p) => `${p * 2} pts`), 'the points column shows what each place is worth with the Joker');
    assert.match(j.text, /^Your points this round are doubled\. It is spent when you finish the round; leave the round and you keep it\./);
    await assertFits('#tour-round', 'intro-joker-selected');
    await page.screenshot({ path: artifact(`${name}-joker-selected.png`) });
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
    assert.match(await page.locator('#tour-hud-round').textContent(), /^Round 1\/4 · Joker ×2$/);
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
    assert.equal(t.joker, true, 'a restart keeps the Joker selected for the round');
    assert.equal(t.state.jokerRound, null, 'and it is not spent yet');
    assert.equal(await page.evaluate(() => window.__miniDrifters.game.state), 'ready');
    assert.match(await page.locator('#banner').textContent(), /RESTART — 1 LEFT/);
    assert.equal((await stored()).active.restartsLeft, 1);
    step('round sheet over the paused grid; the Joker available then selected (points ×2); R free on the grid, paid once moving; the HUD');

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
    assert.equal(t.state.jokerRound, 0);
    assert.equal(r1.points, SERIES_POINTS[r1.position - 1] * 2);
    const placePts = SERIES_POINTS[r1.position - 1];
    const ptsText = (n) => (n === 1 ? '1 pt' : `${n} pts`);
    assert.ok((await page.locator('#tour-result-line').textContent()).endsWith(`· P${r1.position} = ${ptsText(placePts)} × 2 Joker = ${ptsText(placePts * 2)}`));
    assert.match(await page.locator('#tour-result-notes').textContent(), new RegExp(`^Joker played: your ${ptsText(placePts)} for P${r1.position} became ${ptsText(placePts * 2)}\\. It is used for the rest of the Tour\\.`));
    assert.deepEqual(await page.locator('#tour-result-round li[data-player]').evaluate((li) => [li.dataset.joker, li.querySelector('.tour-points').textContent, li.querySelector('.tour-move').textContent]),
      ['true', `+${placePts * 2}`, '×2']);
    const records = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), RECORDS_KEY);
    assert.equal(records.tracks[r1.trackId].classic.scoring['scoring-2'].score, runScore, 'a Tour round sets the ordinary circuit record');
    assert.equal((await stored()).active.round, 1);
    assert.equal((await stored()).active.jokerRound, 0, 'the played Joker is saved');
    await page.screenshot({ path: artifact(`${name}-joker-result.png`) });
    await assertFits('#tour-result', 'result');
    step(`round 1 scored ${runScore} (P${r1.position}: ${placePts} × 2 Joker = ${r1.points}), explained on the result, and set the ordinary circuit record`);

    // --- 4. Round 2: the Joker used; leave from the grid (free), continue, reload while driving -------
    await page.waitForTimeout(GUARD);
    await key('Enter');
    t = await tour();
    assert.equal(t.screen, 'intro');
    assert.equal(t.state.round, 1);
    j = await joker();
    assert.deepEqual([j.state, j.badge, j.button], ['used', 'Joker used', false]);
    assert.match(j.text, new RegExp(`^Played in round 1 \\(.+: ${ptsText(placePts)} → ${ptsText(placePts * 2)}\\)\\.$`));
    assert.equal(j.head, 'Scores to beat');
    await page.screenshot({ path: artifact(`${name}-joker-used.png`) });
    await key('Escape');
    t = await tour();
    assert.equal(t.picker, 'tour');
    assert.ok(await page.locator('#tour-continue').isVisible());
    assert.match(await page.locator('#tour-continue-text').textContent(), /Round 2 of 4: .+\. P\d on \d+ pts?\. Joker used in round 1 \(/);
    assert.match(await page.locator('#tour-notice').textContent(), /Tour saved/);
    assert.equal(t.state.restartsLeft, 1, 'leaving from the grid costs nothing');
    assert.equal(await focused(), 'tour-resume');
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
    assert.equal(t.state.jokerRound, 0, 'the Joker stays played across the reload');
    assert.equal(t.screen, 'intro');
    step('the Joker shows as used; leaving from the grid is free; a reload mid-round costs a restart on Continue');

    // --- 5. No restarts left: R refuses and Leave is a DNF; finish rounds 2 and 3 ---------------------
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
    assert.doesNotMatch(await page.locator('#tour-result-line').textContent(), /Joker/, 'only the Joker round shows it');
    await page.waitForTimeout(GUARD);
    await key('Enter');
    await page.waitForTimeout(GUARD);
    await key('Enter');
    await drive("g.state === 'finished'");
    await frames(3);
    assert.equal((await tour()).state.round, 3);
    assert.match(await page.locator('#tour-result-notes').textContent(), /Next: .+, the double-points final\./);
    step('with no restarts left, R refuses, Restart is disabled and leaving would be a DNF');

    // --- 6. Round 4 by controller, the final sheet, Rematch, the Joker by keyboard and controller -------
    await page.waitForTimeout(GUARD);
    await page.evaluate(() => { window.__padOn = true; window.__frames(3); });
    await page.evaluate(() => window.__pressPad(0)); // A: Next round
    await frames(2);
    assert.equal((await tour()).screen, 'intro');
    assert.match(await page.locator('#tour-stakes').textContent(), /^Final round: /);
    assert.match(await page.locator('#tour-round-eyebrow').textContent(), /Round 4 of 4 · Final round · double points$/);
    assert.deepEqual(await joker().then((x) => x.points), SERIES_POINTS.slice(0, 5).map((p) => `${p * 2} pts`), 'the final shows double points for every place');
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
    const r4 = t.state.results[3];
    assert.equal(r4.points, SERIES_POINTS[r4.position - 1] * 2, 'the final counted double');
    const finalState = await stored();
    assert.equal(finalState.active, null);
    assert.equal(finalState.history[0].code, t.state.code);
    assert.equal(finalState.bests['sprint|club|classic'].finished, 1);
    const place = Number((await page.locator('#tour-final-standings li[data-player] .tour-place').textContent()).slice(1));
    assert.equal(finalState.history[0].outcome.place, place);
    assert.equal(await page.locator('#tour-final').getAttribute('data-trophy'), ['gold', 'silver', 'bronze'][place - 1] ?? '');
    assert.match(await page.locator('#tour-final-best').textContent(), /Joker used in round 1 \(/);
    assert.equal(await page.locator('#tour-final-rounds li[data-joker]').count(), 1);
    await assertFits('#tour-final', 'final');
    // Rematch: the same circuits against the same posted scores, and a fresh Joker.
    await page.waitForTimeout(GUARD);
    await key('Enter');
    const rematch = await tour();
    assert.equal(rematch.state.code, t.state.code);
    assert.deepEqual(rematch.state.lineup, t.state.lineup);
    assert.deepEqual(rematch.state.marks, t.state.marks);
    assert.equal(rematch.state.round, 0);
    assert.equal(rematch.state.jokerRound, null);
    assert.equal(rematch.state.restartsLeft, 2);
    assert.equal((await joker()).state, 'available');
    // The Joker by keyboard: Down to it, Enter to select, Enter again to take it back.
    await page.waitForTimeout(GUARD);
    await page.locator('#tour-drive').focus();
    await key('ArrowDown');
    assert.equal(await focused(), 'tour-joker');
    await key('Enter');
    assert.deepEqual([(await tour()).joker, (await joker()).state], [true, 'selected']);
    assert.equal(await focused(), 'tour-joker', 'the focus stays on the Joker');
    await key('Enter');
    assert.deepEqual([(await tour()).joker, (await joker()).state], [false, 'available']);
    // And by controller: Down to it, A to select, A to take it back.
    await page.locator('#tour-drive').focus();
    await page.evaluate(() => { window.__padOn = true; window.__frames(3); });
    await page.evaluate(() => window.__pressPad(13)); // Down
    assert.equal(await focused(), 'tour-joker');
    await page.evaluate(() => window.__pressPad(0));
    assert.deepEqual([(await tour()).joker, (await joker()).state], [true, 'selected']);
    await page.evaluate(() => window.__pressPad(0));
    assert.deepEqual([(await tour()).joker, (await joker()).state], [false, 'available']);
    await page.evaluate(() => { window.__padOn = false; window.__frames(2); });
    await page.locator('#tour-round-leave').click();
    await frames(2);
    assert.match(await page.locator('#tour-continue-text').textContent(), /Joker available\.$/);
    await page.locator('#tour-retire').click();
    await frames(2);
    const retired = await stored();
    assert.equal(retired.active, null);
    assert.equal(retired.history[0].status, 'retired');
    assert.equal(retired.bests['sprint|club|classic'].finished, 1, 'a retired Tour earns nothing');
    step(`round 4 by controller counted double; finished P${place}; Rematch repeats the field with a fresh Joker; the Joker toggles by keyboard and controller; Retire`);

    // --- 7. The Joker's last chance, and locked in the double-points final, from saved Tours -----------
    await saveActive((T) => [0, 1].reduce((x) => T.recordRound(x, { score: 0 }), T.createTour({ seed: 4242 })));
    await reopenTourMenu();
    await page.locator('#tour-resume').click();
    await frames(3);
    j = await joker();
    assert.deepEqual([j.state, j.badge, j.button], ['available', 'Joker · last chance', true]);
    assert.match(j.text, /The final counts double already, so this is the last round it can be played\.$/);
    await page.screenshot({ path: artifact(`${name}-joker-last-chance.png`) });
    await key('Escape');
    await saveActive((T) => [0, 1, 2].reduce((x) => T.recordRound(x, { score: 0 }), T.createTour({ seed: 4242 })));
    await reopenTourMenu();
    await page.locator('#tour-resume').click();
    await frames(3);
    j = await joker();
    assert.deepEqual([j.state, j.badge, j.button], ['locked', 'Joker unused', false]);
    assert.equal(j.text, 'The final already counts double for everyone, so the Joker cannot be played here.');
    await page.screenshot({ path: artifact(`${name}-joker-locked-final.png`) });
    await assertFits('#tour-round', 'intro-final');
    await key('Escape');
    await page.locator('#tour-retire').click();
    await frames(2);
    step('a saved Tour shows the Joker\'s last chance before the final, and locks it in the final');

    // --- 8. Storage: damaged data, the Tour's key and nobody else's, the research save untouched -------
    await page.evaluate((k) => localStorage.setItem(k, '{not json'), TOUR_STORE_KEY);
    await reopenTourMenu();
    assert.equal(await page.locator('#tour-continue').isVisible(), false);
    await page.locator('#tour-start').click();
    await frames(3);
    assert.equal((await tour()).screen, 'intro');
    assert.equal((await stored()).version, 1, 'damaged data is replaced by the next Tour');
    await key('Escape');
    await page.locator('#tour-retire').click();
    await frames(2);
    const keys = await page.evaluate(() => Object.keys(localStorage));
    for (const k of keys) assert.ok(KNOWN_KEYS.has(k), `unexpected storage key ${k}`);
    assert.ok(keys.includes(TOUR_STORE_KEY));
    assert.equal(await page.evaluate((k) => localStorage.getItem(k), RESEARCH_TOUR_KEY), research, 'the research save is untouched');
    step(`damaged data is set aside; storage keys: ${keys.sort().join(', ')}`);
    await context.close();

    // --- 9. Denied storage: the Tour still plays, and says so -----------------------------------------
    const denied = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
    const page2 = await denied.newPage();
    watch(page2);
    await page2.addInitScript(installHarness, { denyStorage: true });
    await page2.goto(base);
    await page2.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
    await page2.evaluate(() => window.__frames(3));
    await page2.locator('#tour-open').click();
    await page2.evaluate(() => window.__frames(2));
    await page2.locator('#tour-start').click();
    await page2.evaluate(() => window.__frames(2));
    // The first write fails as the Tour starts: back on the sheet, it says so, and the Tour is
    // still there to continue in this window.
    await page2.keyboard.press('Escape');
    await page2.evaluate(() => window.__frames(2));
    assert.match(await page2.locator('#tour-store-note').textContent(), /Tour storage is unavailable: a Tour can be driven, but not saved or resumed\./);
    assert.ok(await page2.locator('#tour-continue').isVisible());
    await page2.locator('#tour-resume').click();
    await page2.evaluate(() => window.__frames(2));
    await page2.locator('#tour-joker').click();
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
    assert.equal(await page2.evaluate(() => window.__miniDrifters.tour().state.jokerRound), 0, 'the Joker still counts in this window');
    await denied.close();
    step('with storage denied the Tour plays on, the Joker still counts, and it says the round could not be saved');

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
