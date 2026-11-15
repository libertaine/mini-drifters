// The gymkhana challenges, driven through the session loop by the scripted drivers in
// test/support/gymkhana-drivers.mjs: what completes, what fails and why, what a cone costs,
// what cannot be farmed, how a session ends and restarts, and that a gymkhana session leaves
// the circuit records, laps, ghost and results alone. Their own records are in
// test/gymkhana-records.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGame, startRun, restartRun, returnToMenu, tick, advance } from '../src/game.js';
import { TUNING } from '../src/tuning.js';
import { HANDLING_MODES, handlingById } from '../src/handling.js';
import { createRecords } from '../src/records.js';
import { TRACKS, trackById } from '../src/track.js';
import { GYMKHANA_CHALLENGES, GYMKHANA_CHALLENGE_IDS, PRECISION_180, LINKED_DRIFT, ONE_DRIFT, SLALOM_SPRINT, challengeById } from '../src/gymkhana.js';
import * as D from './support/gymkhana-drivers.mjs';

const { drive } = D;
const DEG = Math.PI / 180;
const classic = handlingById('classic');
const KEYS = (keys = {}) => ({ up: false, down: false, left: false, right: false, handbrake: false, ...keys });
// The quickest clean handbrake driver a grid search found, in both modes.
const tidy = () => D.handbrake180({ vCap: 24, triggerX: -8, release: 110 * DEG });
const drifter = () => D.courseDrift({ targetSlip: 32 * DEG, catchSlip: 40 * DEG, tapTime: 0.3, lateral: 9.5, cooldown: 1.4 });

// --- The mode ----------------------------------------------------------------------------------
test('there are four challenges on three layouts, and none of them is a circuit', () => {
  assert.deepEqual(GYMKHANA_CHALLENGE_IDS, ['precision-180', 'linked-drift', 'one-drift', 'slalom-sprint']);
  assert.deepEqual(GYMKHANA_CHALLENGES.map((c) => c.kind), ['time', 'score', 'score', 'time']);
  assert.deepEqual(GYMKHANA_CHALLENGES.map((c) => c.layout), ['box', 'course', 'course', 'slalom']);
  assert.equal(challengeById('linked-drift'), LINKED_DRIFT);
  assert.equal(challengeById('slalom-sprint'), SLALOM_SPRINT);
  assert.equal(challengeById('original'), null);
  assert.equal(ONE_DRIFT.track, LINKED_DRIFT.track, 'One Drift is driven on the Linked Drift course');
  assert.equal(ONE_DRIFT.geometry, LINKED_DRIFT.geometry);
  for (const def of GYMKHANA_CHALLENGES) {
    assert.ok(Object.isFrozen(def));
    assert.equal(def.track.pad, true);
    assert.equal(def.track.gates.length, 0, 'no checkpoints, so no lap can ever be counted');
    assert.throws(() => trackById(def.track.id), /Unknown track/, `${def.track.id} is not offered as a track`);
    assert.ok(!TRACKS.some((t) => t.id === def.track.id));
    const { start, bounds } = def.track;
    assert.ok(start.x > bounds.minX + 20 && start.x < bounds.maxX - 20 && start.y > bounds.minY + 20 && start.y < bounds.maxY - 20);
    assert.ok(def.brief.length > 20 && def.points.length === 3, 'each challenge explains itself');
  }
});

