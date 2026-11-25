import { chooseTracks } from './support/track-menu.mjs';
// The saved reference ghost in real browsers: the Options choice by mouse, keyboard and
// controller, real localStorage across reloads, tabs and failures, what is drawn and when, and
// the sheet's fit. Every context is a fresh, disposable profile on a random local port, so no real
// save is ever read or written. Needs Playwright, like the other browser checks:
//   node test/reference-ghost-browser.mjs [/path/to/playwright/index.mjs]
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RADIO_FILES } from '../src/radio-stations.js';
import { createGame, startRun, tick } from '../src/game.js';
import { trackById } from '../src/track.js';
import { GHOST_STORE_KEY, GHOST_COMPATIBILITY, encodeEntry, entryChecksum, expectedIdentity } from '../src/ghost-store.js';
import { GHOST_PREFERENCE_KEY } from '../src/ghost-preferences.js';
import { RECORDS_KEY } from '../src/records.js';
import { gripDriver } from './support/drivers.mjs';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');

const root = new URL('../', import.meta.url);
const artifact = (name) => fileURLToPath(new URL(`artifacts/reference-ghost-${name}`, root));
await mkdir(new URL('artifacts/', root), { recursive: true });

const siteFiles = ['index.html', 'style.css', 'audio-lab/assets/tire-foley.mp3', 'audio-lab/assets/ATTRIBUTION.md',
  ...['idle', 'mid', 'load', 'high'].map((key) => `audio-lab/assets/coyote-local/${key}.wav`), ...RADIO_FILES,
  ...(await readdir(new URL('src/', root))).map((name) => `src/${name}`), 'test/support/drivers.mjs'];
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.md': 'text/plain; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/mini-drifters/' ? 'index.html' : path.replace('/mini-drifters/', '');
  if (!siteFiles.includes(file)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': types[extname(file)] });
  res.end(await readFile(new URL(file, root)));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}/mini-drifters/`;

// A real flying lap on Dockyard in Classic, encoded by the same module the page uses, for seeding.
function dockyardEntry() {
  let lap = null;
  const game = createGame(trackById('dockyard'), { onRunEvent: (e) => { if (e.type === 'ghost' && e.flying && !lap) lap = e; } });
  startRun(game);
  const driver = gripDriver();
  while (!lap) tick(game, driver(game));
  return encodeEntry(lap.recording, expectedIdentity('dockyard', 'classic'), lap.time, 'reference');
}
const SEED = dockyardEntry();
const storeWith = (entry, version = 1) => JSON.stringify({ version, ghosts: { dockyard: { classic: entry } } });

async function installHelpers(page) {
  await page.evaluate(async () => {
    const at = (path) => new URL(path, document.baseURI).href;
    const { tick } = await import(at('src/game.js'));
    const { createRenderer, drawFrame } = await import(at('src/render.js'));
    const { ghostDisplay, ghostPoseAt } = await import(at('src/ghost.js'));
    const store = await import(at('src/ghost-store.js'));
    const { gripDriver } = await import(at('test/support/drivers.mjs'));
    const { game } = window.__miniDrifters;
    let probe = null;
    // Draws the live game's next frame through the real renderer, centred on a point.
    const shoot = (x, y) => {
      probe ??= createRenderer(document.createElement('canvas'), game.track);
      if (probe.track !== game.track) probe = createRenderer(document.createElement('canvas'), game.track);
      probe.cam.x = x; probe.cam.y = y; probe.cam.zoom = 11.5;
      drawFrame(probe, game, 0, 0, false);
      return probe.ctx.getImageData(0, 0, probe.canvas.width, probe.canvas.height).data;
    };
    const changed = (a, b) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n += 1;
      return n;
    };
    let driver = null;
    let runId = -1;
    const drive = (target, budget = 200000) => {
      if (runId !== game.runId) { driver = gripDriver(); runId = game.runId; }
      while (game.laps.completed + game.laps.voided < target && game.state !== 'finished' && budget-- > 0) tick(game, driver(game));
    };
    // Drives on until the reference is at least 5 m from the car, then reports how much of the
    // screen it changes when hidden, at the reference's own pose. The car is drawn the same in
    // both shots, so only the ghost can differ; the gap only keeps it from fading under the car.
    // The scripted driver repeats its laps to within a few centimetres, so it first coasts for two
    // seconds, as a slower player would, to open a gap.
    const coast = { up: false, down: false, left: false, right: false, handbrake: false };
    const referencePixels = () => {
      const start = game.laps.completed + game.laps.voided;
      for (let i = 0; i < 20000 && game.laps.completed + game.laps.voided === start && game.state === 'racing'; i += 1) {
        if (runId !== game.runId) { driver = gripDriver(); runId = game.runId; }
        const keys = driver(game);
        tick(game, game.ghost.lapTick < 240 ? coast : keys);
        if (game.ghost.lapTick < 360 || !game.ghostReference) continue;
        const pose = ghostPoseAt(game.ghostReference, game.ghost.lapTick - 1);
        const d = Math.hypot(pose.x - game.car.x, pose.y - game.car.y);
        if (d < 5) continue;
        const visible = game.ghostVisible;
        game.ghostVisible = true;
        const on = shoot(pose.x, pose.y);
        game.ghostVisible = false;
        const off = shoot(pose.x, pose.y);
        game.ghostVisible = visible;
        return { changed: changed(on, off), distance: d };
      }
      return null;
    };
    window.__rt = { tick, drive, referencePixels, shoot, changed, ghostDisplay, ghostPoseAt, store };
  });
}

async function check(name, engine) {
  console.log(`Checking ${name}...`);
  const steps = [];
  const step = (label) => { steps.push(label); console.log(`  ok: ${label}`); };
  const browser = await engine.launch({ headless: true });
  const errors = [];
  const measures = {};
  const contexts = [];
  const newPage = async ({ viewport = { width: 1366, height: 768 }, init, context } = {}) => {
    const ctx = context ?? await browser.newContext({ viewport });
    if (!context) contexts.push(ctx);
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
    return page;
  };
  const open = async (page) => {
    await page.goto(BASE);
    await page.waitForFunction(() => window.__miniDrifters);
    await installHelpers(page);
  };
  const reload = async (page) => {
    await page.reload();
    await page.waitForFunction(() => window.__miniDrifters);
    await installHelpers(page);
  };
  const tag = (page) => page.locator('#ghost-status').textContent();
  const ref = (page) => page.evaluate(() => window.__miniDrifters.referenceGhost());
  const stored = (page, key = GHOST_STORE_KEY) => page.evaluate((k) => localStorage.getItem(k), key);
  const chooseTrack = async (page, track) => { await chooseTracks(page); await page.locator('#tracks label', { hasText: track }).click(); };
  const begin = async (page) => { await chooseTracks(page); await page.locator('#start').click(); await page.waitForTimeout(50); };
  const drive = (page, laps) => page.evaluate((n) => window.__rt.drive(n), laps);
  const optionsGhost = async (page, label) => {
    await page.keyboard.press('KeyO');
    await page.locator('#ghost-sources label', { hasText: label }).click();
    const note = await page.locator('#ghost-note').textContent();
    await page.locator('#options-close').click();
    return note;
  };

  try {
    // --- 1. Previous lap stays the default, exactly as before -------------------------
    let page = await newPage();
    await open(page);
    await page.keyboard.press('KeyO');
    assert.equal(await page.locator('#ghost-sources input:checked').getAttribute('value'), 'previous');
    assert.match(await page.locator('#ghost-note').textContent(), /last clean lap/);
    await page.keyboard.press('Escape');
    assert.equal(await stored(page, GHOST_PREFERENCE_KEY), null, 'nothing written for opening Options');
    await chooseTrack(page, 'Dockyard');
    await begin(page);
    assert.equal(await tag(page), 'Ghost On');
    await drive(page, 1);
    assert.equal(await tag(page), 'Ghost On');
    assert.equal(await stored(page), null, 'lap 1 never saves a ghost');
    await drive(page, 2);
    assert.ok(await stored(page), 'the flying lap saved a reference even with Previous lap chosen');
    const previousShown = await page.evaluate(() => {
      const { game } = window.__miniDrifters;
      return !!window.__rt.ghostDisplay(game.ghost, 300, 1e6, 1e6);
    });
    assert.ok(previousShown, 'the previous-lap ghost plays as it always has');
    step('Previous lap is the default; lap 1 saves nothing; a flying lap saves a reference silently');

    // --- 2. Saved reference, with nothing saved yet ------------------------------------
    page = await newPage();
    await open(page);
    await chooseTrack(page, 'Dockyard');
    const emptyNote = await optionsGhost(page, 'Saved reference');
    assert.match(emptyNote, /Dockyard · Classic: no saved reference yet/);
    assert.equal(await stored(page, GHOST_PREFERENCE_KEY), 'reference');
    await begin(page);
    assert.equal(await tag(page), 'No Reference Yet');
    assert.equal(await page.locator('#ghost-status').getAttribute('data-state'), 'none');
    await page.screenshot({ path: artifact(`${name}-no-reference.png`) });
    step('Saved reference with nothing saved says so, quietly, in the tag and in Options');

    // --- 3. A flying lap saves it; the run shows it at once; the banner says so ----------
    await drive(page, 1);
    assert.equal(await tag(page), 'No Reference Yet', 'still nothing after the standing-start lap');
    await drive(page, 2);
    let r = await ref(page);
    assert.equal(r.lastResult.saved, true);
    assert.equal(r.shown, true);
    assert.equal(await tag(page), 'Reference On');
    await page.waitForTimeout(150);
    assert.match(await page.locator('#banner').textContent(), /REFERENCE SAVED/);
    await page.screenshot({ path: artifact(`${name}-reference-saved.png`) });
    const firstSave = JSON.parse(await stored(page));
    assert.equal(firstSave.version, 1);
    assert.equal(firstSave.ghosts.dockyard.classic.compatibility, GHOST_COMPATIBILITY);
    const pixels = await page.evaluate(() => window.__rt.referencePixels());
    assert.ok(pixels && pixels.changed > 150, `the reference is drawn: ${JSON.stringify(pixels)}`);
    step(`a flying lap saved the reference and the same run draws it (${pixels.changed} px at ${pixels.distance.toFixed(0)} m)`);

    // --- 4. G hides and shows it ----------------------------------------------------------
    await page.keyboard.press('KeyG');
    assert.equal(await tag(page), 'Reference Off');
    assert.equal(await page.evaluate(() => window.__miniDrifters.game.ghostVisible), false);
    // Hidden, the real renderer draws nothing at the reference's pose.
    const hiddenPixels = await page.evaluate(() => {
      const { game } = window.__miniDrifters;
      const { ghostPoseAt, shoot, changed } = window.__rt;
      const pose = ghostPoseAt(game.ghostReference, game.ghost.lapTick - 1);
      const source = game.ghostSource;
      const a = shoot(pose.x, pose.y);
      game.ghostSource = 'off';
      const b = shoot(pose.x, pose.y);
      game.ghostSource = source;
      return changed(a, b);
    });
    assert.equal(hiddenPixels, 0, 'G hid it');
    await page.keyboard.press('KeyG');
    assert.equal(await tag(page), 'Reference On');
    step('G hides and shows the saved reference');

    // --- 5. Restart: there again, but only from the first flying lap -----------------------
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(50);
    r = await ref(page);
    assert.equal(r.shown, true, 'reloaded for the new run');
    assert.equal(await tag(page), 'Reference On');
    const lap1 = await page.evaluate(() => {
      const { game } = window.__miniDrifters;
      const { tick, ghostPoseAt, shoot, changed } = window.__rt;
      // Push the throttle for two seconds of the standing-start lap.
      for (let i = 0; i < 240; i += 1) tick(game, { up: true, down: false, left: false, right: false, handbrake: false });
      const pose = ghostPoseAt(game.ghostReference, game.ghost.lapTick - 1);
      game.ghostVisible = true;
      const on = shoot(pose.x, pose.y);
      game.ghostVisible = false;
      const off = shoot(pose.x, pose.y);
      game.ghostVisible = true;
      return { changed: changed(on, off), lap: game.laps.completed };
    });
    assert.equal(lap1.lap, 0);
    assert.equal(lap1.changed, 0, 'nothing is drawn on the standing-start lap');
    await drive(page, 1);
    const afterLine = await page.evaluate(() => window.__rt.referencePixels());
    assert.ok(afterLine && afterLine.changed > 150, 'it joins at the line');
    step('after a restart the reference waits for the line, then runs with the flying lap');

    // --- 6. A reload keeps it (a new page in the same profile) ----------------------------
    await reload(page);
    await page.keyboard.press('KeyO');
    assert.equal(await page.locator('#ghost-sources input:checked').getAttribute('value'), 'reference', 'the choice is remembered');
    assert.match(await page.locator('#ghost-note').textContent(), /Dockyard|Original/);
    await page.keyboard.press('Escape');
    await chooseTrack(page, 'Dockyard');
    await page.keyboard.press('KeyO');
    const reloadNote = await page.locator('#ghost-note').textContent();
    assert.match(reloadNote, /Dockyard · Classic: saved (personal best|reference)/);
    await page.keyboard.press('Escape');
    await begin(page);
    assert.equal(await tag(page), 'Reference On');
    step(`a reload keeps the choice and the lap: "${reloadNote}"`);

    // --- 7. Slower laps keep it; faster laps replace it -----------------------------------
    const before = await stored(page);
    const savedTime = JSON.parse(before).ghosts.dockyard.classic.lapTime;
    await page.evaluate(() => {
      // Lap 1 normally, then a deliberately slow but clean flying lap: the grip driver's own
      // inputs, with two extra coasting ticks after every one of its ticks for half of each second.
      const { game } = window.__miniDrifters;
      const { tick, drive } = window.__rt;
      const coast = { up: false, down: false, left: false, right: false, handbrake: false };
      drive(1);
      const start = game.laps.completed + game.laps.voided;
      for (let n = 0; game.laps.completed + game.laps.voided === start && game.state === 'racing' && n < 200000; n += 1) {
        drive(start + 1, 1);
        if (n % 120 < 60) { tick(game, coast); tick(game, coast); }
      }
    });
    const lastLap = await page.evaluate(() => window.__miniDrifters.game.laps.lastLap);
    r = await ref(page);
    assert.ok(lastLap > savedTime, `${lastLap} is slower than ${savedTime}`);
    assert.equal(r.lastResult?.saved ?? false, false);
    assert.equal(await stored(page), before, 'byte-for-byte unchanged');
    step(`a slower flying lap (${lastLap.toFixed(2)} s against ${savedTime.toFixed(2)} s) left the saved lap alone`);

    // --- 8. Isolation by circuit and mode -------------------------------------------------
    const toTitle = async () => {
      const { state, paused } = await page.evaluate(() => ({ state: window.__miniDrifters.game.state, paused: window.__miniDrifters.game.paused }));
      if (state !== 'finished' && !paused) await page.keyboard.press('KeyP');
      await page.locator(await page.locator('#paused').isVisible() ? '#paused .return-title' : '#results .return-title').click();
    };
    await toTitle();
    await chooseTrack(page, 'Original');
    await begin(page);
    assert.equal(await tag(page), 'No Reference Yet', 'Original has none');
    assert.equal((await ref(page)).shown, false);
    await toTitle();
    await chooseTrack(page, 'Dockyard');
    await page.keyboard.press('KeyH'); // Power
    assert.equal(await page.evaluate(() => window.__miniDrifters.selectedHandling()), 'revised');
    await begin(page);
    assert.equal(await tag(page), 'No Reference Yet', 'Dockyard in Power has none');
    step('another circuit, or the same circuit in another mode, never shows Dockyard Classic\'s lap');

    // --- 9. Off -----------------------------------------------------------------------------
    await toTitle();
    await page.keyboard.press('KeyH'); // back to Classic
    await optionsGhost(page, 'Off');
    await begin(page);
    assert.equal(await tag(page), 'Ghost Off');
    await drive(page, 1);
    const offPixels = await page.evaluate(() => {
      const { game } = window.__miniDrifters;
      const { tick, ghostPoseAt, shoot, changed, drive } = window.__rt;
      for (let i = 0; i < 600; i += 1) drive(game.laps.completed + 1, 1);
      const reference = game.ghostReference;
      const pose = ghostPoseAt(reference, game.ghost.lapTick - 1);
      game.ghostVisible = true;
      const a = shoot(pose.x, pose.y);
      game.ghostVisible = false;
      const b = shoot(pose.x, pose.y);
      game.ghostVisible = true;
      return changed(a, b);
    });
    assert.equal(offPixels, 0, 'nothing drawn');
    step('Off draws no ghost and says so');

    // --- 10. No ghost in Gymkhana, practice or the lesson -----------------------------------
    for (const [label, opener] of [
      ['Practice', async () => { await chooseTracks(page); await page.locator('#practice').click(); }],
      ['Gymkhana', async () => { await page.locator('#gymkhana').click(); await page.locator('#gymkhana-start').click(); }],
    ]) {
      await toTitle();
      await optionsGhost(page, 'Saved reference');
      await opener();
      await page.waitForTimeout(50);
      const s = await page.evaluate(() => ({ ghost: window.__miniDrifters.game.ghost, reference: window.__miniDrifters.game.ghostReference }));
      assert.equal(s.ghost, null, label);
      assert.equal(s.reference, null, label);
      assert.equal(await page.locator('#ghost-status').isVisible(), false, `${label}: no ghost tag`);
      await page.keyboard.press('KeyP');
      await page.locator('#paused .options-open').click();
      assert.match(await page.locator('#ghost-note').textContent(), /only shown on circuit runs/);
      await page.keyboard.press('Escape');
    }
    step('practice and Gymkhana have no ghost, and Options says why');

    // --- 11. Keyboard-only choice ------------------------------------------------------------
    page = await newPage();
    await open(page);
    await page.keyboard.press('KeyO');
    for (let i = 0; i < 12; i += 1) {
      if (await page.evaluate(() => document.activeElement?.name === 'ghost-source')) break;
      await page.keyboard.press('Tab');
    }
    assert.equal(await page.evaluate(() => document.activeElement?.name), 'ghost-source', 'Tab reaches the ghost choice');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement.value), 'reference');
    assert.equal(await stored(page, GHOST_PREFERENCE_KEY), 'reference');
    await page.keyboard.press('ArrowRight');
    assert.equal(await stored(page, GHOST_PREFERENCE_KEY), 'off');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#options').isVisible(), false);
    step('the keyboard reaches the choice with Tab and changes it with the arrows');

    // --- 12. Controller-only choice ------------------------------------------------------------
    page = await newPage({ init: () => {
      window.__pads = [];
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.__pads });
      window.requestAnimationFrame = (callback) => { window.__nextFrame = callback; return 1; };
      let now;
      window.__frames = (count = 2, dt = 1000 / 60) => { now ??= performance.now(); for (let i = 0; i < count; i++) { now += dt; window.__nextFrame(now); } };
      window.__newPad = () => ({ index: 0, id: 'Mock', mapping: 'standard', connected: true, axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false })) });
    } });
    await page.goto(BASE);
    await page.waitForFunction(() => window.__miniDrifters);
    const press = async (index) => {
      await page.evaluate((i) => { window.__pads[0].buttons[i] = { value: 1, pressed: true }; window.__frames(); }, index);
      await page.evaluate((i) => { window.__pads[0].buttons[i] = { value: 0, pressed: false }; window.__frames(); }, index);
    };
    await page.evaluate(() => { window.__pads = [window.__newPad()]; window.__frames(); });
    await press(13);
    for (let i = 0; i < 10 && !(await page.evaluate(() => document.activeElement?.classList.contains('options-open'))); i += 1) await press(13);
    await press(0);
    assert.equal(await page.locator('#options').isVisible(), true, 'A opens Options');
    for (let i = 0; i < 16 && await page.evaluate(() => document.activeElement?.name) !== 'ghost-source'; i += 1) await press(13);
    assert.equal(await page.evaluate(() => document.activeElement?.name), 'ghost-source', 'the D-pad reaches the ghost choice');
    const firstFocused = await page.evaluate(() => document.activeElement.value);
    await press(15);
    const picked = await page.evaluate(() => document.querySelector('#ghost-sources input:checked').value);
    assert.notEqual(picked, firstFocused, 'Right changes it');
    assert.equal(await stored(page, GHOST_PREFERENCE_KEY), picked);
    await press(1);
    assert.equal(await page.locator('#options').isVisible(), false, 'B closes Options');
    step(`a standard controller reaches the choice and changes it (${firstFocused} to ${picked})`);

    // --- 13. Damaged, outdated and newer saves ---------------------------------------------
    const seeded = async (raw, expected, label) => {
      const p = await newPage();
      await open(p);
      await p.evaluate(([k, v, pk]) => { localStorage.setItem(k, v); localStorage.setItem(pk, 'reference'); }, [GHOST_STORE_KEY, raw, GHOST_PREFERENCE_KEY]);
      await reload(p);
      await chooseTrack(p, 'Dockyard');
      await begin(p);
      assert.equal(await tag(p), expected, label);
      return p;
    };
    const outdated = { ...SEED, compatibility: GHOST_COMPATIBILITY - 1 };
    outdated.checksum = entryChecksum(outdated);
    const full = storeWith(SEED);
    const truncated = full.slice(0, Math.floor(full.length / 2));
    const shortColumn = { ...SEED, dy: SEED.dy.slice(1) };
    shortColumn.checksum = entryChecksum(shortColumn);
    const newer = { ...SEED, compatibility: GHOST_COMPATIBILITY + 1 };
    newer.checksum = entryChecksum(newer);
    const valid = await seeded(storeWith(SEED), 'Reference On', 'a valid seeded lap');
    await valid.close();
    let p = await seeded(truncated, 'No Reference Yet', 'truncated JSON');
    await drive(p, 2);
    assert.equal((await ref(p)).lastResult.saved, true, 'replaced by the next flying lap');
    p = await seeded(storeWith(shortColumn), 'No Reference Yet', 'a short sample column');
    p = await seeded(storeWith(outdated), 'Reference Outdated', 'an older compatibility version');
    await p.keyboard.press('KeyP');
    await p.locator('#paused .options-open').click();
    assert.match(await p.locator('#ghost-note').textContent(), /older physics/);
    await p.keyboard.press('Escape');
    await p.keyboard.press('KeyP');
    await drive(p, 2);
    assert.equal(await tag(p), 'Reference On', 'the next flying lap replaced it');
    const newerRaw = storeWith(newer);
    p = await seeded(newerRaw, 'Reference: Newer Version', 'a later compatibility version');
    await drive(p, 3);
    assert.equal(await stored(p), newerRaw, 'never overwritten');
    const futureRaw = JSON.stringify({ version: 2, ghosts: {} });
    p = await seeded(futureRaw, 'Reference: Newer Version', 'a later store version');
    await drive(p, 3);
    assert.equal(await stored(p), futureRaw, 'never overwritten');
    step('truncated, damaged, outdated and newer saves never break the game, and only the replaceable ones are replaced');

    // --- 14. A full quota and denied storage -------------------------------------------------
    p = await newPage({ init: () => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key, value) {
        if (window.__failGhost && key === 'mini-drifters-ghosts-v1') throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return set.call(this, key, value);
      };
    } });
    await open(p);
    await chooseTrack(p, 'Dockyard');
    await optionsGhost(p, 'Saved reference');
    await p.evaluate(() => { window.__failGhost = true; });
    await begin(p);
    await drive(p, 2);
    r = await ref(p);
    assert.equal(r.lastResult.saved, false);
    assert.equal(r.lastResult.reason, 'write failed');
    assert.equal(r.shown, false, 'nothing claimed');
    // The lap banner is written by the game's next animation frame after drive() returns, and a
    // busy headless Firefox can take longer than a fixed pause to draw it (hosted run 45506358469
    // attempt 1 read an empty banner after 150 ms). So wait, frame by frame and for at most 5 s,
    // for the banner to say so. Its text stays until another banner replaces it (the 1.9 s
    // lifetime only hides it), and the lap is the last banner a frame writes, so a per-frame
    // check cannot miss it. A timeout is not a pass: the assertion below still decides.
    await p.waitForFunction(() => /REFERENCE NOT SAVED/.test(document.getElementById('banner').textContent),
      null, { polling: 'raf', timeout: 5000 }).catch(() => {});
    assert.match(await p.locator('#banner').textContent(), /REFERENCE NOT SAVED/);
    assert.equal(await stored(p), null);
    assert.ok(JSON.parse(await stored(p, RECORDS_KEY)).tracks.dockyard.classic.fastestLap > 0, 'the lap record still saved');
    await p.screenshot({ path: artifact(`${name}-quota.png`) });
    step('a full quota fails the save visibly, claims nothing, and leaves the records alone');

    p = await newPage({ init: () => {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
    } });
    await open(p);
    await chooseTrack(p, 'Dockyard');
    await optionsGhost(p, 'Saved reference');
    await begin(p);
    assert.equal(await tag(p), 'Reference Unavailable');
    await drive(p, 3);
    assert.equal(await p.evaluate(() => window.__miniDrifters.game.state), 'finished', 'the run plays to the end');
    await p.keyboard.press('KeyO');
    assert.match(await p.locator('#ghost-note').textContent(), /storage is unavailable/);
    step('denied storage: the game runs, nothing is saved, and the tag and Options say why');

    // --- 15. Two tabs ---------------------------------------------------------------------
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    contexts.push(ctx);
    const tabA = await newPage({ context: ctx });
    const tabB = await newPage({ context: ctx });
    await open(tabA);
    await open(tabB);
    await chooseTrack(tabA, 'Dockyard');
    await begin(tabA);
    await chooseTrack(tabB, 'Switchback');
    await begin(tabB);
    await drive(tabA, 2);
    // Each tab re-reads the key before it saves, so it keeps every lap it can see. Another tab's
    // write reaches it asynchronously (Chromium keeps a localStorage copy per renderer process), and
    // the scripted drives finish within milliseconds of each other, far closer than two players'
    // laps. Under load, tab B could otherwise read the key before tab A's save arrives and the test
    // would measure that delivery delay rather than the store. So wait until B can see A's lap.
    await tabB.waitForFunction((k) => Boolean(JSON.parse(localStorage.getItem(k) ?? '{}').ghosts?.dockyard?.classic),
      GHOST_STORE_KEY, { polling: 10, timeout: 10000 });
    await drive(tabB, 2);
    const both = JSON.parse(await stored(tabB));
    assert.ok(both.ghosts.dockyard?.classic, 'tab A\'s lap survived tab B\'s write');
    assert.ok(both.ghosts.switchback?.classic);
    step('two tabs saving different circuits keep each other\'s laps');

    // --- 16. Real quota, with disposable data only -----------------------------------------
    p = await newPage();
    await open(p);
    measures.quota = await p.evaluate(() => {
      const chunk = 'x'.repeat(256 * 1024);
      let chars = 0;
      let i = 0;
      try {
        for (; i < 200; i += 1) { localStorage.setItem(`quota-probe-${i}`, chunk); chars += chunk.length; }
      } catch { /* full */ }
      // Finer, to within 8k characters.
      try { for (let j = 0; j < 64; j += 1) { localStorage.setItem(`quota-fine-${j}`, 'y'.repeat(8 * 1024)); chars += 8 * 1024; } } catch { /* full */ }
      Object.keys(localStorage).filter((k) => k.startsWith('quota-')).forEach((k) => localStorage.removeItem(k));
      return { approxChars: chars, approxMiB: +(chars * 2 / 1024 / 1024).toFixed(2), leftover: Object.keys(localStorage).length };
    });
    // Six worst-case five-minute laps written for real, then read back and parsed.
    measures.worstCase = await p.evaluate((key) => {
      const { store: s } = window.__rt;
      const n = s.MAX_SAMPLES;
      const ticks = Array.from({ length: n }, (_, i) => (i === n - 1 ? s.MAX_SAVED_TICKS : i * 4));
      const ghosts = {};
      for (const t of ['original', 'switchback', 'dockyard']) {
        ghosts[t] = {};
        for (const h of ['classic', 'revised']) {
          const id = s.expectedIdentity(t, h);
          const rec = { format: 1, track: id.track, rules: id.rules, tickRate: 120, sampleEvery: 4, durationTicks: s.MAX_SAVED_TICKS, ticks,
            x: ticks.map((k) => 300 * Math.cos(k / 2000) - 123.456), y: ticks.map((k) => 300 * Math.sin(k / 2000) + 98.765),
            heading: ticks.map((k) => k / 2000 + 0.3 * Math.sin(k / 37)) };
          ghosts[t][h] = s.encodeEntry(rec, id, s.MAX_SAVED_TICKS / 120, 'reference');
        }
      }
      const text = JSON.stringify({ version: 1, ghosts });
      localStorage.setItem(key, text);
      const t0 = performance.now();
      const store = s.createGhostStore(() => localStorage);
      let ok = 0;
      for (const t of ['original', 'switchback', 'dockyard']) for (const h of ['classic', 'revised']) if (store.slot(t, h).status === 'ok') ok += 1;
      const readMs = performance.now() - t0;
      localStorage.removeItem(key);
      return { chars: text.length, MiB: +(text.length * 2 / 1024 / 1024).toFixed(2), slotsOk: ok, readAllSixMs: +readMs.toFixed(1) };
    }, GHOST_STORE_KEY);
    assert.ok(measures.quota.approxChars > measures.worstCase.chars * 2, 'room for the worst case twice over');
    assert.equal(measures.worstCase.slotsOk, 6);
    assert.equal(measures.quota.leftover, 0, 'the probe cleaned up after itself');
    step(`quota about ${measures.quota.approxMiB} MiB; six five-minute laps take ${measures.worstCase.MiB} MiB and read back in ${measures.worstCase.readAllSixMs} ms`);

    // Playback cost per frame, and a load of one typical slot.
    measures.playback = await p.evaluate((seed) => {
      const { store: s, ghostDisplay } = window.__rt;
      const { game } = window.__miniDrifters;
      const decoded = s.decodeEntry(seed, s.expectedIdentity('dockyard', 'classic'));
      const ghost = { track: decoded.recording.track, rules: decoded.recording.rules };
      const t0 = performance.now();
      for (let i = 0; i < 20000; i += 1) ghostDisplay(ghost, (i * 0.37) % decoded.recording.durationTicks, 0, 0, decoded.recording);
      const perCallUs = (performance.now() - t0) / 20000 * 1000;
      localStorage.setItem('mini-drifters-ghosts-v1', JSON.stringify({ version: 1, ghosts: { dockyard: { classic: seed } } }));
      const t1 = performance.now();
      const slot = s.createGhostStore(() => localStorage).slot('dockyard', 'classic');
      const loadMs = performance.now() - t1;
      localStorage.removeItem('mini-drifters-ghosts-v1');
      return { perCallUs: +perCallUs.toFixed(2), loadTypicalMs: +loadMs.toFixed(2), status: slot.status, entryChars: JSON.stringify(seed).length };
    }, SEED);
    assert.equal(measures.playback.status, 'ok');
    step(`playback ${measures.playback.perCallUs} µs per frame; a typical ${measures.playback.entryChars}-character lap loads in ${measures.playback.loadTypicalMs} ms`);

    // --- 17. Throttled frames --------------------------------------------------------------
    if (name === 'chromium') {
      p = await newPage();
      await open(p);
      await p.evaluate(([k, v, pk]) => { localStorage.setItem(k, v); localStorage.setItem(pk, 'reference'); }, [GHOST_STORE_KEY, storeWith(SEED), GHOST_PREFERENCE_KEY]);
      await reload(p);
      await chooseTrack(p, 'Dockyard');
      await begin(p);
      await drive(p, 1);
      const cdp = await p.context().newCDPSession(p);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 });
      const before = await p.evaluate(() => window.__miniDrifters.game.ghost.lapTick);
      await p.keyboard.down('ArrowUp');
      await p.waitForTimeout(2500);
      await p.keyboard.up('ArrowUp');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const after = await p.evaluate(() => {
        const { game } = window.__miniDrifters;
        return { lapTick: game.ghost.lapTick, lapTime: game.laps.lapTime, simStep: 1 / 120, shown: !!game.ghostReference };
      });
      assert.ok(after.lapTick > before, 'real frames advanced the lap clock');
      assert.ok(Math.abs(after.lapTick * after.simStep - after.lapTime) < 1e-6, 'the reference clock is the lap timer');
      assert.ok(after.shown);
      await p.screenshot({ path: artifact(`${name}-throttled.png`) });
      step(`under 8x CPU throttling the reference stays on the lap clock (${after.lapTick - before} ticks of real frames)`);
    }

    // --- 18. The Options sheet fits ------------------------------------------------------------
    p = await newPage();
    await open(p);
    // The longest note: a reference slower than an older record with no recording.
    const records3 = JSON.stringify({ version: 3, tracks: { dockyard: { classic: { fastestLap: 12.34, scoring: {} } } } });
    await p.evaluate(([k, v, pk, rk, rv]) => { localStorage.setItem(k, v); localStorage.setItem(pk, 'reference'); localStorage.setItem(rk, rv); },
      [GHOST_STORE_KEY, storeWith(SEED), GHOST_PREFERENCE_KEY, RECORDS_KEY, records3]);
    await reload(p);
    await chooseTrack(p, 'Dockyard');
    // Sound off adds Options' warning line too.
    await p.locator('#sound').click();
    for (const [width, height] of [[1024, 600], [1366, 768], [1920, 1080]]) {
      await p.setViewportSize({ width, height });
      await p.keyboard.press('KeyO');
      await p.waitForTimeout(80);
      const fit = await p.evaluate(() => {
        const parts = [...document.querySelectorAll('#options button, #options input, #ghost-sources span, #ghost-note, #options-muted')]
          .filter((el) => el.getClientRects().length);
        const out = parts.flatMap((el) => {
          const r = el.getBoundingClientRect();
          const target = el.matches('input') ? el.closest('label') : el;
          const tr = target.getBoundingClientRect();
          return tr.left < 0 || tr.top < 0 || tr.right > innerWidth || tr.bottom > innerHeight || (el.matches('span') && el.scrollWidth > el.clientWidth + 1)
            ? [`${el.id || el.textContent?.slice(0, 20) || el.name} ${Math.round(r.top)}-${Math.round(r.bottom)}` ] : [];
        });
        return { out, muted: !document.getElementById('options-muted').hidden, note: document.getElementById('ghost-note').textContent };
      });
      assert.deepEqual(fit.out, [], `Options fits ${width}x${height}`);
      if (width === 1024) measures.longestNote = fit.note;
      await p.screenshot({ path: artifact(`${name}-options-${width}x${height}.png`) });
      await p.keyboard.press('Escape');
    }
    assert.match(measures.longestNote, /has no recording/);
    step('Options fits at 1024x600, 1366x768 and 1920x1080 with the longest note');

    assert.deepEqual(errors, [], 'no page errors');
    step('no page errors');
    return { name, passed: true, steps, measures };
  } finally {
    for (const c of contexts) await c.close().catch(() => {});
    await browser.close();
  }
}

const results = [];
let failed = false;
for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) {
  try {
    results.push(await check(name, engine));
  } catch (error) {
    failed = true;
    console.error(`${name} FAILED:`, error);
    results.push({ name, passed: false, error: String(error?.stack ?? error) });
  }
}
await writeFile(new URL('artifacts/reference-ghost-browser.json', root), JSON.stringify(results, null, 2));
server.close();
if (failed) process.exit(1);
console.log('Reference ghost browser checks passed.');
