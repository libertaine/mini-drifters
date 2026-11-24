// Analytics: who may be counted, what is sent and when, and that the game never notices.
// Nothing here touches the network: the tracker is a fake window, and the events are recorded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { TUNING as T } from '../src/tuning.js';
import { createGame, startRun, restartRun, returnToMenu, togglePause, advance, NO_INPUT } from '../src/game.js';
import { drivingActive } from '../src/controls.js';
import { handlingById } from '../src/handling.js';
import { padTrack } from '../src/practice-pad.js';
import { trackById } from '../src/track.js';
import { PRECISION_180 } from '../src/gymkhana.js';
import { createUrbanChallenge } from '../src/getaway-urban.js';
import { createRecords, RECORDS_KEY } from '../src/records.js';
import { createGymkhanaRecords, GYMKHANA_RECORDS_KEY } from '../src/gymkhana-records.js';
import { createGetawayRecords, GETAWAY_RECORDS_KEY } from '../src/getaway-records.js';
import {
  CATEGORIES, ENGAGEMENT_THRESHOLDS, EVENTS, EVENT_PREFIX, IDLE_MS, LAP_NUMBERS, MAX_COUNTED_RUNS, MAX_FRAME_GAP_MS,
  categoryOf, createAnalytics,
} from '../src/analytics.js';
import {
  PREFERENCES, SCENARIO_PARAMS, TRACKER_SRC, WEBSITE_ID, analyticsAllowed, loadTracker, startAnalytics,
} from '../src/analytics-tracker.js';
import { gripDriver } from './support/drivers.mjs';
import * as D from './support/gymkhana-drivers.mjs';
import { urbanGrip, urbanStall } from './support/urban-drivers.mjs';

const SITE = 'https://libertaine.github.io/mini-drifters/';
const DEG = Math.PI / 180;
const CLASSIC = handlingById('classic');

// --- A fake browser: just enough for the gate and the loader, and no network at all ------------
function fakeWindow(url = SITE, { nav = {}, win = {} } = {}) {
  const { protocol, hostname, pathname, search, hash } = new URL(url);
  const appended = [];
  const touched = [];
  const window = {
    location: { protocol, hostname, pathname, search, hash },
    navigator: { webdriver: false, ...nav },
    performance: { now: () => 0 },
    appended,
    touched,
    document: {
      visibilityState: 'visible',
      hasFocus: () => true,
      get cookie() { touched.push('cookie'); return ''; },
      set cookie(_) { touched.push('cookie'); },
      createElement: () => {
        const handlers = {}, attributes = {};
        return { attributes, addEventListener: (type, fn) => { handlers[type] = fn; }, fire: (type) => handlers[type]?.(),
          setAttribute: (name, value) => { attributes[name] = value; } };
      },
      head: { append: (element) => appended.push(element) },
    },
    get localStorage() { touched.push('localStorage'); throw new Error('storage is not for analytics'); },
    get sessionStorage() { touched.push('sessionStorage'); throw new Error('storage is not for analytics'); },
    ...win,
  };
  return window;
}
const allowed = (url, options) => analyticsAllowed(fakeWindow(url, options));

// --- 1. The gate ---------------------------------------------------------------------------------
test('only the two published HTTPS addresses are counted', () => {
  assert.equal(allowed(SITE), true);
  assert.equal(allowed(`${SITE}index.html`), true);
  for (const url of [
    'http://libertaine.github.io/mini-drifters/',
    'https://libertaine.github.io/', 'https://libertaine.github.io/mini-drifters', 'https://libertaine.github.io/Mini-Drifters/',
    'https://libertaine.github.io/mini-drifters/audio-lab/', 'https://libertaine.github.io/mini-drifters/other.html',
    'https://libertaine.github.io/Steeped-in-Trouble/', 'https://libertaine.github.io.example.com/mini-drifters/',
    'https://example.github.io/mini-drifters/', 'https://www.libertaine.github.io/mini-drifters/',
  ]) assert.equal(allowed(url), false, url);
});

