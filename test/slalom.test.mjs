// Slalom Sprint, the fourth gymkhana challenge: its layout and rules, every way a run ends,
// penalties, the finish, retry, its records, and what a v0.4.0 tab does to them. The sheet,
// HUD and controller are covered in the browser (test/dockyard-slalom-browser.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createGame, startRun, restartRun, tick } from '../src/game.js';
import { TUNING } from '../src/tuning.js';
import { handlingById } from '../src/handling.js';
import { SCORING_VERSION } from '../src/scoring.js';
import { createRecords } from '../src/records.js';
import { GYMKHANA_CHALLENGES, GYMKHANA_CHALLENGE_IDS, PRECISION_180, LINKED_DRIFT, ONE_DRIFT, SLALOM_SPRINT, challengeById } from '../src/gymkhana.js';
import { createGymkhanaRecords, GYMKHANA_RECORDS_KEY, recordRules } from '../src/gymkhana-records.js';
import { createGymkhanaRecords as createV040GymkhanaRecords, GYMKHANA_RECORDS_KEY as V040_KEY } from './support/gymkhana-records-e4481a4.mjs';
import { GYMKHANA_CHALLENGE_IDS as V040_IDS } from './support/gymkhana-e4481a4.mjs';
import * as D from './support/gymkhana-drivers.mjs';
const { drive } = D;
const classic = handlingById('classic');
const power = handlingById('revised');
const MODES = [['Classic', classic], ['Power', power]];
const KEYS = (keys = {}) => ({ up: false, down: false, left: false, right: false, handbrake: false, ...keys });
// The quickest clean grip weave the v0.5.0 research sweep found in each mode.
const quick = (handling) => D.slalomWeave(handling === classic ? { speed: 0.875 * 22, amp: 2.8, lookV: 0.4 } : { speed: 0.85 * 22, amp: 2.8, lookV: 0.4 });
const G = SLALOM_SPRINT.geometry;

function memory() {
  const data = new Map();
  return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); } };
}

// --- The challenge -----------------------------------------------------------------------------
test('Slalom Sprint is the fourth challenge, a timed one on a pad of its own', () => {
  assert.deepEqual(GYMKHANA_CHALLENGE_IDS, ['precision-180', 'linked-drift', 'one-drift', 'slalom-sprint']);
  assert.equal(challengeById('slalom-sprint'), SLALOM_SPRINT);
  assert.equal(SLALOM_SPRINT.kind, 'time');
  assert.equal(SLALOM_SPRINT.layout, 'slalom');
  assert.ok(Object.isFrozen(SLALOM_SPRINT));
  assert.equal(SLALOM_SPRINT.track.pad, true);
  assert.equal(SLALOM_SPRINT.track.gates.length, 0, 'no checkpoints, so no lap can ever be counted');
  assert.equal(SLALOM_SPRINT.points.length, 3);
  // The three released challenges are the same objects as ever.
  assert.deepEqual(GYMKHANA_CHALLENGES.slice(0, 3), [PRECISION_180, LINKED_DRIFT, ONE_DRIFT]);
  assert.deepEqual(GYMKHANA_CHALLENGES.slice(0, 3).map((c) => c.rules), ['precision-180-1', 'linked-drift-1', 'one-drift-1']);
});

test('the layout is the accepted one: seven cones 22 m apart, 36 m in, 30 m out, alternating from the left', () => {
  assert.equal(SLALOM_SPRINT.rules, 'slalom-sprint-1');
  assert.deepEqual({ count: G.count, spacing: G.spacing, runUp: G.runUp, runOut: G.runOut, lane: G.lane, finishHalf: G.finishHalf, conePenalty: G.conePenalty, timeLimit: G.timeLimit, length: G.length },
    { count: 7, spacing: 22, runUp: 36, runOut: 30, lane: 12, finishHalf: 4, conePenalty: 2, timeLimit: 40, length: 198 });
  assert.deepEqual(G.start, { x: -99, y: 0, heading: 0 });
  assert.deepEqual(G.slalom.map((c) => [c.x, c.y, c.side]), [[-63, 0, -1], [-41, 0, 1], [-19, 0, -1], [3, 0, 1], [25, 0, -1], [47, 0, 1], [69, 0, -1]]);
  assert.deepEqual([G.finish.cx, G.finish.cy, G.finish.half], [99, 0, 4]);
  assert.equal(G.cones.length, 9, 'seven to weave through and two at the finish gate');
  // Heading east, the driver's left is up the screen (negative y): the first cone is passed on the left.
  assert.equal(G.slalom[0].side, -1);
  const { start, bounds } = SLALOM_SPRINT.track;
  assert.ok(start.x - bounds.minX >= 40 && bounds.maxX - G.finish.cx >= 60, 'room behind the start and to stop after the finish');
});

