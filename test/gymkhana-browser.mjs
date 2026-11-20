import { openTracks } from './support/track-menu.mjs';
// Gymkhana on the real page, in Chromium and Firefox: the title button and the challenge
// sheet by keyboard and by a mocked controller; each challenge driven to a result by the
// scripted drivers; failure, cone penalties, retry and restart; the results sheet; the mode's
// own records, across a reload, and that the circuit records are never written; pause; leaving
// for the title and a normal run afterwards; storage denied; and that it all fits the window.
// Only the Gamepad API and the frame clock are mocked. Every origin here is a throwaway one on
// a random port, so no real save is touched.
//   node test/gymkhana-browser.mjs /path/to/playwright/index.mjs
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(process.argv[2] ? pathToFileURL(process.argv[2]) : 'playwright');
const root = new URL('../', import.meta.url);
await mkdir(new URL('artifacts/', root), { recursive: true });
const shot = (name) => fileURLToPath(new URL(`artifacts/gymkhana-${name}.png`, root));
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = path === '/' ? 'index.html' : path.slice(1);
  // The published files, plus the scripted drivers the page is driven with.
  if (!/^(index\.html|style\.css|src\/[\w-]+\.js|test\/support\/gymkhana-drivers\.mjs|(?:audio-lab\/assets|radio)\/[\w/.-]+)$/.test(file) || file.includes('..')) {
    res.writeHead(404); res.end(); return;
  }
  try { const data = await readFile(new URL(file, root)); res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'text/plain' }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
const KEY = 'mini-drifters-gymkhana-v1';
const CIRCUIT_KEY = 'mini-drifters-records-v3';
const DEG = Math.PI / 180;
const TIDY = { vCap: 24, triggerX: -8, release: 110 * DEG };
const FLAT_OUT = { triggerX: 8, release: 110 * DEG };
const CLIPS_A_CONE = { vCap: 22, triggerX: 0, release: 110 * DEG, lane: -4 };
const DRIFT = { targetSlip: 32 * DEG, catchSlip: 40 * DEG, tapTime: 0.3, lateral: 9.5, cooldown: 1.4 };
const SIZES = [[1920, 1080], [1366, 768], [1280, 720], [1024, 600]];

function harness() {
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
  // Drives the live challenge with one of the scripted drivers until the session is over.
  // `watch` is read after every frame, and every distinct value it gave is returned.
  window.__drive = async (driverName, params, maxSeconds, watch) => {
    const drivers = await import('/test/support/gymkhana-drivers.mjs');
    const m = window.__miniDrifters;
    const driver = drivers[driverName](params);
    const seen = new Set();
    for (let i = 0; i < maxSeconds * 60 && m.game.state !== 'finished'; i++) {
      Object.assign(m.input, driver(m.game));
      window.__frames(1);
      if (watch) seen.add(document.querySelector(watch)?.hidden ? '' : document.querySelector(watch)?.textContent ?? '');
    }
    for (const k of Object.keys(m.input)) m.input[k] = false;
    window.__frames(2);
    return { phase: m.game.challenge.phase, seen: [...seen] };
  };
}