test('local play, the browser checks and other hosting stay uncounted', () => {
  for (const url of ['http://127.0.0.1:4190/', 'http://127.0.0.1:4190/mini-drifters/', 'http://localhost:4190/mini-drifters/',
    'http://192.168.1.5:4190/mini-drifters/', 'file:///D:/Projects/mini-drifters/index.html', 'https://mini-drifters.pages.dev/mini-drifters/']) {
    assert.equal(allowed(url), false, url);
  }
});

test('?analytics=off turns it off, whatever its case or spacing, and nothing else does', () => {
  for (const query of ['?analytics=off', '?analytics=OFF', '?analytics=Off', '?analytics=%20off%20', '?utm_source=x&analytics=off']) {
    assert.equal(allowed(`${SITE}${query}`), false, query);
  }
  assert.equal(allowed(`${SITE}?analytics=on`), true);
  assert.equal(allowed(`${SITE}?utm_source=forum`), true);
  assert.equal(allowed(`${SITE}#somewhere`), true, 'a fragment is not a scenario');
});

test('every debug, replay, research and test scenario stays uncounted', () => {
  for (const name of SCENARIO_PARAMS) {
    assert.equal(allowed(`${SITE}?${name}`), false, name);
    assert.equal(allowed(`${SITE}?${name}=0`), false, `${name}=0`);
  }
  for (const query of ['?debug', '?driver', '?debug&driver', '?replay=1']) assert.equal(allowed(`${SITE}${query}`), false, query);
  assert.ok(SCENARIO_PARAMS.includes('debug') && SCENARIO_PARAMS.includes('driver'));
});

test('every URL parameter the game reads has to choose a side', () => {
  const files = readdirSync(new URL('../src/', import.meta.url)).filter((file) => file.endsWith('.js'));
  const readers = [];
  const read = new Set();
  for (const file of files) {
    const text = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    if (!/URLSearchParams|location\.search|searchParams/.test(text)) continue;
    readers.push(file);
    for (const [, name] of text.matchAll(/\.(?:get|has|getAll)\('(\w+)'\)/g)) read.add(name);
  }
  // Today only the analytics gate reads the address. A new switch must be listed in the gate.
  assert.deepEqual(readers, ['analytics-tracker.js']);
  for (const name of read) assert.ok([...SCENARIO_PARAMS, ...PREFERENCES].includes(name), name);
});

test('an automated browser is never counted', () => {
  assert.equal(allowed(SITE, { nav: { webdriver: true } }), false);
});

test('Do Not Track is respected wherever the browser reports it', () => {
  assert.equal(allowed(SITE, { nav: { doNotTrack: '1' } }), false);
  assert.equal(allowed(SITE, { nav: { doNotTrack: 'yes' } }), false);
  assert.equal(allowed(SITE, { nav: { msDoNotTrack: '1' } }), false);
  assert.equal(allowed(SITE, { win: { doNotTrack: '1' } }), false);
  assert.equal(allowed(SITE, { nav: { doNotTrack: '0' } }), true);
  assert.equal(allowed(SITE, { nav: { doNotTrack: null } }), true);
});

// --- 2. The loader -------------------------------------------------------------------------------
test('a counted page gets one asynchronous, correctly configured tracker', () => {
  const win = fakeWindow();
  const analytics = startAnalytics(win);
  assert.ok(analytics);
  assert.equal(win.appended.length, 1);
  const [script] = win.appended;
  assert.equal(script.src, TRACKER_SRC);
  assert.equal(TRACKER_SRC, 'https://cloud.umami.is/script.js');
  assert.equal(script.async, true);
  assert.equal(script.defer, true);
  assert.deepEqual(script.attributes, {
    'data-website-id': '6f121a0f-990e-4457-8269-6f4833c81820',
    'data-domains': 'libertaine.github.io',
    'data-exclude-search': 'true',
    'data-exclude-hash': 'true',
    'data-do-not-track': 'true',
  });
  assert.equal(WEBSITE_ID, '6f121a0f-990e-4457-8269-6f4833c81820');
  assert.deepEqual(win.touched, [], 'no cookie or storage is read or written');
});