// A change detector, like the handling modes' fingerprints. A record is filed under its
// challenge's rules id (gymkhana-records.js), so results are only comparable while the layout
// and the rules behind that id hold. If this fails, decide whether old results still compare,
// and if they do not, give the challenge a new rules id instead of new values here.
test('each challenge\'s layout and rules are pinned to its rules id', () => {
  assert.deepEqual(GYMKHANA_CHALLENGES.map((c) => c.rules), ['precision-180-1', 'linked-drift-1', 'one-drift-1', 'slalom-sprint-1']);
  const p = PRECISION_180.geometry;
  assert.deepEqual({ start: p.start, box: p.box, zoneFrom: p.zoneFrom, conePenalty: p.conePenalty, timeLimit: p.timeLimit, gate: [p.gate.cx, p.gate.cy, p.gate.half], cones: p.cones.length },
    { start: { x: -50, y: 0, heading: 0 }, box: { minX: 0, maxX: 30, minY: -7, maxY: 7 }, zoneFrom: 16, conePenalty: 2, timeLimit: 30, gate: [-14, 0, 4], cones: 7 });
  const l = LINKED_DRIFT.geometry;
  assert.deepEqual({ segments: l.segments, corridor: l.corridor, gateHalf: l.gateHalf, gateMissMargin: l.gateMissMargin, timeLimit: l.timeLimit, finishS: l.finishS, gates: l.gates.map((g) => g.s) },
    { segments: [{ straight: 45 }, { turn: 90, radius: 38 }, { turn: -150, radius: 34 }, { turn: 120, radius: 34 }, { straight: 50 }],
      corridor: 10, gateHalf: 8, gateMissMargin: 10, timeLimit: 60, finishS: 285, gates: [75, 105, 149, 194, 229, 285] });
  const s = SLALOM_SPRINT.geometry;
  assert.deepEqual({ count: s.count, spacing: s.spacing, runUp: s.runUp, runOut: s.runOut, lane: s.lane, finishHalf: s.finishHalf, firstSide: s.firstSide, conePenalty: s.conePenalty, timeLimit: s.timeLimit, start: s.start, cones: s.cones.length, sides: s.slalom.map((c) => c.side) },
    { count: 7, spacing: 22, runUp: 36, runOut: 30, lane: 12, finishHalf: 4, firstSide: -1, conePenalty: 2, timeLimit: 40, start: { x: -99, y: 0, heading: 0 }, cones: 9, sides: [-1, 1, -1, 1, -1, 1, -1] });
});

test('no development switch ships: the mode has no URL parameter or host check', () => {
  for (const file of ['main.js', 'gymkhana.js', 'gymkhana-ui.js', 'gymkhana-draw.js', 'gymkhana-records.js']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /URLSearchParams|location\.search|hostname|localhost|127\.0\.0\.1/, file);
  }
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<button id="gymkhana" class="quiet" type="button">Gymkhana<\/button>/);
});

// --- Precision 180 ---------------------------------------------------------------------------
test('Precision 180: a tidy handbrake turn completes clean in both handling modes, within a tenth of each other', () => {
  const totals = HANDLING_MODES.map((mode) => {
    const { run, result, game } = drive(PRECISION_180, mode, tidy());
    assert.equal(run.phase, 'complete', mode.id);
    assert.equal(game.state, 'finished', 'a completed run ends the session');
    assert.equal(result.cones, 0);
    assert.equal(result.technique, 'slide');
    assert.ok(result.depth >= 16 && result.depth < 30, `reached the turn zone and stayed in the box: ${result.depth}`);
    assert.ok(Math.abs(result.exitOffset) < 2.4, 'left through the gate between the cones');
    assert.ok(result.exitAngle < 20 * DEG && result.exitSpeed > 10, 'nose first and driving');
    assert.equal(result.value, result.total, 'the record value is the total time');
    assert.equal(result.total, Math.round(result.time * 1000) / 1000, 'to the millisecond, with no penalty');
    return result.total;
  });
  assert.ok(totals[0] > 7 && totals[0] < 8, `about seven and a half seconds: ${totals[0]}`);
  assert.ok(Math.abs(totals[0] - totals[1]) < 0.1, `Classic ${totals[0]} vs Power ${totals[1]}`);
});

test('Precision 180: the same drive gives the same result every time', () => {
  const a = drive(PRECISION_180, classic, tidy()).result;
  const b = drive(PRECISION_180, classic, tidy()).result;
  assert.deepEqual(a, b);
});

