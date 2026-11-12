// Handling modes and the practice pad in Chromium and Firefox, on the real page: the two public
// modes (Classic, and Power with the stable id `revised`); choosing a mode with keyboard, mouse
// and a mocked controller; the last choice remembered across reloads, and anything else falling
// back to Classic; mode identity through start, restart, Drive again and return to the title;
// the practice pad; the lesson driving Classic without touching the choice; records kept apart
// by track and mode; the migration of a v0.2.0 save; a later schema left alone; storage that
// can't be opened; and the physics lab's query parameters doing nothing. Only the Gamepad API and the frame clock are mocked. Every origin
// here is a throwaway one on a random port, so no real save is ever touched.
//   node test/handling-browser.mjs /path/to/playwright/index.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
await mkdir(new URL('artifacts/', root), { recursive: true });
const shot = (name) => fileURLToPath(new URL(`artifacts/handling-${name}.png`, root));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!/^(index\.html|style\.css|src\/[\w-]+\.js|test\/support\/drivers\.mjs|(?:audio-lab\/assets|radio)\/[\w/.-]+)$/.test(file) || file.includes('..')) {
    res.writeHead(404); res.end(); return;
  }
  try { const data = await readFile(new URL(file, root)); res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/plain' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const KEY = 'mini-drifters-records-v2';
const LEGACY_KEY = 'mini-drifters-records';
const PREF_KEY = 'mini-drifters-handling';
// A v0.2.0 save as v0.2.0 writes it: one real zero, and records missing on purpose.
const V020 = JSON.stringify({ version: 1, tracks: {
  original: { score: 15420, fastestLap: 47.31, bestCombo: 0 },
  switchback: { score: null, fastestLap: 52.08, bestCombo: null },
} });

async function check(name, engine) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const ok = (message) => console.log(`${name}: ${message}`);
  await page.addInitScript(() => {
    localStorage.setItem('mini-drifters-sound', 'off');
    window.__writes = [];
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { window.__writes.push(k); return set.call(this, k, v); };
    window.__pads = [];
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__pads });
    window.requestAnimationFrame = (callback) => { window.__nextFrame = callback; return 1; };
    let now;
    window.__frames = (count = 2, dt = 1000 / 60) => {
      now ??= performance.now();
      for (let i = 0; i < count; i++) { now += dt; window.__nextFrame(now); }
    };
    window.__newPad = () => ({ index: 0, id: 'Mock', mapping: 'standard', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })) });
    // Drives with one of the test drivers, deciding from the live game, until `until` or the cap.
    window.__drive = async (driverName, untilState, maxSeconds) => {
      const drivers = await import('/test/support/drivers.mjs');
      const m = window.__miniDrifters;
      const driver = drivers[driverName]();
      const cap = maxSeconds * 60;
      for (let i = 0; i < cap && m.game.state !== untilState; i++) {
        Object.assign(m.input, driver(m.game));
        window.__frames(1);
      }
      for (const k of Object.keys(m.input)) m.input[k] = false;
      window.__frames(1);
      return m.game.state;
    };
  });
  const open = async (query = '') => {
    await page.goto(`${base}${query}`);
    await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
    await page.evaluate(() => window.__frames(2));
  };
  const value = (fn, arg) => page.evaluate(fn, arg);
  const frames = (n = 2) => value((k) => window.__frames(k), n);
  const focused = () => value(() => document.activeElement.id || document.activeElement.value || document.activeElement.className);
  const status = () => value(() => {
    const m = window.__miniDrifters;
    return {
      selected: m.selectedHandling(), track: m.selectedTrack(), state: m.game.state, handling: m.game.handling.id, kind: m.sessionKind(),
      checked: [...document.querySelectorAll('#handlings input')].filter((i) => i.checked).map((i) => i.value).join(),
      heading: document.getElementById('records-heading').textContent, summary: document.getElementById('handling-summary').textContent,
      chip: document.getElementById('handling-status').textContent, gameTrack: m.game.track.id, ticks: m.game.ticks,
      wheelspin: m.game.car.wheelspin ?? null, ghost: m.game.ghost ? m.game.ghost.rules : null,
    };
  });
  const visible = (sel) => page.locator(sel).first().isVisible();
  const shown = (sel) => value((s) => { const el = document.querySelector(s); return !!el && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0; }, sel);
  const press = async (index) => {
    await value((i) => { window.__pads[0].buttons[i] = { value: 1, pressed: true }; window.__frames(); }, index);
    await value((i) => { window.__pads[0].buttons[i] = { value: 0, pressed: false }; window.__frames(); }, index);
  };
  // Record writes. Sound settings and the remembered handling mode are checked on their own.
  const writes = () => value((pref) => [...new Set(window.__writes.filter((k) => k !== 'mini-drifters-sound' && k !== pref && !k.startsWith('mini-drifters-radio') && !k.startsWith('mini-drifters-audio')))], PREF_KEY);
  const prefWrites = () => value((pref) => window.__writes.filter((k) => k === pref).length, PREF_KEY);
  const pref = () => value((k) => localStorage.getItem(k), PREF_KEY);
  const records = (key = KEY) => value((k) => JSON.parse(localStorage.getItem(k)), key);
  // Ghost identities ("rules") for each mode, as the page's own ghost module computes them.
  const identities = () => value(async () => {
    const [{ createGhost }, { HANDLING_MODES }] = await Promise.all([import('/src/ghost.js'), import('/src/handling.js')]);
    const track = window.__miniDrifters.game.track;
    return Object.fromEntries(HANDLING_MODES.map((m) => [m.id, createGhost(track, m.tuning).rules]));
  });

  try {
    // --- 1. The title -----------------------------------------------------------------
    await open();
    let s = await status();
    assert.equal(s.selected, 'classic', 'a first visit starts on Classic');
    assert.equal(s.checked, 'classic');
    assert.match(s.heading, /^Original · Classic — Personal bests$/);
    assert.equal(s.summary, 'Familiar, handbrake-focused drifting with forgiving handling.');
    assert.deepEqual(await page.locator('#handlings label').allTextContents(), ['Classic', 'Power'], 'only the two public modes');
    assert.deepEqual(await page.locator('#handlings input').evaluateAll((i) => i.map((x) => x.value)), ['classic', 'revised'], 'Power keeps the id revised');
    assert.equal(await pref(), null, 'a first visit saves no preference just by loading');
    assert.deepEqual(await page.locator('.title-menu button').evaluateAll((b) => b.map((x) => x.childNodes[0].textContent.trim())), ['Start driving', 'Practice pad', 'How to play', 'Options']);
    for (const [w, h] of [[1920, 1080], [1366, 768], [1024, 600]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(150); // the resize event that refits the title, as menus-browser waits
      await frames();
      const fit = await value(() => {
        const menu = document.getElementById('menu');
        const parts = [...document.querySelectorAll('.title, .track-select, .handling-select, .handling-summary, .personal-bests, .title-menu button, #controller-note')];
        const out = parts.filter((el) => { const r = el.getBoundingClientRect(); return r.left < 0 || r.top < 0 || r.right > innerWidth / 2 || r.bottom > innerHeight; }).map((el) => el.className || el.id);
        const labels = [...document.querySelectorAll('#handlings label')].every((l) => { const r = l.getBoundingClientRect(); return l.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); });
        return { scrolls: menu.scrollHeight > menu.clientHeight, out, labels };
      });
      assert.equal(fit.scrolls, false, `title scrolls at ${w}x${h}`);
      assert.deepEqual(fit.out, [], `parts leave the left half at ${w}x${h}`);
      assert.ok(fit.labels, `every mode can be clicked at ${w}x${h}`);
      await page.screenshot({ path: shot(`${name}-title-${w}x${h}`) });
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await frames();
    ok('title: Classic and Power only, Classic chosen, menu and records heading name the mode, fits 1024x600 to 1920x1080');

    // --- 2. Keyboard ------------------------------------------------------------------
    assert.equal(await focused(), 'start');
    await page.keyboard.press('KeyH');
    s = await status();
    assert.equal(s.selected, 'revised');
    assert.match(s.heading, /Original · Power/);
    assert.equal(s.summary, 'Break rear traction with throttle. More control, more consequences.');
    assert.equal(await focused(), 'start', 'H changes the mode without moving focus');
    assert.equal(await pref(), 'revised', 'and the choice is saved');
    await page.keyboard.press('Shift+KeyH');
    assert.equal((await status()).selected, 'classic', 'Shift+H goes back');
    await page.keyboard.press('ArrowUp');
    assert.equal(await focused(), 'classic', 'Up from Start reaches the handling choice');
    await page.keyboard.press('ArrowRight');
    s = await status();
    assert.equal(s.selected, 'revised', 'Right on the handling choice changes the mode...');
    assert.equal(s.track, 'original', '...and not the track');
    assert.equal(await focused(), 'revised', 'focus follows the choice');
    await page.keyboard.press('ArrowRight');
    assert.equal((await status()).selected, 'classic', 'wraps');
    await page.keyboard.press('ArrowLeft');
    assert.equal((await status()).selected, 'revised', 'wraps backwards');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(), 'start');
    await page.keyboard.press('ArrowRight');
    s = await status();
    assert.equal(s.track, 'switchback', 'away from the handling choice, Left/Right still change the track');
    assert.equal(s.selected, 'revised');
    assert.match(s.heading, /^Switchback · Power/);
    await page.keyboard.press('ArrowLeft');
    assert.deepEqual(await value(() => window.__miniDrifters.game.ticks), 0, 'no keys drove the car on the title');
    ok('keyboard: H / Shift+H, Up to the choice, Left/Right on it, track keys unchanged elsewhere');

    // --- 3. Mouse -----------------------------------------------------------------------
    await page.locator('#handlings label', { hasText: 'Power' }).click();
    assert.equal((await status()).selected, 'revised');
    assert.equal(await pref(), 'revised');
    await page.locator('#handlings label', { hasText: 'Classic' }).click();
    assert.equal((await status()).selected, 'classic');
    assert.equal(await pref(), 'classic', 'choosing Classic again replaces the saved choice');
    ok('mouse: clicking a mode selects and saves it');

    // --- 4. A run keeps its mode ----------------------------------------------------------
    await page.keyboard.press('KeyH'); // Power
    await page.locator('#start').focus();
    await page.keyboard.press('Enter');
    await frames();
    s = await status();
    assert.equal(s.state, 'ready');
    assert.equal(s.handling, 'revised');
    assert.equal(s.kind, 'normal');
    assert.equal(s.chip, 'Power');
    const ids = await identities();
    assert.deepEqual(Object.keys(ids), ['classic', 'revised']);
    assert.equal(new Set(Object.values(ids)).size, 2, 'each mode has its own ghost identity');
    assert.equal(s.ghost, ids.revised, 'the ghost belongs to Power');
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowRight');
    await frames(150);
    const savedWhileDriving = await prefWrites();
    await page.keyboard.press('KeyH'); // ignored: not on the title
    assert.equal(await prefWrites(), savedWhileDriving, 'H while driving saves nothing');
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowUp');
    s = await status();
    assert.equal(s.state, 'racing');
    assert.equal(s.selected, 'revised');
    assert.equal(s.handling, 'revised');
    assert.equal(typeof s.wheelspin, 'number', 'the Power (Revised) model is running');
    await page.screenshot({ path: shot(`${name}-revised-run`) });
    await page.keyboard.press('KeyR');
    await frames();
    s = await status();
    assert.equal(s.state, 'ready');
    assert.equal(s.handling, 'revised', 'R keeps the mode');
    assert.equal(await value(() => window.__miniDrifters.game.runTime), 0, 'the run starts over');
    // Pause, return to the title, change the mode, start again.
    await page.keyboard.press('KeyP');
    await frames();
    await page.locator('#paused .return-title').click();
    await frames();
    assert.equal((await status()).state, 'menu');
    await page.locator('#handlings label', { hasText: 'Classic' }).click();
    await page.locator('#start').click();
    await frames();
    s = await status();
    assert.equal(s.handling, 'classic');
    assert.equal(s.chip, 'Classic');
    assert.equal(s.wheelspin, null, 'no wheelspin state carried over from Power');
    assert.equal(s.ghost, ids.classic, 'a fresh ghost, for Classic');
    assert.equal(await value(() => window.__miniDrifters.game.ghost.replay), null);
    await page.keyboard.press('KeyP');
    await page.locator('#paused .return-title').click();
    await frames();
    ok('a run takes the chosen mode, keeps it through R, ignores H, and the title can change it');

    // --- 5. Practice pad ------------------------------------------------------------------
    await page.locator('#handlings label', { hasText: 'Power' }).click();
    const before = await writes();
    await page.locator('#practice').click();
    await frames();
    s = await status();
    assert.deepEqual([s.kind, s.gameTrack, s.handling, s.state, s.ghost], ['practice', 'practice-pad', 'revised', 'ready', null]);
    assert.equal(s.chip, 'Practice · Power');
    assert.equal(await value(() => document.body.dataset.session), 'practice');
    for (const sel of ['#hud .laps', '#hud .score', '#combo', '#ghost-status']) assert.equal(await shown(sel), false, `${sel} is hidden on the pad`);
    for (const sel of ['#hud .gauges', '#handling-status']) assert.equal(await shown(sel), true, `${sel} shows on the pad`);
    assert.match(await page.locator('#prompt').textContent(), /Practice pad · Power.*nothing is timed or saved/);
    const start = await value(() => [window.__miniDrifters.game.car.x, window.__miniDrifters.game.car.y]);
    await page.keyboard.down('ArrowUp');
    await frames(90);
    await page.keyboard.down('ArrowRight');
    await frames(240);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowUp');
    s = await status();
    assert.equal(s.state, 'racing');
    assert.equal(await shown('#prompt'), false, 'no prompt or warning once driving');
    const moved = await value(() => [window.__miniDrifters.game.car.x, window.__miniDrifters.game.car.y, window.__miniDrifters.game.laps.completed + window.__miniDrifters.game.laps.voided]);
    assert.ok(Math.hypot(moved[0] - start[0], moved[1] - start[1]) > 20, 'the car was driven');
    assert.equal(moved[2], 0);
    assert.deepEqual(await value(() => { const g = window.__miniDrifters.game; return [g.scoring.score, g.scoring.spinouts, g.scoring.eventSerial, g.mode]; }), [0, 0, 0, 'practice'], 'nothing is scored on the pad');
    await page.screenshot({ path: shot(`${name}-pad`) });
    await page.keyboard.press('KeyP');
    await frames();
    assert.ok(await visible('#paused'));
    assert.match(await page.locator('#paused-note').textContent(), /Practice pad/);
    await page.keyboard.press('KeyP');
    await page.keyboard.press('KeyR');
    await frames();
    s = await status();
    assert.deepEqual([s.state, s.kind, s.handling, s.gameTrack, s.ghost], ['ready', 'practice', 'revised', 'practice-pad', null], 'R puts the car back on the pad');
    assert.deepEqual(await value(() => [window.__miniDrifters.game.car.x, window.__miniDrifters.game.car.y]), start);
    await page.keyboard.down('ArrowUp'); await frames(60); await page.keyboard.up('ArrowUp');
    await page.keyboard.press('Escape');
    await frames();
    assert.equal((await status()).state, 'menu', 'Esc leaves the pad');
    assert.deepEqual(await writes(), before, 'the pad wrote nothing');
    assert.equal(await records(), null, 'and no records exist');
    // Keyboard only: Down from Start, then Enter or Space, opens the pad (Enter once started a circuit run).
    for (const key of ['Enter', 'Space']) {
      await page.locator('#start').focus();
      await page.keyboard.press('ArrowDown');
      assert.equal(await focused(), 'practice');
      await page.keyboard.press(key);
      await frames();
      s = await status();
      assert.deepEqual([s.kind, s.gameTrack, s.handling], ['practice', 'practice-pad', 'revised'], `${key} on Practice pad opens the pad`);
      await page.keyboard.press('Escape');
      await frames();
      assert.equal((await status()).state, 'menu');
    }
    assert.deepEqual(await writes(), before, 'still nothing written');
    ok('practice pad: selected mode, laps/score/ghost hidden, drives, pause, R reset, Esc to title, Enter/Space/click open it, no writes');

    // --- 5b. The lesson always drives Classic, and leaves the choice alone -----------------
    assert.equal((await status()).selected, 'revised');
    assert.equal(await pref(), 'revised');
    const prefBefore = await prefWrites();
    await page.locator('#how-to-play').click();
    // How to Play says so beside the button that starts the lesson, and describes both modes.
    assert.ok(await visible('#lesson-handling'));
    assert.equal(await page.locator('#lesson-handling').textContent(), 'The driving lesson uses Classic handling.');
    assert.match(await page.locator('#help').innerText(), /With Power handling, the throttle can also break the rear loose/);
    await page.screenshot({ path: shot(`${name}-how-to-play`) });
    await page.locator('#help-try').click();
    await frames();
    s = await status();
    assert.deepEqual([s.kind, s.handling, s.chip, s.selected, s.wheelspin], ['tutorial', 'classic', 'Classic', 'revised', null], 'the lesson is Classic, and the HUD says so');
    await page.keyboard.down('ArrowUp'); await frames(60); await page.keyboard.up('ArrowUp');
    assert.equal((await status()).wheelspin, null, 'still Classic once driving');
    await page.keyboard.press('Escape');
    await frames();
    s = await status();
    assert.deepEqual([s.state, s.selected, s.checked], ['menu', 'revised', 'revised'], 'the title still has Power chosen');
    assert.match(s.heading, /Original · Power/);
    assert.equal(await pref(), 'revised', 'the saved choice is untouched');
    assert.equal(await prefWrites(), prefBefore, 'the lesson saved no preference');
    assert.deepEqual(await writes(), before, 'and no records');
    // The next circuit run drives the chosen mode again.
    await page.locator('#start').focus();
    await page.keyboard.press('Enter');
    await frames();
    s = await status();
    assert.deepEqual([s.state, s.kind, s.handling, s.chip], ['ready', 'normal', 'revised', 'Power'], 'after the lesson, a run drives Power');
    await page.keyboard.press('KeyP');
    await frames();
    await page.locator('#paused .return-title').click();
    await frames();
    assert.deepEqual(await writes(), before);
    ok('the lesson drives Classic whatever is chosen, says so on How to Play, leaves the choice and its saved value alone; the next run is Power');

    // --- 6. Records by mode, after the pad ------------------------------------------------
    // A full three-lap run with the same scripted driver in two modes, through the real page.
    assert.equal(await records(), null, 'nothing saved yet');
    for (const [mode, label] of [['revised', 'Power'], ['classic', 'Classic']]) {
      await page.locator('#handlings label', { hasText: label }).click();
      await page.locator('#start').click();
      await frames();
      s = await status();
      assert.equal(s.handling, mode);
      assert.equal(await value(() => window.__miniDrifters.game.scoring.score), 0, 'nothing carried from the pad');
      assert.equal(await value((d) => window.__drive(d, 'finished', 400), 'gripDriver'), 'finished');
      await frames();
      assert.ok(await visible('#results'));
      assert.equal(await page.locator('#r-mode').textContent(), `Original · ${label} handling`);
      assert.ok(await visible('#new-lap'), `NEW BEST lap in ${label}`);
      await page.screenshot({ path: shot(`${name}-results-${mode}`) });
      if (mode === 'revised') {
        // Drive again starts the same circuit in the same mode.
        await page.locator('#again').click();
        await frames();
        s = await status();
        assert.deepEqual([s.state, s.kind, s.handling, s.gameTrack, s.chip], ['ready', 'normal', 'revised', 'original', 'Power'], 'Drive again keeps the mode');
        await page.keyboard.press('KeyP');
        await frames();
        await page.locator('#paused .return-title').click();
      } else {
        await page.locator('#results .return-title').click();
      }
      await frames();
    }
    const saved = await records();
    assert.equal(saved.version, 2);
    assert.ok(saved.tracks.original.revised.fastestLap > 0);
    assert.ok(saved.tracks.original.classic.fastestLap > 0);
    assert.notEqual(saved.tracks.original.revised.fastestLap, saved.tracks.original.classic.fastestLap, 'two different runs, two records');
    assert.deepEqual(Object.keys(saved.tracks.original), ['classic', 'revised'], 'no entry is made for a retired mode');
    assert.deepEqual(saved.tracks.switchback.revised, { score: null, fastestLap: null, bestCombo: null });
    assert.ok(!(await writes()).includes(LEGACY_KEY), 'the v0.2.0 key was never written');
    assert.deepEqual(await writes(), [KEY]);
    // The title shows each pair's own values.
    const pb = async () => value(() => [document.getElementById('records-heading').textContent, document.getElementById('pb-lap').textContent]);
    await page.locator('#handlings label', { hasText: 'Power' }).click();
    const revisedTitle = await pb();
    await page.locator('#handlings label', { hasText: 'Classic' }).click();
    const classicTitle = await pb();
    await page.locator('#start').focus(); // away from the mode choice, Right changes the track
    await page.keyboard.press('ArrowRight'); // Switchback: nothing driven there in either mode
    assert.deepEqual(await pb(), ['Switchback · Classic — Personal bests', '--']);
    await page.keyboard.press('KeyH');
    assert.deepEqual(await pb(), ['Switchback · Power — Personal bests', '--']);
    await page.keyboard.press('KeyH');
    await page.keyboard.press('ArrowLeft');
    assert.notEqual(revisedTitle[1], classicTitle[1]);
    assert.match(revisedTitle[0], /Original · Power/);
    ok(`records by mode: Power ${revisedTitle[1]}, Classic ${classicTitle[1]}, Switchback -- in both; only ${KEY} written`);

    // --- 6b. The last chosen mode is remembered ------------------------------------------
    // Classic was chosen last: a reload keeps it, and every record is still there and apart.
    await open();
    s = await status();
    assert.deepEqual([s.selected, s.checked, s.track], ['classic', 'classic', 'original'], 'the track is not remembered; the mode is');
    assert.equal((await pb())[1], classicTitle[1]);
    await page.locator('#handlings label', { hasText: 'Power' }).click();
    await open();
    s = await status();
    assert.deepEqual([s.selected, s.checked], ['revised', 'revised'], 'Power is restored after a reload');
    assert.match(s.heading, /^Original · Power — Personal bests$/);
    assert.equal(s.summary, 'Break rear traction with throttle. More control, more consequences.');
    assert.equal((await pb())[1], revisedTitle[1], 'with its own records');
    assert.equal(await prefWrites(), 0, 'restoring the choice saved nothing');
    await page.keyboard.press('Enter');
    await frames();
    s = await status();
    assert.deepEqual([s.state, s.kind, s.handling, s.chip, s.ghost], ['ready', 'normal', 'revised', 'Power', ids.revised], 'Enter drives the restored mode');
    await page.keyboard.press('KeyP');
    await frames();
    await page.locator('#paused .return-title').click();
    await frames();
    // Choosing Classic again is remembered too.
    await page.keyboard.press('KeyH');
    assert.equal(await pref(), 'classic');
    await open();
    s = await status();
    assert.deepEqual([s.selected, s.checked], ['classic', 'classic'], 'Classic again after a reload');
    // A value this version can't use, such as the retired Tuned Power, falls back to Classic and plays.
    for (const bad of ['tuned', 'Power', 'revised-low', '{"id":"revised"}', '', '__proto__']) {
      await value(([k, v]) => localStorage.setItem(k, v), [PREF_KEY, bad]);
      await open();
      s = await status();
      assert.deepEqual([s.selected, s.checked], ['classic', 'classic'], `saved ${JSON.stringify(bad)} reads as Classic`);
      assert.match(s.heading, /^Original · Classic/);
      assert.equal(await pref(), bad, 'and is not rewritten just for loading');
      if (bad === 'tuned') {
        await page.keyboard.press('Enter');
        await frames();
        s = await status();
        assert.deepEqual([s.state, s.kind, s.handling], ['ready', 'normal', 'classic'], 'a saved Tuned Power choice still starts a game');
        await page.keyboard.press('KeyP');
        await frames();
        await page.locator('#paused .return-title').click();
        await frames();
      }
    }
    assert.deepEqual(Object.keys((await records()).tracks.original), ['classic', 'revised'], 'and the records are as they were');
    await page.keyboard.press('KeyH');
    await page.keyboard.press('Shift+KeyH');
    assert.equal(await pref(), 'classic', 'the next choice replaces the bad value');
    await open();
    ok('remembered mode: Classic and Power each restored after reload; bad or retired values read as Classic and still play');

    // --- 7. Mocked controller ---------------------------------------------------------------
    await value(() => { window.__pads = [window.__newPad()]; window.__frames(); });
    await press(12); // up from Start
    assert.equal(await focused(), 'classic', 'D-pad Up reaches the handling choice');
    await press(15);
    assert.equal((await status()).selected, 'revised', 'D-pad Right changes the mode there');
    assert.ok(await value(() => document.activeElement.classList.contains('controller-focus')));
    await page.screenshot({ path: shot(`${name}-controller-focus`) });
    await press(13);
    assert.equal(await focused(), 'start');
    await press(15);
    assert.equal((await status()).track, 'switchback', 'on Start, D-pad Right is still the track');
    await press(14);
    await press(13);
    assert.equal(await focused(), 'practice');
    await press(0);
    s = await status();
    assert.deepEqual([s.kind, s.handling], ['practice', 'revised'], 'A on Practice pad starts the pad in the chosen mode');
    await press(9); // Menu: pause
    assert.ok(await visible('#paused'));
    await page.locator('#paused .return-title').click();
    await frames();
    await press(0); // focus is back on the title; A on Start
    s = await status();
    assert.deepEqual([s.kind, s.handling, s.state], ['normal', 'revised', 'ready']);
    await press(9);
    await page.locator('#paused .return-title').click();
    await frames();
    await value(() => { window.__pads = []; window.__frames(); });
    ok('controller: D-pad reaches and changes the mode, starts the pad and a run with it');

    // --- 8. A v0.2.0 save is migrated ----------------------------------------------------
    // This origin is a throwaway one: replace its saves with exactly what v0.2.0 leaves.
    // v0.2.0 had no remembered handling mode either.
    await value(([key, legacyKey, raw, prefKey]) => { localStorage.removeItem(key); localStorage.removeItem(prefKey); localStorage.setItem(legacyKey, raw); }, [KEY, LEGACY_KEY, V020, PREF_KEY]);
    await open();
    const pbAll = () => value(() => ['records-heading', 'pb-score', 'pb-lap', 'pb-combo'].map((id) => document.getElementById(id).textContent));
    assert.deepEqual(await pbAll(), ['Original · Classic — Personal bests', '15,420', '0:47.31', '0'], 'a real zero is shown as 0');
    assert.equal(await prefWrites(), 0);
    await page.keyboard.press('KeyH');
    assert.deepEqual(await pbAll(), ['Original · Power — Personal bests', '--', '--', '--'], 'v0.2.0 records are Classic only');
    await page.keyboard.press('KeyH');
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await pbAll(), ['Switchback · Classic — Personal bests', '--', '0:52.08', '--'], 'missing records stay missing');
    assert.equal(await records(), null, 'loading wrote nothing');
    assert.deepEqual(await writes(), [], 'nothing at all');
    await page.screenshot({ path: shot(`${name}-migrated-v020`) });
    // A Classic lap better than v0.2.0's Switchback lap is a new best, saved to the new key only.
    await page.locator('#start').click();
    await frames();
    assert.deepEqual([(await status()).gameTrack, (await status()).handling], ['switchback', 'classic']);
    assert.equal(await value((d) => window.__drive(d, 'finished', 400), 'gripDriver'), 'finished');
    await frames();
    assert.ok(await visible('#new-lap'), 'beat the v0.2.0 lap of 52.08 s');
    const migrated = await records();
    const runLap = await value(() => window.__miniDrifters.game.results.bestLap);
    assert.ok(runLap < 52.08);
    assert.equal(migrated.tracks.switchback.classic.fastestLap, runLap);
    assert.deepEqual(migrated.tracks.original.classic, { score: 15420, fastestLap: 47.31, bestCombo: 0 }, 'the v0.2.0 Original records were copied forward exactly');
    assert.deepEqual(migrated.tracks.switchback.revised, { score: null, fastestLap: null, bestCombo: null });
    assert.equal(await value((k) => localStorage.getItem(k), LEGACY_KEY), V020, 'the v0.2.0 key is byte-for-byte untouched');
    assert.deepEqual(await writes(), [KEY]);
    await page.locator('#results .return-title').click();
    await frames();
    ok('v0.2.0 save: values under Classic only, zero shown as 0, missing as --, copied forward on a new best, old key untouched');

    // --- 9. A later schema is left alone ------------------------------------------------
    const later = JSON.stringify({ version: 3, tracks: { original: { classic: { score: 1 } } } });
    await value(([key, raw]) => localStorage.setItem(key, raw), [KEY, later]);
    await open();
    assert.match(await page.locator('#records-note').textContent(), /newer version/);
    assert.deepEqual(await pbAll(), ['Original · Classic — Personal bests', '15,420', '0:47.31', '0'], 'shows the v0.2.0 records it can still read');
    // The same Switchback run that just beat 52.08 s would be a new best again; it must not be.
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await pbAll(), ['Switchback · Classic — Personal bests', '--', '0:52.08', '--']);
    await page.locator('#start').click();
    await frames();
    assert.equal(await value((d) => window.__drive(d, 'finished', 400), 'gripDriver'), 'finished');
    await frames();
    assert.ok(await value(() => window.__miniDrifters.game.results.bestLap) < 52.08, 'the run did beat the shown record');
    assert.equal(await visible('#new-lap'), false, 'no NEW BEST that could not be saved');
    assert.match(await page.locator('#results-records-note').textContent(), /newer version/);
    assert.equal(await value((k) => localStorage.getItem(k), KEY), later, 'the later save is untouched');
    await page.locator('#results .return-title').click();
    await frames();
    ok('a later schema: kept, never written, no NEW BEST, the title says why');

    // --- 10. The physics lab's query parameters do nothing in the game -----------------------
    await open('?lab&setup=1&physics=revised&pad=1&extras=1&migration-fixture=reset');
    assert.equal(await visible('.handling-select'), true);
    assert.equal(await visible('#practice'), true);
    assert.equal(await visible('#lab-panel'), false);
    assert.deepEqual(await page.locator('#handlings label').allTextContents(), ['Classic', 'Power'], 'no lab-only or retired mode');
    assert.equal(await value((k) => localStorage.getItem(k), KEY), later, 'no fixture reset');
    await page.keyboard.press('Enter');
    await frames();
    s = await status();
    assert.deepEqual([s.kind, s.handling, s.gameTrack], ['normal', 'classic', 'original']);
    ok('physics lab query parameters: ignored');

    // --- 11. Storage that can't be opened -------------------------------------------------
    // A separate context whose localStorage throws, as with blocked site data.
    const denied = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    try {
      const p2 = await denied.newPage();
      p2.on('pageerror', (e) => errors.push(e.message));
      await p2.addInitScript(() => Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Denied', 'SecurityError'); } }));
      await p2.goto(base);
      await p2.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
      assert.equal(await p2.evaluate(() => window.__miniDrifters.selectedHandling()), 'classic', 'no storage: Classic');
      await p2.keyboard.press('KeyH');
      assert.equal(await p2.evaluate(() => window.__miniDrifters.selectedHandling()), 'revised', 'the choice still works for this visit');
      await p2.keyboard.press('Enter');
      await p2.waitForFunction(() => window.__miniDrifters.game.state === 'ready', null, { polling: 50 });
      assert.equal(await p2.evaluate(() => window.__miniDrifters.game.handling.id), 'revised', 'and a run drives it');
    } finally {
      await denied.close();
    }
    ok('storage denied: Classic first, the choice still works for the visit, and a run starts');

    assert.deepEqual(errors, [], 'no page errors');
    console.log(`${name}: handling browser check passed`);
  } finally {
    await browser.close();
  }
}

try {
  await check('chromium', chromium);
  if (process.env.HANDLING_FIREFOX !== 'off') await check('firefox', firefox);
} finally {
  server.close();
}