test('an uncounted page gets nothing at all', () => {
  for (const [url, options] of [[`${SITE}?analytics=off`], [`${SITE}?debug`], [`${SITE}?driver`], ['http://127.0.0.1:4190/'],
    [SITE, { nav: { webdriver: true } }], [SITE, { nav: { doNotTrack: '1' } }]]) {
    const win = fakeWindow(url, options);
    assert.equal(startAnalytics(win), null, url);
    assert.equal(win.appended.length, 0, url);
    assert.deepEqual(win.touched, [], url);
  }
});

test('events raised before the tracker arrives wait for it, a bounded few, and are delivered once', () => {
  const win = fakeWindow();
  const sink = loadTracker(win);
  sink.send('md_game_start');
  sink.send('md_run_start', { category: 'tracks' });
  for (let i = 0; i < 40; i += 1) sink.send('md_lap_milestone', { lap: 1 });
  const calls = [];
  win.umami = { track: (...args) => calls.push(args) };
  win.appended[0].fire('load');
  sink.send('md_engaged_30s');
  assert.equal(calls.length, 17, 'sixteen waited, and one was sent live');
  assert.deepEqual(calls.slice(0, 2), [['md_game_start', undefined], ['md_run_start', { category: 'tracks' }]]);
  assert.deepEqual(calls.at(-1), ['md_engaged_30s', undefined]);
  win.appended[0].fire('load');
  assert.equal(calls.length, 17, 'nothing is delivered twice');
});

test('a blocked tracker fails quietly, drops what waited, and is never retried', () => {
  const win = fakeWindow();
  const sink = loadTracker(win);
  sink.send('md_game_start');
  win.appended[0].fire('error');
  win.umami = { track: () => assert.fail('nothing is sent after a failure') };
  assert.doesNotThrow(() => { for (let i = 0; i < 100; i += 1) sink.send('md_run_start', { category: 'tracks' }); });
  assert.equal(win.appended.length, 1);
});

test('a tracker that loads without umami, throws or rejects costs nothing', async () => {
  const win = fakeWindow();
  const sink = loadTracker(win);
  win.appended[0].fire('load');
  assert.doesNotThrow(() => sink.send('md_game_start'));

  const throwing = fakeWindow(SITE, { win: { umami: { track() { throw new Error('tracker'); } } } });
  assert.doesNotThrow(() => loadTracker(throwing).send('md_game_start'));

  let rejection;
  const rejecting = fakeWindow(SITE, { win: { umami: { track: () => { rejection = Promise.reject(new Error('net')); return rejection; } } } });
  loadTracker(rejecting).send('md_game_start');
  await rejection.catch(() => {});
});

test('a page that cannot take a script just goes uncounted', () => {
  const win = fakeWindow();
  win.document.createElement = () => { throw new Error('no'); };
  assert.equal(startAnalytics(win), null);
});

// --- 3. What is sent, from the real game -------------------------------------------------------
const NAMES = new Set([...Object.values(EVENTS), ...ENGAGEMENT_THRESHOLDS.map(([name]) => name)]);

// The contract in docs/ANALYTICS.md: md_ names, and no data but a category or a lap number.
function assertContract(sent) {
  for (const [name, data, ...rest] of sent) {
    assert.ok(name.startsWith(EVENT_PREFIX) && NAMES.has(name), name);
    assert.deepEqual(rest, []);
    if (name === EVENTS.runStart || name === EVENTS.runComplete) {
      assert.deepEqual(Object.keys(data), ['category'], name);
      assert.ok(CATEGORIES.includes(data.category), data.category);
    } else if (name === EVENTS.lap) {
      assert.deepEqual(Object.keys(data), ['lap']);
      assert.ok(LAP_NUMBERS.includes(data.lap), String(data.lap));
    } else {
      assert.equal(data, undefined, name);
    }
  }
  assert.ok(sent.filter(([name]) => name === EVENTS.gameStart).length <= 1, 'one game start per page load');
}