test('Precision 180: arriving flat out slides out of the back of the box', () => {
  const { run, result, game } = drive(PRECISION_180, classic, D.handbrake180({ triggerX: 8, release: 110 * DEG }));
  assert.equal(run.phase, 'failed');
  assert.equal(run.reason, 'left the box');
  assert.equal(game.state, 'finished', 'a failed run ends the session too');
  assert.equal(result.value, null, 'a failed run has nothing for the records');
});

test('Precision 180: turning round before the turn zone does not count', () => {
  const { run, result } = drive(PRECISION_180, classic, D.handbrake180({ vCap: 16, triggerX: -8, release: 110 * DEG }));
  assert.equal(run.phase, 'failed');
  assert.equal(run.reason, 'turned before the turn zone');
  assert.equal(result.value, null);
});

test('Precision 180: backing out of the box is not a 180', () => {
  // Drive in to the turn zone, stop, and reverse straight back out through the gate.
  const reverser = (game) => {
    const { car } = game;
    if (!reverser.stopped) {
      if (car.x < 18) return KEYS({ up: car.speed < 12 });
      if (car.speed > 0.5) return KEYS({ down: true });
      reverser.stopped = true;
    }
    return KEYS({ down: true });
  };
  const { run, result } = drive(PRECISION_180, classic, reverser);
  assert.equal(run.phase, 'failed');
  assert.equal(run.reason, 'came out backwards');
  assert.equal(result.technique, 'reversed');
});

test('Precision 180: the slower ways round are legal and slower: grip U-turn, then three-point turn', () => {
  const slide = drive(PRECISION_180, classic, tidy()).result.total;
  const grip = drive(PRECISION_180, classic, D.gripUturn({ vTurn: 5 }));
  const threePoint = drive(PRECISION_180, classic, D.threePoint({ vCap: 18 }));
  assert.equal(grip.run.phase, 'complete');
  assert.equal(threePoint.run.phase, 'complete');
  assert.equal(grip.result.technique, 'grip', 'full lock at walking pace is not called a slide');
  assert.equal(threePoint.result.technique, 'reversed');
  assert.ok(grip.result.total > slide + 1.5, `grip ${grip.result.total} vs slide ${slide}`);
  assert.ok(threePoint.result.total > grip.result.total + 1, `three-point ${threePoint.result.total} vs grip ${grip.result.total}`);
});

test('Precision 180: a cone costs two seconds, once, and the HUD is told as it falls', () => {
  // The same tidy drive, but lined up on the gate's left-hand cone.
  const game = createGame(undefined, { handling: classic });
  startRun(game, { mode: 'gymkhana', challenge: PRECISION_180 });
  const driver = D.handbrake180({ vCap: 22, triggerX: 0, release: 110 * DEG, lane: -4 });
  const run = game.challenge;
  assert.equal(run.eventSerial, 0);
  let events = 0;
  let seen = 0;
  for (let i = 0; i < 40 / TUNING.simStep && game.state !== 'finished'; i += 1) {
    tick(game, driver(game));
    if (run.eventSerial !== seen) {
      seen = run.eventSerial;
      events += 1;
      assert.equal(run.event.type, 'cone');
      assert.equal(run.event.penalty, run.event.count * 2);
    }
  }
  const { result } = run;
  assert.ok(result.cones >= 1, 'the gate cone fell');
  assert.ok(events >= 1 && events <= result.cones, 'each fall is announced once');
  assert.equal(result.penalty, result.cones * 2);
  assert.equal(result.total, Math.round((result.time + result.penalty) * 1000) / 1000);
  assert.equal(run.cones.filter((c) => c.hit).length, result.cones, 'each fallen cone is counted once');
});