// --- Completing it -----------------------------------------------------------------------------
for (const [name, handling] of MODES) {
  test(`${name}: a clean weave completes, and the result is driving time plus penalties`, () => {
    const { run, result, game } = drive(SLALOM_SPRINT, handling, quick(handling));
    assert.equal(run.phase, 'complete');
    assert.equal(game.state, 'finished');
    assert.equal(result.cones, 0);
    assert.equal(result.penalty, 0);
    assert.equal(result.passed, 7);
    assert.equal(result.value, result.total);
    assert.equal(result.total, Math.round(result.time * 1000) / 1000);
    // The research harness and the accepted prototype measured these with this driver.
    assert.ok(Math.abs(result.total - (handling === classic ? 11.067 : 11.325)) < 0.01, `${result.total} s`);
    assert.ok(result.weaveSpeed > 17 && result.weaveSpeed < 21, `${result.weaveSpeed.toFixed(1)} m/s through the cones`);
  });
}

test('the same drive gives the same result every time', () => {
  const a = drive(SLALOM_SPRINT, classic, quick(classic)).result;
  const b = drive(SLALOM_SPRINT, classic, quick(classic)).result;
  assert.deepEqual(a, b);
});

test('a careful weave is legal and about nine seconds slower', () => {
  const careful = drive(SLALOM_SPRINT, classic, D.slalomWeave({ speed: 8.8, amp: 3.5 })).result;
  assert.equal(careful.cones, 0);
  assert.ok(careful.value > 19 && careful.value < 21, `${careful.value} s`);
});

// --- Penalties ---------------------------------------------------------------------------------
for (const [name, handling] of MODES) {
  test(`${name}: each cone touched costs two seconds, once, and the HUD is told as it falls`, () => {
    const game = createGame(undefined, { handling });
    startRun(game, { mode: 'gymkhana', ghost: false, handling, challenge: SLALOM_SPRINT });
    const driver = D.slalomWeave({ speed: 12, amp: 1.3 });
    const events = [];
    let serial = 0;
    for (let i = 0; i < 60 / TUNING.simStep && game.state !== 'finished'; i += 1) {
      tick(game, driver(game));
      if (game.challenge.eventSerial !== serial) { serial = game.challenge.eventSerial; events.push(game.challenge.event); }
    }
    const run = game.challenge;
    assert.equal(run.phase, 'complete', 'brushing a cone on its correct side still passes it');
    assert.equal(run.result.cones, 7);
    assert.equal(run.result.penalty, 14);
    assert.equal(run.result.value, Math.round((run.result.time + 14) * 1000) / 1000);
    assert.equal(events.reduce((a, e) => a + e.count, 0), 7, 'each cone is announced once');
    assert.ok(events.every((e) => e.type === 'cone' && e.penalty === 2 * e.count));
    assert.equal(run.cones.filter((c) => c.hit).length, 7);
  });

  test(`${name}: going one step too fast costs cones, and no run with a penalty beats the clean one`, () => {
    const clean = drive(SLALOM_SPRINT, handling, quick(handling)).result;
    const hot = drive(SLALOM_SPRINT, handling, D.slalomWeave({ speed: 0.9 * 22, amp: 2.8, lookV: 0.4 })).result;
    assert.ok(hot.cones >= 1);
    assert.ok(hot.time < clean.time, 'it is quicker on the clock');
    assert.ok(hot.total > clean.total + 2, `${hot.total} against ${clean.total}`);
  });
}