// The page's own wiring (main.js): run events after the records, one frame per 1/60 s after the
// simulation, with a clock that only the frames move.
function page({ foreground = () => true, records = null } = {}) {
  const sent = [];
  const clock = { ms: 1000 };
  const analytics = createAnalytics({ send: (name, data) => sent.push(data === undefined ? [name] : [name, data]),
    now: () => clock.ms, foreground: () => foreground() });
  const game = createGame(undefined, { onRunEvent: (event) => {
    records?.(event);
    analytics.runEvent(event, { lap: game.laps.completed, category: categoryOf({ mode: game.mode, layout: game.challengeDef?.layout }) });
  } });
  const frame = (keys = NO_INPUT) => {
    clock.ms += 1000 / 60;
    advance(game, 1 / 60, keys);
    analytics.frame({ runId: game.runId, category: categoryOf({ mode: game.mode, layout: game.challengeDef?.layout }),
      racing: game.state === 'racing' && !game.paused, active: drivingActive(keys) });
  };
  // Frames for some seconds, or until `until` says so. `keys` is an object or a driver.
  const play = (seconds, keys = NO_INPUT, until = null) => {
    for (let i = 0; i < seconds * 60; i += 1) {
      frame(typeof keys === 'function' ? keys(game) : keys);
      if (until?.(game)) return;
    }
  };
  const names = () => sent.map(([name]) => name);
  return { analytics, game, sent, clock, frame, play, names };
}
const finished = (game) => game.state === 'finished';
const circuit = (p) => startRun(p.game, { track: trackById('original'), handling: CLASSIC });
const challenge = (p, def) => startRun(p.game, { mode: 'gymkhana', ghost: false, handling: CLASSIC, challenge: def });

test('the run modes map to three categories, and the lesson and the pad to none', () => {
  assert.equal(categoryOf({ mode: 'normal' }), 'tracks');
  assert.equal(categoryOf({ mode: 'gymkhana', layout: 'box' }), 'gymkhana');
  assert.equal(categoryOf({ mode: 'gymkhana', layout: 'slalom' }), 'gymkhana');
  assert.equal(categoryOf({ mode: 'gymkhana', layout: 'urban' }), 'getaway');
  assert.equal(categoryOf({ mode: 'tutorial' }), null);
  assert.equal(categoryOf({ mode: 'practice' }), null);
  assert.deepEqual(CATEGORIES, ['tracks', 'gymkhana', 'getaway']);
});

test('the title and the grid send nothing: a run starts on the first press, and the game once per page load', () => {
  const p = page();
  p.play(2);
  assert.deepEqual(p.sent, [], 'the title');
  circuit(p);
  p.play(3);
  assert.deepEqual(p.sent, [], 'waiting on the grid');
  p.play(0.5, { up: true });
  assert.deepEqual(p.sent, [['md_game_start'], ['md_run_start', { category: 'tracks' }]]);
  p.play(1, { up: true });
  assert.equal(p.sent.length, 2, 'once per run');
  // A retry that is driven is another run, but the game has already started.
  restartRun(p.game);
  p.play(0.5, { up: true });
  returnToMenu(p.game);
  challenge(p, PRECISION_180);
  p.play(0.5, { up: true });
  assert.deepEqual(p.sent, [['md_game_start'], ['md_run_start', { category: 'tracks' }], ['md_run_start', { category: 'tracks' }],
    ['md_run_start', { category: 'gymkhana' }]]);
  assertContract(p.sent);
});