test('Precision 180: the clock waits for the first pedal, and a run left alone runs out of time', () => {
  const game = createGame(undefined, { handling: classic });
  startRun(game, { mode: 'gymkhana', challenge: PRECISION_180 });
  assert.equal(game.track, PRECISION_180.track, 'the session takes the challenge\'s own pad');
  for (let i = 0; i < 240; i += 1) tick(game, KEYS({ left: true, handbrake: true }));
  assert.equal(game.state, 'ready');
  assert.equal(game.challenge.time, 0, 'steering and handbrake on the line do not start the clock');
  tick(game, KEYS({ up: true }));
  assert.equal(game.state, 'racing');
  for (let i = 0; i < 31 / TUNING.simStep && game.state !== 'finished'; i += 1) tick(game, KEYS());
  assert.equal(game.challenge.phase, 'failed');
  assert.equal(game.challenge.reason, 'out of time');
  assert.equal(game.state, 'finished');
  // Like a finished circuit run, a finished challenge is not advanced any further.
  const frozen = { time: game.challenge.time, x: game.car.x, ticks: game.ticks };
  assert.equal(advance(game, 1, KEYS({ up: true })), 0);
  assert.deepEqual({ time: game.challenge.time, x: game.car.x, ticks: game.ticks }, frozen);
});

// --- Linked Drift ----------------------------------------------------------------------------
test('Linked Drift: the course is 285 m to the finish with six gates in order along it', () => {
  const { gates, course, finishS, corridor, gateHalf } = LINKED_DRIFT.geometry;
  assert.equal(finishS, 285);
  assert.deepEqual(gates.map((g) => g.label), ['1', '2', '3', '4', '5', 'finish']);
  assert.deepEqual(gates.map((g) => g.s), [...gates.map((g) => g.s)].sort((a, b) => a - b));
  assert.ok(gateHalf < corridor, 'a gate is narrower than the course');
  course.points.forEach((p, i) => assert.equal(p.s, i, 'one course point per metre'));
  const { bounds } = LINKED_DRIFT.track;
  for (const p of course.points) assert.ok(p.x > bounds.minX + 30 && p.x < bounds.maxX - 30 && p.y > bounds.minY + 30 && p.y < bounds.maxY - 30);
});

test('Linked Drift: driving it on grip finishes with every gate and no points', () => {
  for (const mode of HANDLING_MODES) {
    const { run, result } = drive(LINKED_DRIFT, mode, D.courseGrip({ lateral: 10 }));
    assert.equal(run.phase, 'complete', mode.id);
    assert.equal(result.gatesPassed, 6);
    assert.equal(result.gatesDrifted, 0);
    assert.equal(result.score, 0);
    assert.equal(result.value, 0, 'zero is a real score');
  }
});

test('Linked Drift: drifting it scores, through the game\'s own combo rules', () => {
  for (const mode of HANDLING_MODES) {
    const { run, result, game } = drive(LINKED_DRIFT, mode, drifter());
    assert.equal(run.phase, 'complete', mode.id);
    assert.equal(game.state, 'finished');
    assert.ok(result.score > 300, `${mode.id} scored ${result.score}`);
    assert.ok(result.bestMultiplier > 1, 'the multiplier climbed');
    assert.equal(result.score, game.scoring.score, 'the result is the scoring state, not a second count');
    assert.equal(result.value, result.score);
    assert.ok(Number.isSafeInteger(result.value));
    assert.equal(game.scoring.combo, null, 'the finish banked the live combo');
    assert.ok(result.distance >= 285 && result.distance < 290);
  }
});

test('Linked Drift: a slow slide pays nothing (the low-speed fade)', () => {
  const { run, result } = drive(LINKED_DRIFT, classic, D.courseDrift({ targetSlip: 32 * DEG, catchSlip: 40 * DEG, lateral: 9.5, cap: 13 }));
  assert.equal(run.phase, 'complete');
  assert.equal(result.score, 0);
});

test('Linked Drift: donuts in a bend add nothing to the same drive', () => {
  for (const mode of HANDLING_MODES) {
    const plain = drive(LINKED_DRIFT, mode, drifter()).result.score;
    const circling = drive(LINKED_DRIFT, mode, D.courseDonut(drifter(), { fromS: 60, seconds: 10 }));
    assert.ok(circling.result.score <= plain, `${mode.id}: ${circling.result.score} with donuts vs ${plain} without`);
  }
});