// --- Failing it --------------------------------------------------------------------------------
for (const [name, handling] of MODES) {
  test(`${name}: straight down the line of cones fails at the first one: on a cone is on neither side of it`, () => {
    const { run, result } = drive(SLALOM_SPRINT, handling, D.slalomStraight());
    assert.equal(run.phase, 'failed');
    assert.equal(run.reason, 'wrong side of cone 1');
    assert.equal(result.value, null);
    assert.equal(result.passed, 0);
    assert.equal(run.failedAt, 0);
  });

  test(`${name}: the wrong side of a cone, outside the lane, flat out and a missed finish all fail`, () => {
    const cases = [
      [D.slalomWeave({ speed: 12, amp: -2.8 }), 'wrong side of cone 1'],
      [D.slalomWeave({ speed: 9, amp: 18 }), 'left the lane at cone 1'],
      [D.slalomWeave({ flat: true }), 'wrong side of cone 3'],
      [D.slalomWeave({ speed: 15, amp: 2.8, exitY: 9 }), 'missed the finish'],
    ];
    for (const [driver, reason] of cases) {
      const { run, result, game } = drive(SLALOM_SPRINT, handling, driver);
      assert.equal(run.phase, 'failed', reason);
      assert.equal(run.reason, reason);
      assert.equal(result.value, null, 'a failed run has no value for the records');
      assert.equal(game.state, 'finished');
    }
  });
}

test('a cone cannot be skipped: the finish does not count until all seven are behind the car', () => {
  // Round the outside of the whole lane, then back to the finish gate.
  const game = createGame(undefined, { handling: classic });
  startRun(game, { mode: 'gymkhana', ghost: false, handling: classic, challenge: SLALOM_SPRINT });
  for (let i = 0; i < 60 / TUNING.simStep && game.state !== 'finished'; i += 1) {
    const { car } = game;
    const target = car.x < 60 ? { x: car.x + 20, y: -20 } : { x: G.finish.cx + 5, y: 0 };
    const err = Math.atan2(Math.sin(Math.atan2(target.y - car.y, target.x - car.x) - car.heading), Math.cos(Math.atan2(target.y - car.y, target.x - car.x) - car.heading));
    tick(game, KEYS({ up: car.speed < 12, left: err < -0.05, right: err > 0.05 }));
  }
  assert.equal(game.challenge.phase, 'failed');
  assert.equal(game.challenge.reason, 'left the lane at cone 1');
});

test('the clock waits for the first pedal, and a run left alone runs out of time', () => {
  const game = createGame(undefined, { handling: classic });
  startRun(game, { mode: 'gymkhana', ghost: false, handling: classic, challenge: SLALOM_SPRINT });
  for (let i = 0; i < 240; i += 1) tick(game, KEYS());
  assert.equal(game.state, 'ready');
  assert.equal(game.challenge.time, 0);
  tick(game, KEYS({ up: true }));
  assert.equal(game.state, 'racing');
  for (let i = 0; i < 45 / TUNING.simStep && game.state !== 'finished'; i += 1) tick(game, KEYS());
  assert.equal(game.challenge.phase, 'failed');
  assert.equal(game.challenge.reason, 'out of time');
  assert.ok(Math.abs(game.challenge.time - 40) < 0.02);
});

// --- Retry -------------------------------------------------------------------------------------
test('restarting repeats the challenge with a fresh run, from any point, and the retry matches a first attempt', () => {
  const first = drive(SLALOM_SPRINT, classic, quick(classic)).result;
  const game = createGame(undefined, { handling: classic });
  startRun(game, { mode: 'gymkhana', ghost: false, handling: classic, challenge: SLALOM_SPRINT });
  // Part of a run that knocks cones, abandoned.
  const sloppy = D.slalomWeave({ speed: 12, amp: 1.3 });
  for (let i = 0; i < 8 / TUNING.simStep; i += 1) tick(game, sloppy(game));
  assert.ok(game.challenge.conesHit > 0 && game.challenge.next > 0);
  restartRun(game, { ghost: false, mode: 'gymkhana' });   // what the page's R does
  assert.equal(game.mode, 'gymkhana');
  assert.equal(game.challengeDef, SLALOM_SPRINT);
  assert.equal(game.state, 'ready');
  assert.deepEqual({ x: game.car.x, y: game.car.y, heading: game.car.heading, speed: game.car.speed }, { ...G.start, speed: 0 });
  assert.deepEqual({ time: game.challenge.time, next: game.challenge.next, conesHit: game.challenge.conesHit, hit: game.challenge.cones.filter((c) => c.hit).length, phase: game.challenge.phase },
    { time: 0, next: 0, conesHit: 0, hit: 0, phase: 'running' });
  const driver = quick(classic);
  while (game.state !== 'finished') tick(game, driver(game));
  assert.deepEqual(game.challenge.result, first);
  // And again from the results sheet.
  restartRun(game, { ghost: false, mode: 'gymkhana' });   // what the page's R does
  assert.equal(game.state, 'ready');
  assert.equal(game.challenge.result, null);
});