test('restarting or leaving from the grid, and pausing, start nothing', () => {
  const p = page();
  circuit(p);
  for (let i = 0; i < 5; i += 1) {
    p.play(0.3);
    restartRun(p.game);
  }
  returnToMenu(p.game);
  challenge(p, PRECISION_180);
  togglePause(p.game);
  p.play(2, { up: true });
  assert.equal(p.game.state, 'ready', 'paused on the line');
  togglePause(p.game);
  returnToMenu(p.game);
  assert.deepEqual(p.sent, []);
});

test('a whole circuit run sends its start, each valid lap once, and its completion', () => {
  const p = page();
  circuit(p);
  p.play(400, gripDriver(), finished);
  assert.ok(finished(p.game), 'three laps done');
  assert.equal(p.game.laps.completed, T.runLaps);
  assert.equal(p.game.laps.voided, 0);
  p.play(1);
  // Laps and the finish in the order they happened; play time alongside, at its own pace.
  assert.deepEqual(p.sent.filter(([name]) => !name.startsWith('md_engaged')), [['md_game_start'], ['md_run_start', { category: 'tracks' }],
    ['md_lap_milestone', { lap: 1 }], ['md_lap_milestone', { lap: 2 }], ['md_lap_milestone', { lap: 3 }], ['md_run_complete', { category: 'tracks' }]]);
  const engaged = p.names().filter((name) => name.startsWith('md_engaged'));
  assert.deepEqual(engaged, ENGAGEMENT_THRESHOLDS.slice(0, engaged.length).map(([name]) => name));
  assert.ok(engaged.length >= 1, 'three laps are well over 30 seconds');
  assertContract(p.sent);
});

test('a retried or abandoned circuit run sends no completion, and its old laps are never replayed', () => {
  const p = page();
  circuit(p);
  const driver = gripDriver();
  p.play(400, driver, (game) => game.laps.completed >= 1);
  const oldRun = p.game.runId;
  const lapsSoFar = p.names().filter((name) => name === 'md_lap_milestone').length;
  assert.equal(lapsSoFar, 1);
  restartRun(p.game); // a retry mid-run
  // An event from the run that was retried is not taken for the new one.
  p.analytics.runEvent({ type: 'finish', runId: oldRun }, {});
  p.analytics.runEvent({ type: 'lap', runId: oldRun, valid: true }, { lap: 2 });
  p.play(400, gripDriver(), (game) => game.laps.completed >= 1);
  returnToMenu(p.game); // and that one is left for the title
  p.play(1);
  assert.equal(p.names().filter((name) => name === 'md_run_complete').length, 0);
  assert.equal(p.names().filter((name) => name === 'md_run_start').length, 2);
  assert.deepEqual(p.sent.filter(([name]) => name === 'md_lap_milestone'), [['md_lap_milestone', { lap: 1 }], ['md_lap_milestone', { lap: 1 }]]);
  assertContract(p.sent);
});

test('voided, repeated and out-of-range laps, and laps outside a circuit, are not milestones', () => {
  const p = page();
  circuit(p);
  p.play(0.5, { up: true });
  const runId = p.game.runId;
  const lap = (valid, n) => p.analytics.runEvent({ type: 'lap', runId, valid }, { lap: n });
  lap(false, 0);
  lap(true, 1);
  lap(true, 1);
  lap(true, 0);
  lap(true, 4);
  lap(true, 2.5);
  lap(true, '2');
  assert.deepEqual(p.sent.filter(([name]) => name === 'md_lap_milestone'), [['md_lap_milestone', { lap: 1 }]]);
  // A challenge has no laps, whatever it is told.
  returnToMenu(p.game);
  challenge(p, PRECISION_180);
  p.play(0.3, { up: true });
  p.analytics.runEvent({ type: 'lap', runId: p.game.runId, valid: true }, { lap: 2 });
  assert.equal(p.sent.filter(([name]) => name === 'md_lap_milestone').length, 1);
  assertContract(p.sent);
});