test('Linked Drift: new ground is only ever the course, once', () => {
  const game = createGame(undefined, { handling: classic });
  startRun(game, { mode: 'gymkhana', challenge: LINKED_DRIFT });
  const driver = D.courseDonut(drifter(), { fromS: 60, seconds: 10 });
  let last = 0;
  for (let i = 0; i < 60 / TUNING.simStep && game.state !== 'finished'; i += 1) {
    tick(game, driver(game));
    assert.ok(game.challenge.furthest >= last, 'the high-water mark never goes back');
    assert.ok(game.challenge.furthest - last <= game.car.speed * TUNING.simStep * 2 + 1.5, 'and never jumps');
    last = game.challenge.furthest;
  }
  assert.ok(last <= LINKED_DRIFT.geometry.course.points.length);
});

test('Linked Drift: running past a gate ends the run, loses the live combo and counts for nothing', () => {
  // Straight on at the first bend.
  const { run, result, game } = drive(LINKED_DRIFT, classic, () => KEYS({ up: true }));
  assert.equal(run.phase, 'failed');
  assert.equal(run.reason, 'missed gate 1');
  assert.equal(result.value, null);
  assert.equal(game.scoring.combo, null);
});

// --- One Drift -------------------------------------------------------------------------------
test('One Drift: the run is over when the first combo ends, with what it banked', () => {
  const open = drive(LINKED_DRIFT, classic, drifter());
  const one = drive(ONE_DRIFT, classic, drifter());
  assert.equal(open.run.phase, 'complete');
  assert.equal(one.game.state, 'finished');
  assert.ok(one.result.score <= open.result.score);
  if (one.result.ended !== 'finish') {
    assert.ok(one.result.distance < 285, 'it ended before the finish');
    assert.match(one.run.reason, /^drift (banked after \d+ m|lost: .+)$/);
  }
  assert.equal(one.result.value, one.run.phase === 'complete' ? one.result.score : null);
  // A drive that never slides never starts the one drift, so it simply finishes with nothing.
  const grip = drive(ONE_DRIFT, classic, D.courseGrip({ lateral: 10 }));
  assert.equal(grip.run.phase, 'complete');
  assert.equal(grip.result.ended, 'finish');
  assert.equal(grip.result.score, 0);
});

test('One Drift: a drift that banks completes, and a drift that is lost fails', () => {
  // Every drifter of a small grid ends one way or the other, and the two outcomes agree with
  // the scoring's own last event.
  const outcomes = new Set();
  for (const targetSlip of [24, 32, 40]) {
    for (const lateral of [8.5, 9.5, 10.5]) {
      const { run, result, game } = drive(ONE_DRIFT, classic, D.courseDrift({ targetSlip: targetSlip * DEG, catchSlip: 45 * DEG, tapTime: 0.3, lateral, cooldown: 1.4 }));
      assert.equal(game.state, 'finished');
      if (result.ended === 'banked') {
        outcomes.add('banked');
        assert.equal(run.phase, 'complete');
        assert.equal(game.scoring.event.type, 'banked');
        assert.equal(result.score, game.scoring.event.points, 'one combo, so the score is exactly what it banked');
      } else if (result.ended === 'failed' && run.reason.startsWith('drift lost')) {
        outcomes.add('lost');
        assert.equal(result.score, 0, 'nothing was banked before the one combo was lost');
        assert.equal(result.value, null);
      }
    }
  }
  assert.ok(outcomes.has('banked'), 'at least one of the grid banked its drift');
  assert.ok(outcomes.has('lost'), 'at least one of the grid lost its drift');
});