// --- Records ---------------------------------------------------------------------------------
test('only a completed run sets a record, per handling mode, under slalom-sprint-1', () => {
  const storage = memory();
  const circuit = memory();
  const records = createGymkhanaRecords(() => storage);
  const circuitRecords = createRecords(() => circuit);
  const onRunEvent = (event) => { records.handle(event); circuitRecords.handle(event); };
  drive(SLALOM_SPRINT, classic, D.slalomStraight(), { onRunEvent });
  assert.equal(records.bestFor('slalom-sprint', 'classic'), null, 'a failed run sets nothing');
  assert.equal(storage.data.size, 0);
  const done = drive(SLALOM_SPRINT, classic, quick(classic), { onRunEvent }).result;
  assert.equal(records.bestFor('slalom-sprint', 'classic'), done.value);
  assert.equal(records.newBest, true);
  assert.equal(records.bestFor('slalom-sprint', 'revised'), null, 'Power keeps its own');
  const slower = drive(SLALOM_SPRINT, classic, D.slalomWeave({ speed: 8.8, amp: 3.5 }), { onRunEvent }).result;
  assert.ok(slower.value > done.value);
  assert.equal(records.bestFor('slalom-sprint', 'classic'), done.value, 'a slower run does not replace it');
  const inPower = drive(SLALOM_SPRINT, power, quick(power), { onRunEvent }).result;
  assert.equal(records.bestFor('slalom-sprint', 'revised'), inPower.value);
  assert.equal(recordRules(SLALOM_SPRINT), 'slalom-sprint-1', 'a time is not tied to the scoring version');
  assert.deepEqual(JSON.parse(storage.getItem(GYMKHANA_RECORDS_KEY)), {
    version: 1,
    challenges: { 'slalom-sprint': { classic: { 'slalom-sprint-1': { best: done.value } }, revised: { 'slalom-sprint-1': { best: inPower.value } } } },
  });
  assert.deepEqual([...storage.data.keys()], [GYMKHANA_RECORDS_KEY], 'the existing key: no new one');
  for (const id of ['precision-180', 'linked-drift', 'one-drift']) assert.equal(records.bestFor(id, 'classic'), null, id);
  assert.equal(circuit.data.size, 0, 'no circuit record is ever written by a challenge');
});

test('the prototype\'s slalom records, under its own rules id, are kept but never shown', () => {
  const storage = memory();
  storage.setItem(GYMKHANA_RECORDS_KEY, JSON.stringify({ version: 1, challenges: { 'slalom-sprint': { classic: { 'slalom-sprint-proto-1': { best: 9.5 } } } } }));
  const records = createGymkhanaRecords(() => storage);
  records.handle({ type: 'start', mode: 'gymkhana', challengeId: 'slalom-sprint', handling: 'classic', runId: 1 });
  assert.equal(records.bestFor('slalom-sprint', 'classic'), null);
  records.handle({ type: 'challenge', challengeId: 'slalom-sprint', handling: 'classic', runId: 1, completed: true, value: 12.25 });
  assert.equal(records.bestFor('slalom-sprint', 'classic'), 12.25);
  assert.deepEqual(JSON.parse(storage.getItem(GYMKHANA_RECORDS_KEY)).challenges['slalom-sprint'].classic,
    { 'slalom-sprint-proto-1': { best: 9.5 }, 'slalom-sprint-1': { best: 12.25 } });
});