test('Gymkhana: a completed challenge counts, a failed one does not, and retries start new runs', () => {
  const p = page();
  challenge(p, PRECISION_180);
  p.play(60, D.handbrake180({ triggerX: 8, release: 110 * DEG }), finished);
  assert.equal(p.game.challenge.phase, 'failed');
  restartRun(p.game, { mode: 'gymkhana', ghost: false }); // Retry, as main.js does it
  p.play(60, D.handbrake180({ vCap: 24, triggerX: -8, release: 110 * DEG }), finished);
  assert.equal(p.game.challenge.phase, 'complete');
  p.play(1);
  const runs = () => p.sent.filter(([name]) => !name.startsWith('md_engaged'));
  assert.deepEqual(runs(), [['md_game_start'], ['md_run_start', { category: 'gymkhana' }], ['md_run_start', { category: 'gymkhana' }],
    ['md_run_complete', { category: 'gymkhana' }]]);
  // A second report of the same completion is still one.
  p.analytics.runEvent({ type: 'challenge', runId: p.game.runId, completed: true }, {});
  assert.equal(runs().length, 4);
  assertContract(p.sent);
});

test('Getaway: an escape counts, a bust does not', () => {
  const PARKED = { delay: 1e9 };
  const p = page();
  challenge(p, createUrbanChallenge({ variant: 'downtown' }));
  p.play(200, urbanStall(urbanGrip(), { after: 120, seconds: 6 }), finished);
  assert.equal(p.game.challenge.result.ended, 'busted');
  challenge(p, createUrbanChallenge({ variant: 'downtown', pursuer: PARKED }));
  p.play(200, urbanGrip({ lateral: 9 }), finished);
  assert.equal(p.game.challenge.result.ended, 'escaped');
  p.play(1);
  const runs = p.sent.filter(([name]) => !name.startsWith('md_engaged'));
  assert.deepEqual(runs, [['md_game_start'], ['md_run_start', { category: 'getaway' }], ['md_run_start', { category: 'getaway' }],
    ['md_run_complete', { category: 'getaway' }]]);
  assertContract(p.sent);
});

test('the driving lesson and the practice pad are not normal play: nothing is sent for them at all', () => {
  const p = page();
  startRun(p.game, { ghost: false, track: trackById('original'), mode: 'tutorial', handling: CLASSIC });
  p.play(400, gripDriver(), finished);
  assert.ok(finished(p.game), 'the lesson run really did three laps');
  restartRun(p.game, { ghost: false, mode: 'tutorial' });
  p.play(5, { up: true });
  returnToMenu(p.game);
  startRun(p.game, { track: padTrack(), mode: 'practice', ghost: false, handling: CLASSIC });
  p.play(120, (game) => ({ up: true, left: Math.floor(game.ticks / 240) % 2 === 0 }));
  assert.deepEqual(p.sent, []);
  assert.equal(p.analytics.engagedMs, 0);
});

test('counted runs stop at the per-page-load limit, and so does everything that follows them', () => {
  const sent = [];
  let ms = 0;
  const analytics = createAnalytics({ send: (name, data) => sent.push([name, data]), now: () => ms, foreground: () => true });
  for (let id = 1; id <= MAX_COUNTED_RUNS + 20; id += 1) {
    analytics.frame({ runId: id, category: 'tracks', racing: false, active: false });
    analytics.frame({ runId: id, category: 'tracks', racing: true, active: true });
    for (const lap of LAP_NUMBERS) analytics.runEvent({ type: 'lap', runId: id, valid: true }, { lap });
    analytics.runEvent({ type: 'finish', runId: id }, {});
    ms += 10;
  }
  const count = (name) => sent.filter(([n]) => n === name).length;
  assert.equal(count('md_run_start'), MAX_COUNTED_RUNS);
  assert.equal(count('md_run_complete'), MAX_COUNTED_RUNS);
  assert.equal(count('md_lap_milestone'), MAX_COUNTED_RUNS * 3);
  assert.equal(count('md_game_start'), 1);
  assert.equal(analytics.countedRuns, MAX_COUNTED_RUNS);
});