test('One Drift: a first combo rounded to zero still completes when it banks', () => {
  const game = createGame();
  startRun(game, { mode: 'gymkhana', challenge: ONE_DRIFT });
  const run = game.challenge;
  const p = ONE_DRIFT.geometry.course.points[50];
  Object.assign(game.car, { x: p.x, y: p.y, heading: Math.atan2(p.ty, p.tx), speed: 12, forwardSpeed: 12, slipAngle: 0 });
  Object.assign(run, { index: 50, s: 50, furthest: 50, progressRate: 12, hadCombo: true });
  game.scoring.combo = { points: 0.1, tier: 0, grace: TUNING.simStep / 2, tierGround: 0, linkGround: 0, stallTimer: 0, stallGround: 0, side: 1 };
  ONE_DRIFT.step(run, game, p.x - p.tx * 0.1, p.y - p.ty * 0.1, 0);
  assert.equal(game.scoring.combo, null);
  assert.equal(game.scoring.event, null, 'a tiny bank has no HUD announcement');
  assert.equal(run.phase, 'complete');
  assert.equal(run.result.ended, 'banked');
  assert.equal(run.result.value, 0, 'zero is a valid completed score');
});

test('One Drift: losing the first combo to a finish cone fails even while crossing the finish', () => {
  const game = createGame();
  startRun(game, { mode: 'gymkhana', challenge: ONE_DRIFT });
  const run = game.challenge;
  const p = ONE_DRIFT.geometry.course.points[285];
  const x = p.x - p.ty * 7;
  const y = p.y + p.tx * 7;
  Object.assign(game.car, { x, y, heading: Math.atan2(p.ty, p.tx), speed: 12, forwardSpeed: 12, slipAngle: 0 });
  Object.assign(run, { index: 284, s: 284, furthest: 284, progressRate: 12, hadCombo: true, nextGate: 5 });
  game.scoring.combo = { points: 100, tier: 0, grace: 1, tierGround: 0, linkGround: 0, stallTimer: 0, stallGround: 0, side: 1 };
  ONE_DRIFT.step(run, game, x - p.tx * 0.1, y - p.ty * 0.1, 0);
  assert.equal(game.scoring.event.type, 'lost');
  assert.equal(run.phase, 'failed');
  assert.equal(run.reason, 'drift lost: hit a cone');
  assert.equal(run.result.value, null);
});

// --- The session -----------------------------------------------------------------------------
test('a gymkhana session keeps no lap, ghost, circuit result or circuit record, and a normal run afterwards is untouched', () => {
  const stored = new Map();
  const storage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
  const records = createRecords(() => storage);
  const events = [];
  const game = createGame(undefined, { onRunEvent: (e) => { events.push(e); records.handle(e); } });
  for (const def of GYMKHANA_CHALLENGES) {
    startRun(game, { mode: 'gymkhana', challenge: def });
    const driver = def === PRECISION_180 ? tidy() : def === SLALOM_SPRINT ? D.slalomWeave() : drifter();
    for (let i = 0; i < 40 / TUNING.simStep && game.state !== 'finished'; i += 1) tick(game, driver(game));
    assert.equal(game.state, 'finished', def.id);
    assert.equal(game.results, null, 'the circuit results are never filled in');
    assert.equal(game.ghost, null);
    assert.equal(game.laps.completed + game.laps.voided, 0);
  }
  assert.deepEqual(events.map((e) => e.type), ['start', 'challenge', 'start', 'challenge', 'start', 'challenge', 'start', 'challenge']);
  assert.deepEqual(events.filter((e) => e.type === 'start').map((e) => [e.mode, e.challengeId]),
    [['gymkhana', 'precision-180'], ['gymkhana', 'linked-drift'], ['gymkhana', 'one-drift'], ['gymkhana', 'slalom-sprint']]);
  const [first] = events.filter((e) => e.type === 'challenge');
  assert.deepEqual(Object.keys(first).sort(), ['challengeId', 'completed', 'handling', 'runId', 'type', 'value']);
  assert.equal(first.completed, true);
  assert.ok(first.value > 7 && first.value < 8);
  assert.equal(stored.size, 0, 'nothing was written to the circuit records');
  assert.deepEqual(records.newBests, { score: false, fastestLap: false, bestCombo: false });

  returnToMenu(game);
  assert.equal(game.challenge, null);
  assert.equal(game.challengeDef, null);
  startRun(game, { track: trackById('original') });
  assert.equal(game.mode, 'normal');
  assert.equal(game.challenge, null);
  assert.ok(game.ghost, 'a normal run records its ghost again');
  const fresh = createGame();
  startRun(fresh, { track: trackById('original') });
  for (let i = 0; i < 600; i += 1) { tick(game, KEYS({ up: true })); tick(fresh, KEYS({ up: true })); }
  assert.deepEqual({ ...game.car }, { ...fresh.car }, 'and drives exactly as a game that never saw a challenge');
  assert.ok(!('challengeId' in events.at(-1)), 'a normal run\'s start event is as it always was');
});