// v0.4.0's gymkhana record keeper, unedited apart from its import paths
// (support/gymkhana-records-e4481a4.mjs), stands in for a v0.4.0 tab left open in the same
// browser. It sees v0.4.0's three challenges and no Slalom Sprint.
test('the v0.4.0 gymkhana keeper used as the old tab is the released file, unedited apart from its imports', () => {
  const bytes = readFileSync(new URL('support/gymkhana-records-e4481a4.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    .replace("from '../../src/handling.js'", "from './handling.js'").replace("from '../../src/scoring.js'", "from './scoring.js'")
    .replace("from './gymkhana-e4481a4.mjs'", "from './gymkhana.js'");
  // SHA-256 of `git show e4481a4:src/gymkhana-records.js`.
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '21c2dca16d817d1352041e31878a50825bc7039fb16996943271ae81ca4dde64');
  assert.equal(V040_KEY, GYMKHANA_RECORDS_KEY);
  assert.deepEqual(V040_IDS, ['precision-180', 'linked-drift', 'one-drift']);
});

const challengeRun = (records, { challengeId, handling, runId = 1, value }) => {
  records.handle({ type: 'start', mode: 'gymkhana', challengeId, handling, runId });
  records.handle({ type: 'challenge', challengeId, handling, runId, completed: true, value });
};

test('every gymkhana record v0.4.0 saved shows as before, and Slalom Sprint starts empty', () => {
  const storage = memory();
  const saved = JSON.stringify({ version: 1, challenges: {
    'precision-180': { classic: { 'precision-180-1': { best: 7.85 } }, revised: { 'precision-180-1': { best: 8.1 } } },
    'linked-drift': { classic: { [`linked-drift-1+${SCORING_VERSION}`]: { best: 4200 } } },
    'one-drift': { revised: { [`one-drift-1+${SCORING_VERSION}`]: { best: 3100 } } },
  } });
  storage.setItem(GYMKHANA_RECORDS_KEY, saved);
  const old = createV040GymkhanaRecords(() => storage);
  const mine = createGymkhanaRecords(() => storage);
  for (const id of V040_IDS) for (const h of ['classic', 'revised']) assert.equal(mine.bestFor(id, h), old.bestFor(id, h), `${id}/${h}`);
  assert.equal(mine.bestFor('precision-180', 'classic'), 7.85, 'it really read something');
  assert.equal(mine.bestFor('slalom-sprint', 'classic'), null);
  assert.equal(mine.bestFor('slalom-sprint', 'revised'), null);
  assert.equal(storage.getItem(GYMKHANA_RECORDS_KEY), saved, 'nothing was written');
});

test('a v0.4.0 tab setting new gymkhana bests keeps the Slalom Sprint records, and they still show', () => {
  const storage = memory();
  const mine = createGymkhanaRecords(() => storage);
  challengeRun(mine, { challengeId: 'slalom-sprint', handling: 'classic', value: 11.2 });
  challengeRun(mine, { challengeId: 'slalom-sprint', handling: 'revised', runId: 2, value: 11.6 });
  challengeRun(mine, { challengeId: 'precision-180', handling: 'classic', runId: 3, value: 9 });
  const slalom = structuredClone(JSON.parse(storage.getItem(GYMKHANA_RECORDS_KEY)).challenges['slalom-sprint']);
  const old = createV040GymkhanaRecords(() => storage);
  challengeRun(old, { challengeId: 'precision-180', handling: 'classic', runId: 4, value: 7.5 });
  assert.equal(old.newBest, true, 'the old tab really wrote');
  challengeRun(old, { challengeId: 'linked-drift', handling: 'revised', runId: 5, value: 5000 });
  assert.deepEqual(JSON.parse(storage.getItem(GYMKHANA_RECORDS_KEY)).challenges['slalom-sprint'], slalom, 'carried through untouched');
  const after = createGymkhanaRecords(() => storage);
  assert.equal(after.bestFor('slalom-sprint', 'classic'), 11.2);
  assert.equal(after.bestFor('slalom-sprint', 'revised'), 11.6);
  assert.equal(after.bestFor('precision-180', 'classic'), 7.5);
  assert.equal(after.bestFor('linked-drift', 'revised'), 5000);
  // An old tab never sees a slalom event as its own: the run is unknown to it.
  challengeRun(old, { challengeId: 'slalom-sprint', handling: 'classic', runId: 6, value: 1 });
  assert.equal(createGymkhanaRecords(() => storage).bestFor('slalom-sprint', 'classic'), 11.2);
});

test('a slalom session keeps no lap, ghost or circuit result, and a normal run afterwards is untouched', () => {
  const { game } = drive(SLALOM_SPRINT, classic, quick(classic));
  assert.equal(game.ghost, null);
  assert.equal(game.laps.completed, 0);
  assert.equal(game.results, null);
  assert.equal(game.scoring.score, 0);
  const fresh = createGame();
  startRun(fresh);
  startRun(game, { mode: 'normal' , track: fresh.track });
  for (let i = 0; i < 20 / TUNING.simStep; i += 1) { tick(fresh, KEYS({ up: true, right: i % 400 < 60 })); tick(game, KEYS({ up: true, right: i % 400 < 60 })); }
  assert.equal(game.mode, 'normal');
  assert.equal(game.challenge, null);
  assert.deepEqual([game.car.x, game.car.y, game.car.heading, game.scoring.score], [fresh.car.x, fresh.car.y, fresh.car.heading, fresh.scoring.score]);
});