// --- 4. Engagement ----------------------------------------------------------------------------
// The observer on its own, on a clock moved by hand: a frame is whatever the view says it is.
function clockwork({ foreground = () => true } = {}) {
  const sent = [];
  const clock = { ms: 0 };
  const analytics = createAnalytics({ send: (name) => sent.push(name), now: () => clock.ms, foreground: () => foreground() });
  const run = { runId: 1, category: 'tracks' };
  const frames = (ms, { racing = true, active = true, step = 1000 / 60, ...view } = {}) => {
    for (let i = 0, n = Math.round(ms / step); i < n; i += 1) {
      clock.ms += step;
      analytics.frame({ ...run, racing, active, ...view });
    }
  };
  const engaged = () => sent.filter((name) => name.startsWith('md_engaged'));
  return { analytics, sent, clock, frames, engaged, run };
}

test('foreground driving reaches each milestone once, in order, and no more after five minutes', () => {
  const c = clockwork();
  c.frames(29_000);
  assert.deepEqual(c.engaged(), []);
  c.frames(2_000);
  assert.deepEqual(c.engaged(), ['md_engaged_30s']);
  c.frames(30_000);
  assert.deepEqual(c.engaged(), ['md_engaged_30s', 'md_engaged_1m']);
  c.frames(5 * 60_000);
  assert.deepEqual(c.engaged(), ENGAGEMENT_THRESHOLDS.map(([name]) => name));
  c.frames(30 * 60_000);
  assert.deepEqual(c.engaged(), ['md_engaged_30s', 'md_engaged_1m', 'md_engaged_3m', 'md_engaged_5m']);
});

test('the title, the grid, pause, results, the lesson and the pad add no time', () => {
  const c = clockwork();
  c.frames(10_000, { racing: false, category: null, runId: 0 });        // the title
  c.frames(10_000, { racing: false });                                   // on the grid, or paused, or the results
  c.frames(10_000, { racing: true, category: null, runId: 2 });          // the lesson or the pad
  assert.equal(c.analytics.engagedMs, 0);
  c.frames(1_000, { racing: true, runId: 3 });
  assert.ok(c.analytics.engagedMs > 900 && c.analytics.engagedMs <= 1_000);
});

test('an unfocused or hidden page adds no time, and none is caught up afterwards', () => {
  let focused = false;
  const c = clockwork({ foreground: () => focused });
  c.frames(60_000);
  assert.equal(c.analytics.engagedMs, 0);
  focused = true;
  c.frames(10_000);
  assert.ok(c.analytics.engagedMs <= 10_000);
  assert.deepEqual(c.engaged(), []);
});

test('time stops after 30 seconds with nothing held, and starts again with the next input', () => {
  const c = clockwork();
  c.frames(5_000);
  const before = c.analytics.engagedMs;
  c.frames(IDLE_MS + 60_000, { active: false });
  const idle = c.analytics.engagedMs - before;
  assert.ok(idle <= IDLE_MS + 50, `${idle} ms counted while idle`);
  const stalled = c.analytics.engagedMs;
  c.frames(10_000, { active: false });
  assert.equal(c.analytics.engagedMs, stalled);
  c.frames(1_000);
  assert.ok(c.analytics.engagedMs > stalled);
});

test('a suspended tab or a sleeping machine is discarded rather than counted', () => {
  const c = clockwork();
  c.frames(1_000);
  const before = c.analytics.engagedMs;
  c.frames(MAX_FRAME_GAP_MS * 120, { step: MAX_FRAME_GAP_MS * 60 });
  assert.equal(c.analytics.engagedMs, before);
  c.frames(1_000);
  assert.ok(c.analytics.engagedMs - before < 1_100);
});