async function check(name, engine) {
  const browser = await engine.launch({ headless: true });
  const ok = (message) => console.log(`${name}: ${message}`);
  const errors = [];

  async function open(context) {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const value = (fn, arg) => page.evaluate(fn, arg);
    const api = {
      page, value,
      load: async () => {
        await page.goto(base);
        await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
        await value(() => window.__frames(2));
      },
      frames: (n = 2) => value((k) => window.__frames(k), n),
      key: async (code) => { await page.keyboard.press(code); await value(() => window.__frames(2)); },
      text: (sel) => value((s) => document.querySelector(s)?.textContent ?? null, sel),
      // Showing: in the page, not hidden by an attribute or by CSS, and taking up room.
      shown: (sel) => value((s) => { const el = document.querySelector(s); return !!el && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0; }, sel),
      focused: () => value(() => { const el = document.activeElement; return el?.id || el?.value || el?.tagName; }),
      status: () => value(() => {
        const m = window.__miniDrifters;
        const g = m.game;
        return { state: g.state, kind: m.sessionKind(), track: g.track.id, handling: g.handling.id, selected: m.selectedHandling(), paused: g.paused,
          sheet: m.gymkhana().open, chosen: m.gymkhana().selected, challenge: g.challengeDef?.id ?? null, phase: g.challenge?.phase ?? null, reason: g.challenge?.reason ?? null,
          time: g.challenge?.time ?? null, result: g.challenge?.result ?? null, score: g.scoring.score, ghost: !!g.ghost, results: g.results, runId: g.runId };
      }),
      drive: (driverName, params, watch = null, maxSeconds = 70) => value(([d, p, s, w]) => window.__drive(d, p, s, w), [driverName, params, maxSeconds, watch]),
      saved: () => value((k) => JSON.parse(localStorage.getItem(k)), KEY),
      // Everything written except the sound, radio and audio settings, which any page writes.
      writes: () => value(() => [...new Set(window.__writes.filter((k) => k !== 'mini-drifters-sound' && !k.startsWith('mini-drifters-radio') && !k.startsWith('mini-drifters-audio')))]),
      press: async (index) => {
        await value((i) => { window.__pads[0].buttons[i] = { value: 1, pressed: true }; window.__frames(); }, index);
        await value((i) => { window.__pads[0].buttons[i] = { value: 0, pressed: false }; window.__frames(); }, index);
      },
      // The selectors whose boxes are not wholly inside the window.
      outside: (sels) => value((list) => list.filter((sel) => {
        const el = document.querySelector(sel);
        if (!el || !el.getClientRects().length) return true;
        const r = el.getBoundingClientRect();
        return r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5;
      }), sels),
      sizes: async (label, sels, picture) => {
        for (const [w, h] of SIZES) {
          await page.setViewportSize({ width: w, height: h });
          await page.waitForTimeout(120);
          await value(() => window.__frames(2));
          assert.deepEqual(await api.outside(sels), [], `${label} fits at ${w}x${h}`);
          if (picture) await page.screenshot({ path: shot(`${name}-${picture}-${w}x${h}`) });
        }
        await page.setViewportSize({ width: 1366, height: 768 });
        await page.waitForTimeout(120);
        await value(() => window.__frames(2));
      },
    };
    return api;
  }

  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await context.addInitScript(harness);
    const p = await open(context);
    const { page, value, frames, key, text, shown, focused, status, drive, saved, writes, press } = p;
    const menuWords = () => page.locator('.title-menu button').evaluateAll((b) => b.map((x) => x.childNodes[0].textContent.trim()));

    // --- 1. The title --------------------------------------------------------------------
    await p.load();
    assert.deepEqual(await menuWords(), ['Tracks', 'Gymkhana', 'Getaway', 'How to play', 'Options']);
    for (const sel of ['#gymkhana-menu', '#gymkhana-results', '#gym-panel']) assert.equal(await shown(sel), false, `${sel} is not showing on the title`);
    assert.equal(await focused(), 'tracks-open');
    assert.equal(await value((k) => localStorage.getItem(k), KEY), null, 'nothing is written on load');
    await p.sizes('the title menu', ['#tracks-open', '#gymkhana', '#getaway', '#how-to-play', '.title-menu .options-open', '#controller-note', '.title'], 'title');
    // No leftover development switch: the old query parameter is just a query parameter.
    await page.goto(`${base}?gymkhana=180`);
    await page.waitForFunction(() => window.__miniDrifters, null, { polling: 50 });
    await frames();
    assert.equal((await status()).state, 'menu');
    assert.deepEqual(await menuWords(), ['Tracks', 'Gymkhana', 'Getaway', 'How to play', 'Options']);
    await p.load();
    ok('title: Gymkhana is a primary category, fits from 1024x600 to 1920x1080, and nothing else of the mode shows');

    // --- 2. The sheet, by keyboard -------------------------------------------------------
    await key('ArrowDown');
    assert.equal(await focused(), 'gymkhana');
    await key('Enter');
    let s = await status();
    assert.equal(s.sheet, true);
    assert.equal(s.state, 'menu');
    assert.equal(await shown('#gymkhana-menu'), true);
    assert.equal(await shown('#menu'), false, 'the sheet stands in for the title');
    assert.equal(await focused(), 'gymkhana-start');
    assert.deepEqual(await page.locator('#challenges .station span').allTextContents(), ['Precision 180', 'Linked Drift', 'One Drift', 'Slalom Sprint']);
    assert.equal(s.chosen, 'precision-180');
    assert.match(await text('#challenge-brief'), /^Through the gate, down the box to the turn zone/);
    assert.equal(await page.locator('#challenge-points li').count(), 3);
    assert.equal(await text('#challenge-best-label'), 'Personal best · Time');
    assert.equal(await text('#challenge-best'), '--');
    assert.match(await text('#gymkhana-handling'), /^Classic handling\. Press H to change it\./);
    await page.screenshot({ path: shot(`${name}-sheet`) });
    await key('ArrowRight');
    assert.equal((await status()).chosen, 'linked-drift');
    assert.match(await text('#challenge-brief'), /^Take every gate in order/);
    assert.equal(await text('#challenge-best-label'), 'Personal best · Score');
    assert.equal(await focused(), 'gymkhana-start', 'the choice changes without taking the focus');
    await key('ArrowRight');
    assert.equal((await status()).chosen, 'one-drift');
    await key('ArrowRight');
    assert.equal((await status()).chosen, 'slalom-sprint');
    await key('ArrowRight');
    assert.equal((await status()).chosen, 'precision-180', 'Right wraps');
    await key('ArrowLeft');
    assert.equal((await status()).chosen, 'slalom-sprint', 'Left wraps');
    await key('ArrowLeft');
    assert.equal((await status()).chosen, 'one-drift');
    await key('ArrowDown');
    assert.equal(await focused(), 'gymkhana-back');
    await key('ArrowUp');
    assert.equal(await focused(), 'gymkhana-start');
    await key('ArrowUp');
    assert.equal(await focused(), 'one-drift', 'Up reaches the chosen challenge');
    await key('ArrowUp');
    assert.equal(await focused(), 'gymkhana-back', 'and wraps');
    await key('ArrowDown');
    assert.equal(await focused(), 'one-drift');
    await key('ArrowLeft');
    assert.equal((await status()).chosen, 'linked-drift');
    assert.equal(await focused(), 'linked-drift', 'and there the focus follows the choice, one step at a time');
    await key('ArrowLeft');
    assert.equal((await status()).chosen, 'precision-180');
    await key('KeyH');
    s = await status();
    assert.equal(s.selected, 'revised', 'H changes the handling mode, as on the title');
    assert.match(await text('#gymkhana-handling'), /^Power handling\./);
    await key('KeyH');
    assert.equal((await status()).selected, 'classic');
    await p.sizes('the Gymkhana sheet', ['#gymkhana-menu .sheet', '#gymkhana-start', '#gymkhana-back']);
    await key('Escape');
    s = await status();
    assert.equal(s.sheet, false);
    assert.equal(await shown('#menu'), true);
    assert.equal(await focused(), 'gymkhana', 'Esc goes back to the button that opened the sheet');
    // A mouse click opens it too, and Back closes it.
    await page.locator('#gymkhana').click();
    await frames();
    assert.equal((await status()).sheet, true);
    await page.locator('#gymkhana-back').click();
    await frames();
    assert.equal((await status()).sheet, false);
    ok('sheet: four challenges, Left/Right choose and wrap, Up/Down walk the controls, H changes handling, Esc and Back close');

    // --- 3. Precision 180, clean ---------------------------------------------------------
    await page.locator('#gymkhana').focus();
    await key('Enter');
    await key('Enter'); // Start has the focus
    s = await status();
    assert.equal(s.kind, 'gymkhana');
    assert.equal(s.challenge, 'precision-180');
    assert.equal(s.track, 'gymkhana-precision-180');
    assert.equal(s.state, 'ready');
    assert.equal(s.ghost, false);
    assert.equal(s.sheet, false);
    assert.equal(await value(() => document.body.dataset.session), 'gymkhana');
    assert.equal(await shown('#gym-panel'), true);
    assert.equal(await text('#gym-name'), 'Precision 180');
    assert.equal(await text('#gym-handling'), 'Classic');
    assert.equal(await text('#gym-clock'), '0:00.00');
    assert.equal(await text('#gym-stage'), 'Next: Through the gate, down to the turn zone');
    assert.equal(await text('#gym-best'), 'Best: --');
    for (const sel of ['#hud .laps', '#hud .score', '#combo', '#ghost-status', '#handling-status']) assert.equal(await shown(sel), false, `${sel} is hidden in a timed challenge`);
    assert.equal(await shown('#hud .gauges'), true);
    assert.match(await text('#prompt'), /^Through the gate, down the box to the turn zone.*↑ to go\.R retry · P pause · Esc title$/);
    await frames(45); // the view settles between the car and the challenge
    await page.screenshot({ path: shot(`${name}-180-ready`) });
    await p.sizes('the challenge HUD', ['#gym-panel', '#prompt', '#hud .gauges']);

    let driven = await drive('handbrake180', TIDY, '#prompt');
    assert.equal(driven.phase, 'complete');
    assert.deepEqual(driven.seen.filter(Boolean).length, 0, 'the brief leaves once the clock is running');
    s = await status();
    assert.equal(s.state, 'finished');
    assert.equal(s.results, null, 'no circuit results');
    assert.equal(await shown('#results'), false);
    assert.equal(await shown('#gymkhana-results'), true);
    assert.equal(await text('#gr-eyebrow'), 'Precision 180 · Classic handling');
    assert.equal(await text('#gr-title'), 'Complete');
    assert.equal(await text('#gr-reason'), 'Round in one slide, and clean.');
    assert.equal(await text('#gr-label'), 'Time');
    assert.equal(await text('#gr-value'), `${s.result.total.toFixed(2)} s`);
    assert.equal(await shown('#gr-new'), true, 'the first completed run is a NEW BEST');
    assert.match(await text('#gr-stats'), /Driving time\d+\.\d\d sConesNoneEntry speed\d+ mphTurnSlide, \d+°Exit line.+Exit speed\d+ mph/);
    assert.equal(await text('#gr-best'), `Personal best with Classic handling: ${s.result.total.toFixed(2)} s`);
    assert.deepEqual(await saved(), { version: 1, challenges: { 'precision-180': { classic: { 'precision-180-1': { best: s.result.total } } } } });
    assert.equal(await text('#gym-best'), `Best: ${s.result.total.toFixed(2)} s`);
    await page.screenshot({ path: shot(`${name}-180-complete`) });
    await p.sizes('the results sheet', ['#gymkhana-results .sheet', '#gymkhana-again', '#gymkhana-change', '#gymkhana-results .return-title']);
    const firstTotal = s.result.total;
    const firstRun = s.runId;
    ok(`Precision 180 clean: ${firstTotal.toFixed(2)} s on its own results sheet, NEW BEST, saved under ${KEY}`);

    // --- 4. Retry, failure, a cone, and restart ------------------------------------------
    await key('Enter');
    s = await status();
    assert.equal(s.state, 'ready', 'Enter on the results retries the same challenge');
    assert.equal(s.challenge, 'precision-180');
    assert.equal(s.time, 0);
    assert.equal(s.runId, firstRun + 1);
    assert.equal(await shown('#gymkhana-results'), false);
    assert.equal(await shown('#prompt'), true, 'the brief is back on the line');
    driven = await drive('handbrake180', FLAT_OUT);
    assert.equal(driven.phase, 'failed');
    s = await status();
    assert.equal(s.state, 'finished');
    assert.equal(s.reason, 'left the box');
    assert.equal(await value(() => document.getElementById('gymkhana-results').dataset.outcome), 'failed');
    assert.equal(await text('#gr-title'), 'Run failed');
    assert.match(await text('#gr-reason'), /^You left the box\./);
    assert.equal(await text('#gr-value'), '--');
    assert.equal(await shown('#gr-new'), false);
    assert.equal(await text('#gr-best'), `Personal best with Classic handling: ${firstTotal.toFixed(2)} s`);
    assert.equal((await saved()).challenges['precision-180'].classic['precision-180-1'].best, firstTotal, 'a failure sets no record');
    await page.screenshot({ path: shot(`${name}-180-failed`) });

    await key('KeyR');
    assert.equal((await status()).state, 'ready', 'R on the results retries too');
    driven = await drive('handbrake180', CLIPS_A_CONE, '#banner');
    s = await status();
    assert.ok(s.result.cones >= 1);
    assert.ok(driven.seen.some((t) => /^CONE \+\d S$/.test(t)), `the banner announced the penalty: ${JSON.stringify(driven.seen)}`);
    assert.match(await text('#gym-cones'), /^\d cones? · \+\d s$/);
    if (driven.phase === 'complete') {
      assert.match(await text('#gr-stats'), /Cones\d \(\+\d s\)/);
      assert.match(await text('#gr-reason'), /cones? cost \d seconds\.$/);
      assert.equal(await shown('#gr-new'), false, 'slower with the penalty');
    }
    await page.locator('#gymkhana-again').click();
    await frames();
    s = await status();
    assert.equal(s.state, 'ready', 'Try again retries');
    assert.equal(await text('#gym-cones'), '', 'with every cone standing again');
    // Mid-run: R puts the car back on the line with the clock at zero.
    await value(() => { window.__miniDrifters.input.up = true; window.__frames(60); window.__miniDrifters.input.up = false; });
    s = await status();
    assert.equal(s.state, 'racing');
    assert.ok(s.time > 0.5);
    await key('KeyR');
    s = await status();
    assert.equal(s.state, 'ready');
    assert.equal(s.time, 0);
    assert.equal(await text('#gym-clock'), '0:00.00');
    assert.deepEqual(Object.keys((await saved()).challenges), ['precision-180'], 'none of that saved anything new');
    ok('Enter, R and Try again retry; flat out fails with its reason and no record; a cone is announced and costed; R restarts mid-run');

    // --- 5. Pause ------------------------------------------------------------------------
    await key('KeyP');
    assert.equal((await status()).paused, true);
    assert.equal(await shown('#paused'), true);
    assert.equal(await text('#paused-note'), 'Precision 180. Press P to carry on, or R to try again.');
    await page.locator('#paused .options-open').click();
    await frames();
    assert.equal(await shown('#options'), true, 'Options opens from a paused challenge');
    await key('Escape');
    assert.equal(await shown('#paused'), true);
    await page.locator('#restart').click();
    await frames();
    s = await status();
    assert.equal(s.paused, false);
    assert.equal(s.state, 'ready');
    assert.equal(s.challenge, 'precision-180');
    await key('KeyP');
    await key('KeyP');
    assert.equal((await status()).paused, false);
    ok('pause: its own note, Options, Restart and resume all work in a challenge');

    // --- 6. Linked Drift, from the results' Challenges button ----------------------------
    await drive('handbrake180', FLAT_OUT);
    await page.locator('#gymkhana-change').click();
    await frames();
    s = await status();
    assert.equal(s.state, 'menu');
    assert.equal(s.sheet, true, 'Challenges goes straight back to the sheet');
    assert.equal(s.chosen, 'precision-180', 'with the challenge just driven still chosen');
    assert.equal(await text('#challenge-best'), `${firstTotal.toFixed(2)} s`);
    assert.equal(await shown('#gym-panel'), false);
    await page.screenshot({ path: shot(`${name}-sheet-with-best`) });
    await page.locator('#challenges .station', { hasText: 'Linked Drift' }).click();
    await frames();
    assert.equal((await status()).chosen, 'linked-drift');
    assert.equal(await text('#challenge-best'), '--', 'each challenge has its own record');
    await page.locator('#gymkhana-start').click();
    await frames();
    s = await status();
    assert.equal(s.challenge, 'linked-drift');
    assert.equal(s.track, 'gymkhana-linked-drift');
    assert.equal(await value(() => document.body.dataset.challenge), 'score');
    assert.equal(await shown('#hud .score'), true, 'a scored challenge shows the score');
    assert.equal(await shown('#hud .laps'), false);
    assert.equal(await text('#gym-gates'), 'Gates 0/6');
    assert.equal(await text('#gym-stage'), 'Next: Gate 1');
    await frames(45);
    await page.screenshot({ path: shot(`${name}-linked-ready`) });
    driven = await drive('courseDrift', DRIFT, '#banner');
    assert.equal(driven.phase, 'complete');
    s = await status();
    assert.ok(s.result.score > 300, `scored ${s.result.score}`);
    assert.equal(s.score, s.result.score);
    assert.ok(driven.seen.some((t) => /BANKED$/.test(t)), 'the scoring banners are the game\'s own');
    assert.equal(await text('#gym-gates'), 'Gates 6/6');
    assert.equal(await text('#gr-title'), 'Complete');
    assert.equal(await text('#gr-label'), 'Score');
    assert.equal(await text('#gr-value'), s.result.score.toLocaleString('en-US'));
    assert.equal(await shown('#gr-new'), true);
    assert.match(await text('#gr-stats'), /Best combo[\d,]+ \(×\d(\.\d)?\)Gates drifted\d of 6Distance\d+ mCones(None|\d)Spinouts\dTime\d+\.\d s/);
    assert.equal((await saved()).challenges['linked-drift'].classic['linked-drift-1+scoring-2'].best, s.result.score);
    assert.equal((await saved()).challenges['precision-180'].classic['precision-180-1'].best, firstTotal, 'the other record is untouched');
    await page.screenshot({ path: shot(`${name}-linked-complete`) });
    const linkedScore = s.result.score;
    await key('Enter');
    driven = await drive('courseGrip', { lateral: 60 }); // far too quick for the first bend
    assert.equal(driven.phase, 'failed');
    assert.match(await text('#gr-reason'), /^You missed gate \d\. Every gate has to be taken, in order\.$/);
    assert.equal(await text('#gr-value'), '--');
    assert.match(await text('#gr-stats'), /Banked, not counted[\d,]+Best combo/);
    assert.equal((await saved()).challenges['linked-drift'].classic['linked-drift-1+scoring-2'].best, linkedScore);
    ok(`Linked Drift: ${linkedScore} points with the game's own score, combo and banners; a missed gate fails and counts for nothing`);

    // --- 7. One Drift, in Power, after Esc to the title ----------------------------------
    await key('Escape');
    s = await status();
    assert.equal(s.state, 'menu');
    assert.equal(s.sheet, false);
    assert.equal(await focused(), 'gymkhana', 'Esc from a challenge lands on the Gymkhana button');
    assert.equal(await shown('#gymkhana-results'), false);
    assert.equal(await value(() => document.body.dataset.challenge ?? null), null);
    await key('KeyH');
    assert.equal((await status()).selected, 'revised');
    await key('Enter');
    assert.equal((await status()).chosen, 'linked-drift', 'the sheet remembers the last challenge for the visit');
    await key('ArrowRight');
    assert.equal(await text('#challenge-best'), '--');
    await key('Enter');
    s = await status();
    assert.equal(s.challenge, 'one-drift');
    assert.equal(s.handling, 'revised');
    assert.equal(await text('#gym-name'), 'One Drift');
    assert.equal(await text('#gym-handling'), 'Power');
    driven = await drive('courseDrift', DRIFT);
    s = await status();
    assert.equal(s.state, 'finished');
    assert.equal(await text('#gr-eyebrow'), 'One Drift · Power handling');
    if (driven.phase === 'complete') {
      assert.equal(await text('#gr-title'), s.result.ended === 'banked' ? 'Drift banked' : 'Complete');
      assert.equal((await saved()).challenges['one-drift'].revised['one-drift-1+scoring-2'].best, s.result.score);
    } else {
      assert.match(await text('#gr-reason'), /^The drift was lost: /);
      assert.equal((await saved()).challenges['one-drift'], undefined);
    }
    await page.screenshot({ path: shot(`${name}-one-drift-result`) });
    assert.equal((await saved()).challenges['linked-drift'].revised, undefined, 'Power has no Linked Drift record: each mode keeps its own');
    ok(`One Drift in Power: ${driven.phase}${s.result.ended === 'banked' ? `, banked ${s.result.score}` : ''}; the sheet remembered the last challenge`);

    // --- 8. What was written -------------------------------------------------------------
    assert.deepEqual((await writes()).sort(), [KEY, 'mini-drifters-handling'], 'only the gymkhana records and the handling choice were written');
    assert.equal(await value((k) => localStorage.getItem(k), CIRCUIT_KEY), null, 'the circuit records were never written');

    // --- 9. Controller -------------------------------------------------------------------
    await page.locator('#gymkhana-results .return-title').click();
    await frames();
    assert.equal((await status()).state, 'menu');
    assert.equal(await focused(), 'gymkhana');
    await value(() => { window.__pads = [window.__newPad()]; window.__frames(3); });
    await press(0); // A on the focused Gymkhana button
    s = await status();
    assert.equal(s.sheet, true, 'A opens the sheet');
    assert.equal(await focused(), 'gymkhana-start');
    assert.match(await text('#gymkhana-handling'), /chosen on the title screen/);
    await press(12); // up, onto the chosen challenge
    assert.equal(await focused(), 'one-drift');
    await press(15); // right: the next challenge
    assert.equal((await status()).chosen, 'slalom-sprint');
    assert.equal(await focused(), 'slalom-sprint', 'the focus follows the choice');
    await press(15); // right again, wrapping
    assert.equal((await status()).chosen, 'precision-180');
    await press(13); await press(12); // down to Start and back up
    assert.equal(await focused(), 'precision-180', 'Up from Start reaches the chosen challenge, whichever it is');
    await press(1); // B
    assert.equal((await status()).sheet, false, 'B closes the sheet');
    assert.equal(await focused(), 'gymkhana');
    await press(0);
    await press(0); // A on Start
    s = await status();
    assert.equal(s.challenge, 'precision-180');
    assert.equal(s.state, 'ready');
    assert.match(await text('#prompt'), /RT to go\.X retry · Menu pause$/);
    await value(() => { window.__pads[0].buttons[7] = { value: 1, pressed: true }; window.__frames(40); });
    s = await status();
    assert.equal(s.state, 'racing', 'the right trigger drives');
    assert.ok(s.time > 0.3);
    await value(() => { window.__pads[0].buttons[7] = { value: 0, pressed: false }; window.__frames(2); });
    await press(2); // X
    s = await status();
    assert.equal(s.state, 'ready', 'X retries');
    assert.equal(s.time, 0);
    await press(9); // Menu
    assert.equal((await status()).paused, true, 'Menu pauses');
    assert.equal(await text('#paused-note'), 'Precision 180. Menu to carry on, or Restart to try again.');
    await press(9);
    assert.equal((await status()).paused, false);
    // Flat out with the trigger held: the run fails, and its sheet is driven by the pad.
    await value(() => { window.__pads[0].buttons[7] = { value: 1, pressed: true }; for (let i = 0; i < 900 && window.__miniDrifters.game.state !== 'finished'; i++) window.__frames(1); window.__pads[0].buttons[7] = { value: 0, pressed: false }; window.__frames(2); });
    s = await status();
    assert.equal(s.state, 'finished');
    assert.equal(s.phase, 'failed');
    await press(0); // A: the first control, Try again
    s = await status();
    assert.equal(s.state, 'ready', 'A on the results retries');
    await value(() => { window.__pads[0].buttons[7] = { value: 1, pressed: true }; for (let i = 0; i < 900 && window.__miniDrifters.game.state !== 'finished'; i++) window.__frames(1); window.__pads[0].buttons[7] = { value: 0, pressed: false }; window.__frames(2); });
    await press(13); // down: the first control, then the next
    assert.equal(await focused(), 'gymkhana-again');
    await press(13);
    assert.equal(await focused(), 'gymkhana-change');
    await press(1); // B
    s = await status();
    assert.equal(s.state, 'menu', 'B on the results returns to the title');
    assert.equal(await focused(), 'gymkhana');
    await value(() => { window.__pads = []; window.__frames(3); });
    await page.mouse.move(5, 5);
    await page.mouse.down();
    await page.mouse.up();
    await frames();
    ok('controller: A opens the sheet and starts, D-pad chooses, RT drives, X retries, Menu pauses, A/B work the results');

    // --- 10. A normal run afterwards, and the practice pad -------------------------------
    await openTracks(page); await page.locator('#start').click();
    await frames();
    s = await status();
    assert.equal(s.kind, 'normal');
    assert.equal(s.track, 'original');
    assert.equal(s.challenge, null);
    assert.equal(s.ghost, true);
    assert.equal(await shown('#hud .laps'), true, 'the lap panel is back');
    assert.equal(await shown('#hud .score'), true);
    assert.equal(await shown('#gym-panel'), false);
    assert.equal(await value(() => document.getElementById('prompt').dataset.kind), '');
    assert.match(await text('#prompt'), /^Press ↑ to go\./);
    await key('Escape');
    assert.equal((await status()).state, 'ready', 'Esc does not leave a circuit run, as before');
    await page.locator('#sound').focus();
    await key('KeyP');
    await page.locator('#paused .return-title').click();
    await frames();
    assert.equal(await focused(), 'tracks-open', 'leaving a circuit run lands on Start, as before');
    await openTracks(page); await page.locator('#practice').click();
    await frames();
    s = await status();
    assert.equal(s.kind, 'practice');
    assert.equal(await shown('#gym-panel'), false);
    await key('Escape');
    assert.equal(await focused(), 'tracks-open');
    ok('afterwards a circuit run and the practice pad are as they were: laps, ghost, HUD, prompt and where focus lands');

    // --- 11. A reload -------------------------------------------------------------------
    await p.load();
    s = await status();
    assert.equal(s.selected, 'revised', 'the handling choice is remembered');
    await page.locator('#gymkhana').click();
    await frames();
    assert.equal((await status()).chosen, 'precision-180', 'the challenge is not: a new visit starts on the first');
    assert.equal(await text('#challenge-best'), '--', 'Power has no Precision 180 record');
    await key('KeyH');
    assert.equal(await text('#challenge-best'), `${firstTotal.toFixed(2)} s`, 'Classic\'s record survived the reload');
    await key('ArrowRight');
    assert.equal(await text('#challenge-best'), linkedScore.toLocaleString('en-US'));
    await key('Escape');
    ok('reload: records are still there, per challenge and handling mode');
    await context.close();

    // Require both One Drift outcomes with real driving, independent of the Power attempt.
    const singleContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await singleContext.addInitScript(harness);
    const single = await open(singleContext);
    await single.load();
    await single.page.locator('#gymkhana').click();
    await single.frames();
    await single.key('ArrowRight');
    await single.key('ArrowRight');
    await single.key('Enter');
    assert.equal((await single.drive('courseFirstCombo', { lose: false })).phase, 'complete');
    const banked = await single.status();
    assert.equal(banked.result.ended, 'banked');
    assert.equal(await single.text('#gr-title'), 'Drift banked');
    assert.equal(await single.shown('#gr-new'), true);
    assert.equal((await single.saved()).challenges['one-drift'].classic['one-drift-1+scoring-2'].best, banked.result.score);
    assert.equal((await single.saved()).challenges['linked-drift'], undefined, 'One Drift never creates a Linked Drift record');
    await single.page.screenshot({ path: shot(`${name}-one-drift-banked`) });
    await single.key('KeyR');
    assert.equal((await single.drive('courseFirstCombo', { lose: true })).phase, 'failed');
    assert.match(await single.text('#gr-reason'), /^The drift was lost: spun out/);
    assert.equal(await single.shown('#gr-new'), false);
    assert.equal((await single.saved()).challenges['one-drift'].classic['one-drift-1+scoring-2'].best, banked.result.score, 'losing the first combo preserves the successful record');
    await single.page.screenshot({ path: shot(`${name}-one-drift-lost`) });
    await singleContext.close();
    ok('One Drift in Classic: first combo banks to a saved success; losing it fails and preserves the record');

    // --- 12. Saved by a newer version, and storage denied --------------------------------
    const newer = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await newer.addInitScript(harness);
    await newer.addInitScript((k) => localStorage.setItem(k, JSON.stringify({ version: 2, challenges: { 'precision-180': { classic: { 'precision-180-1': { best: 1 } } } } })), KEY);
    const n = await open(newer);
    await n.load();
    const later = await n.value((k) => localStorage.getItem(k), KEY);
    await n.page.locator('#gymkhana').click();
    await n.frames();
    assert.equal(await n.text('#challenge-best'), '--');
    assert.match(await n.text('#gymkhana-records-note'), /saved by a newer version/);
    await n.page.locator('#gymkhana-start').click();
    await n.frames();
    assert.equal((await n.drive('handbrake180', TIDY)).phase, 'complete');
    assert.equal(await n.shown('#gr-new'), false, 'no NEW BEST over a later version\'s data');
    assert.match(await n.text('#gr-records-note'), /saved by a newer version/);
    assert.equal(await n.value((k) => localStorage.getItem(k), KEY), later, 'which is left exactly as it was');
    await newer.close();

    const denied = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await denied.addInitScript(() => Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Denied', 'SecurityError'); } }));
    await denied.addInitScript(() => {
      window.requestAnimationFrame = (callback) => { window.__nextFrame = callback; return 1; };
      let now;
      window.__frames = (count = 2, dt = 1000 / 60) => { now ??= performance.now(); for (let i = 0; i < count; i++) { now += dt; window.__nextFrame(now); } };
      window.__drive = async (driverName, params, maxSeconds) => {
        const drivers = await import('/test/support/gymkhana-drivers.mjs');
        const m = window.__miniDrifters;
        const driver = drivers[driverName](params);
        for (let i = 0; i < maxSeconds * 60 && m.game.state !== 'finished'; i++) { Object.assign(m.input, driver(m.game)); window.__frames(1); }
        for (const k of Object.keys(m.input)) m.input[k] = false;
        window.__frames(2);
        return { phase: m.game.challenge.phase, seen: [] };
      };
    });
    const d = await open(denied);
    await d.load();
    await d.page.locator('#gymkhana').click();
    await d.frames();
    assert.match(await d.text('#gymkhana-records-note'), /^Record storage unavailable/);
    await d.page.locator('#gymkhana-start').click();
    await d.frames();
    assert.equal((await d.drive('handbrake180', TIDY)).phase, 'complete');
    assert.equal(await d.text('#gr-title'), 'Complete');
    assert.equal(await d.shown('#gr-new'), false, 'nothing saved, so nothing claimed');
    assert.match(await d.text('#gr-best'), /^No personal best yet/);
    assert.match(await d.text('#gr-records-note'), /^Record storage unavailable/);
    await d.sizes('the results sheet with a storage note', ['#gymkhana-results .sheet', '#gymkhana-again', '#gymkhana-results .return-title']);
    await d.key('Enter');
    assert.equal((await d.status()).state, 'ready', 'and the challenge still retries');
    await denied.close();
    ok('a later version\'s records are left alone and say so; with storage denied the mode still plays and claims nothing');

    assert.deepEqual(errors, [], 'no page errors');
    ok('no page errors');
  } finally {
    await browser.close();
  }
}

try {
  await check('chromium', chromium);
  await check('firefox', firefox);
  console.log('gymkhana browser check passed');
} finally {
  server.close();
}