test('a failed challenge reports no value, and each run reports exactly once', () => {
  const events = [];
  const { game } = drive(LINKED_DRIFT, classic, () => KEYS({ up: true }), { onRunEvent: (e) => events.push(e) });
  const finishes = events.filter((e) => e.type === 'challenge');
  assert.equal(finishes.length, 1);
  assert.deepEqual(finishes[0], { type: 'challenge', challengeId: 'linked-drift', runId: game.runId, handling: 'classic', completed: false, value: null });
  for (let i = 0; i < 240; i += 1) advance(game, 1 / 60, KEYS({ up: true }));
  assert.equal(events.filter((e) => e.type === 'challenge').length, 1, 'a finished session says nothing more');
});

test('restarting repeats the same challenge with a fresh run, from any point', () => {
  const power = handlingById('revised');
  const game = createGame(undefined, { handling: power });
  startRun(game, { mode: 'gymkhana', challenge: ONE_DRIFT, handling: power });
  const first = game.challenge;
  for (let i = 0; i < 600; i += 1) tick(game, KEYS({ up: true }));
  assert.ok(first.time > 0);
  const firstId = game.runId;
  restartRun(game, { ghost: false, mode: 'gymkhana' });   // what the page's R does, mid-run
  assert.notEqual(game.challenge, first);
  assert.equal(game.challengeDef, ONE_DRIFT);
  assert.equal(game.state, 'ready');
  assert.equal(game.runId, firstId + 1);
  assert.equal(game.challenge.time, 0);
  assert.equal(game.handling.id, 'revised');
  assert.equal(game.scoring.score, 0);
  assert.ok(game.challenge.cones.every((c) => !c.hit));
  assert.deepEqual({ x: game.car.x, y: game.car.y, speed: game.car.speed }, { x: ONE_DRIFT.track.start.x, y: ONE_DRIFT.track.start.y, speed: 0 });

  // And from the results: drive to a failure, then restart.
  for (let i = 0; i < 60 / TUNING.simStep && game.state !== 'finished'; i += 1) tick(game, KEYS({ up: true }));
  assert.equal(game.state, 'finished');
  restartRun(game, { ghost: false, mode: 'gymkhana' });
  assert.equal(game.state, 'ready');
  assert.equal(game.challenge.phase, 'running');
  assert.equal(game.challenge.nextGate, 0);
});

test('two identical attempts after a restart give identical results', () => {
  const game = createGame(undefined, { handling: classic });
  const attempt = () => {
    const driver = tidy();
    for (let i = 0; i < 40 / TUNING.simStep && game.state !== 'finished'; i += 1) tick(game, driver(game));
    return structuredClone(game.challenge.result);
  };
  startRun(game, { mode: 'gymkhana', challenge: PRECISION_180 });
  const a = attempt();
  restartRun(game, { ghost: false, mode: 'gymkhana' });
  // The scripted driver paces itself from the session's tick count, which a restart resets.
  const b = attempt();
  assert.deepEqual(a, b, 'nothing of the first attempt carries into the second');
});