test('a reload starts again from nothing: milestones are never replayed and nothing is stored', () => {
  const first = clockwork();
  first.frames(70_000);
  assert.deepEqual(first.engaged(), ['md_engaged_30s', 'md_engaged_1m']);
  const reloaded = clockwork();
  reloaded.frames(1_000);
  assert.deepEqual(reloaded.sent, ['md_game_start', 'md_run_start']);
  assert.equal(reloaded.analytics.engagedMs < 1_100, true);
  const source = readFileSync(new URL('../src/analytics.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|cookie/);
});

test('nothing the observer is given, and nothing the tracker does, can throw into the game', () => {
  let ms = 0;
  const analytics = createAnalytics({ send() { throw new Error('tracker'); }, now: () => ms, foreground: () => true });
  assert.doesNotThrow(() => {
    analytics.frame(undefined);
    analytics.frame({});
    analytics.runEvent(undefined);
    analytics.runEvent(null, null);
    analytics.runEvent({ type: 'lap' });
    for (let i = 0; i < 4000; i += 1) {
      ms += 50;
      analytics.frame({ runId: 1, category: 'gymkhana', racing: true, active: true });
    }
    analytics.runEvent({ type: 'challenge', runId: 1, completed: true }, {});
  });
  assert.ok(analytics.engagedMs > 60_000);
});

// --- 5. The game never notices ----------------------------------------------------------------
function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key), get length() { return data.size; }, key: (i) => [...data.keys()][i] ?? null, data };
}

const stateOf = (game) => JSON.stringify({ car: game.car, scoring: game.scoring, laps: game.laps, progress: game.progress,
  ticks: game.ticks, state: game.state, results: game.results, ghost: game.ghost && { lap: game.ghost.lapIndex, replay: game.ghost.replay?.samples?.length } });

test('with or without analytics, the same driving gives the same game, records and storage', () => {
  const sessions = [false, true].map((observed) => {
    const storage = memoryStorage();
    const records = createRecords(() => storage);
    const gymkhanaRecords = createGymkhanaRecords(() => storage);
    const getawayRecords = createGetawayRecords(() => storage);
    const handle = (event) => { records.handle(event); gymkhanaRecords.handle(event); getawayRecords.handle(event); };
    let p;
    if (observed) p = page({ records: handle });
    else {
      // The same page with the observer left out.
      const game = createGame(undefined, { onRunEvent: handle });
      const frame = (keys) => advance(game, 1 / 60, keys);
      p = { game, play: (seconds, keys, until) => {
        for (let i = 0; i < seconds * 60; i += 1) { frame(typeof keys === 'function' ? keys(game) : keys); if (until?.(game)) return; }
      } };
    }
    const states = [];
    circuit(p);
    p.play(400, gripDriver(), finished);
    states.push(stateOf(p.game));
    challenge(p, PRECISION_180);
    p.play(60, D.handbrake180({ vCap: 24, triggerX: -8, release: 110 * DEG }), finished);
    states.push(stateOf(p.game));
    return { states, storage: [...storage.data.entries()].sort(), sent: p.sent };
  });
  const [plain, observed] = sessions;
  assert.deepEqual(observed.states, plain.states);
  assert.deepEqual(observed.storage, plain.storage);
  assert.ok(observed.sent.length >= 6, 'and analytics really was listening');
  const keys = plain.storage.map(([key]) => key);
  assert.ok(keys.includes(RECORDS_KEY) && keys.includes(GYMKHANA_RECORDS_KEY), keys.join());
  assert.ok(!keys.includes(GETAWAY_RECORDS_KEY), 'no Getaway was driven');
  assert.ok(keys.every((key) => key.startsWith('mini-drifters-')), 'and nothing new was stored');
});
