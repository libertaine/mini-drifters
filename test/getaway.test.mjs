// Getaway Drift (EXPERIMENTAL, v0.7.0 R4 research): camera checkpoints, escape and capture,
// medals, the police car's limits, and isolation from everything that ships.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TUNING } from '../src/tuning.js';
import { createGame, startRun, tick } from '../src/game.js';
import { createScoring } from '../src/scoring.js';
import { handlingById } from '../src/handling.js';
import { GYMKHANA_CHALLENGES, GYMKHANA_CHALLENGE_IDS, challengeById } from '../src/gymkhana.js';
import { MEDAL_TARGETS, medalFor } from '../src/medals.js';
import { createGymkhanaRecords, GYMKHANA_RECORDS_KEY } from '../src/gymkhana-records.js';
import {
  createGetawayChallenge, GETAWAY_ROUTE, GETAWAY_OPEN, PURSUER, CAPTURE_MODELS, captureRate, createPursuer, stepPursuer,
  getawayMedal, getawayTargets,
} from '../src/getaway.js';
import { getawayExtras } from '../src/getaway-entry.js';
import { driveGetaway, getawayGrip, getawayStall, getawayBank, getawayDrift } from './support/getaway-drivers.mjs';

const CLASSIC = handlingById('classic');
const POWER = handlingById('revised');
const DT = TUNING.simStep;
const PARKED = { delay: 1e9 };   // the police car never sets off: checkpoint tests only

// A scripted "car" for driving a challenge's step directly: moved along the course line at a
// lateral offset (+ is right of the road), at a steady speed, with no slide.
function rig(def) {
  const run = def.createRun();
  const scoring = createScoring();
  const p0 = def.geometry.course.points[0];
  const car = { x: p0.x, y: p0.y, vx: 0, vy: 0, speed: 0, forwardSpeed: 0, slipAngle: 0, handbrake: false, heading: Math.atan2(p0.ty, p0.tx) };
  return { run, scoring, car, game: { car, scoring } };
}
const pointAt = (def, s) => def.geometry.course.points[Math.max(0, Math.min(def.geometry.course.points.length - 1, Math.round(s)))];
// Moves from course distance `from` to `to` at `offset` metres right of the line, `speed` m/s
// (negative distance change = driving backwards along the course, nose first the other way).
function walk(def, r, from, to, { offset = 0, speed = 20 } = {}) {
  const dir = Math.sign(to - from);
  if (dir === 0) return;
  const stepLen = speed * DT;
  for (let s = from; dir > 0 ? s <= to : s >= to; s += dir * stepLen) {
    if (r.run.phase !== 'running') return;
    const a = pointAt(def, s);
    const b = pointAt(def, s + 1);
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const frac = s - Math.floor(s);
    const ax = r.car.x;
    const ay = r.car.y;
    r.car.x = a.x + (tx * frac) + nx * -offset;
    r.car.y = a.y + (ty * frac) + ny * -offset;
    r.car.heading = Math.atan2(ty * dir, tx * dir);
    r.car.vx = Math.cos(r.car.heading) * speed;
    r.car.vy = Math.sin(r.car.heading) * speed;
    r.car.speed = speed;
    r.car.forwardSpeed = speed;
    def.step(r.run, r.game, ax, ay, 0);
  }
}
const events = (r) => r.run.eventLog;
function logged(def, r) {
  const step = def.step;
  r.run.eventLog = [];
  let serial = r.run.eventSerial;
  return { ...def, step: (run, game, ax, ay, impact) => { step(run, game, ax, ay, impact); if (run.eventSerial !== serial) { serial = run.eventSerial; run.eventLog.push(run.event); } } };
}

// --- Camera checkpoints ----------------------------------------------------------------------
test('cameras: a clean drive on the road takes all four shots in order, and the escape gate then completes the run', () => {
  for (const variant of ['route', 'open']) {
    const def0 = createGetawayChallenge({ variant, pursuer: PARKED });
    const r = rig(def0);
    const def = logged(def0, r);
    walk(def, r, 0, def0.geometry.exitS + 5);
    assert.equal(r.run.phase, 'complete', variant);
    assert.equal(r.run.nextCamera, 4);
    const times = r.run.cameras.map((c) => c.time);
    assert.deepEqual([...times].sort((a, b) => a - b), times, 'filmed in order');
    assert.deepEqual(events(r).filter((e) => e.type === 'shot').map((e) => e.camera), [1, 2, 3, 4]);
    assert.equal(events(r).at(-1).type, 'escaped');
    assert.equal(r.run.result.ended, 'escaped');
  }
});

test('cameras: driving past a camera outside its band misses it; recover keeps it next and the exit shut, and going back for it works', () => {
  const def0 = createGetawayChallenge({ variant: 'route', missPolicy: 'recover', pursuer: PARKED });
  const r = rig(def0);
  const def = logged(def0, r);
  const cam1 = def0.geometry.cameras[0];
  walk(def, r, 0, cam1.s - 30);
  walk(def, r, cam1.s - 30, cam1.s + 30, { offset: 20 });   // wide of the band
  assert.equal(r.run.phase, 'running');
  assert.equal(r.run.nextCamera, 0);
  assert.equal(r.run.cameras[0], null);
  assert.equal(r.run.missed[0], true);
  assert.equal(r.run.missedShots, 1);
  assert.ok(events(r).some((e) => e.type === 'missed' && e.camera === 1));
  // Camera 2 filmed out of order: no credit.
  walk(def, r, cam1.s + 30, def0.geometry.cameras[1].s + 5, { offset: 20 });
  walk(def, r, def0.geometry.cameras[1].s + 5, def0.geometry.cameras[1].s - 5, { offset: 0 });
  walk(def, r, def0.geometry.cameras[1].s - 5, def0.geometry.cameras[1].s + 5, { offset: 0 });
  assert.equal(r.run.cameras[1], null, 'no credit for a later camera first');
  assert.equal(r.run.nextCamera, 0);
  // Back behind camera 1 on the road: crossing it backwards films nothing...
  walk(def, r, def0.geometry.cameras[1].s - 5, cam1.s - 10, { offset: 0 });
  assert.equal(r.run.cameras[0], null, 'a reverse crossing films nothing');
  assert.equal(r.run.missed[0], false, 'back behind it, it can be filmed again');
  // ...and through it the right way films it.
  walk(def, r, cam1.s - 10, cam1.s + 10);
  assert.ok(r.run.cameras[0]);
  assert.equal(r.run.nextCamera, 1);
});

test('cameras: with the strict policy, a missed camera cancels the upload and fails the run', () => {
  const def = createGetawayChallenge({ variant: 'route', missPolicy: 'strict', pursuer: PARKED });
  const r = rig(def);
  const cam1 = def.geometry.cameras[0];
  walk(def, r, 0, cam1.s - 30);
  walk(def, r, cam1.s - 30, cam1.s + 30, { offset: 20 });
  assert.equal(r.run.phase, 'failed');
  assert.equal(r.run.reason, 'missed camera 1');
  assert.equal(r.run.result.value, null);
  assert.equal(r.run.result.ended, 'missed');
});

test('cameras: a filmed camera is filmed once; driving back and forth through it changes nothing', () => {
  const def = createGetawayChallenge({ variant: 'route', pursuer: PARKED });
  const r = rig(def);
  const cam1 = def.geometry.cameras[0];
  walk(def, r, 0, cam1.s + 5);
  const first = r.run.cameras[0];
  for (let i = 0; i < 3; i += 1) { walk(def, r, cam1.s + 5, cam1.s - 5); walk(def, r, cam1.s - 5, cam1.s + 5); }
  assert.equal(r.run.cameras[0], first);
  assert.equal(r.run.nextCamera, 1);
});

test('cameras: the open layout\'s escape gate is in reach from the grid, shut until all four shots, and crossing it shut does not end the run', () => {
  const def = createGetawayChallenge({ variant: 'open', pursuer: PARKED });
  const { exit, start } = def.geometry;
  assert.ok(Math.hypot(exit.cx - start.x, exit.cy - start.y) < 70, 'the escape gate is near the grid');
  const r = rig(def);
  // Straight across from the grid to just before the gate, then through it in its direction.
  const go = (x, y) => {
    const ax = r.car.x;
    const ay = r.car.y;
    r.car.heading = Math.atan2(y - ay, x - ax);
    r.car.x = x;
    r.car.y = y;
    def.step(r.run, r.game, ax, ay, 0);
  };
  const before = { x: exit.cx - exit.tx * 10, y: exit.cy - exit.ty * 10 };
  for (let i = 1; i <= 200; i += 1) go(start.x + (before.x - start.x) * i / 200, start.y + (before.y - start.y) * i / 200);
  for (let i = 1; i <= 20; i += 1) go(before.x + exit.tx * i, before.y + exit.ty * i);
  assert.equal(r.run.lockedTries, 1);
  assert.equal(r.run.event.type, 'locked');
  assert.equal(r.run.phase, 'running');
  assert.equal(r.run.exitOpen, false);
});

test('cameras: a grip escape with no drift points completes, scoring 0, for Bronze', () => {
  for (const def of [GETAWAY_ROUTE, GETAWAY_OPEN]) for (const mode of [CLASSIC, POWER]) {
    const { result } = driveGetaway(def, mode, getawayGrip({ lateral: 10 }));
    assert.equal(result.ended, 'escaped', `${def.variant} ${mode.id}`);
    assert.equal(result.footage, 4);
    assert.equal(result.value, 0);
    assert.equal(getawayMedal(def, mode.id, result.value), 'bronze');
  }
});

test('retry: a restart is a fresh run, with the police car back on its mark and an empty meter', () => {
  const game = createGame(undefined, { handling: CLASSIC });
  startRun(game, { mode: 'gymkhana', ghost: false, handling: CLASSIC, challenge: GETAWAY_ROUTE });
  const parked = { ...game.challenge.pursuer };
  const drive = getawayGrip({ lateral: 10 });
  for (let i = 0; i < 20 / DT; i += 1) tick(game, drive(game));
  assert.notEqual(game.challenge.pursuer.x, parked.x);
  assert.ok(game.challenge.nextCamera > 0);
  startRun(game, { mode: 'gymkhana', ghost: false, handling: CLASSIC });
  const p = game.challenge.pursuer;
  assert.deepEqual([p.x, p.y, p.heading, p.speed, p.state], [parked.x, parked.y, parked.heading, 0, 'parked']);
  assert.deepEqual([game.challenge.meter, game.challenge.nextCamera, game.challenge.time, game.challenge.trail.length], [0, 0, 0, 1]);
});

// --- Medals ------------------------------------------------------------------------------------
test('medals: nothing for a failed pursuit; Bronze for any escape; Silver and Gold by banked points, per mode', () => {
  for (const def of [GETAWAY_ROUTE, GETAWAY_OPEN]) for (const mode of ['classic', 'revised']) {
    const t = getawayTargets(def, mode);
    assert.equal(t.bronze, 0);
    assert.ok(t.silver > 0 && t.gold > t.silver);
    assert.equal(getawayMedal(def, mode, null), null, 'a bust earns nothing');
    assert.equal(getawayMedal(def, mode, 0), 'bronze');
    assert.equal(getawayMedal(def, mode, t.silver - 1), 'bronze');
    assert.equal(getawayMedal(def, mode, t.silver), 'silver');
    assert.equal(getawayMedal(def, mode, t.gold - 1), 'silver');
    assert.equal(getawayMedal(def, mode, t.gold), 'gold');
  }
  // Classic and Power have their own numbers, and the same score can mean different medals.
  assert.notDeepEqual(getawayTargets(GETAWAY_ROUTE, 'classic'), getawayTargets(GETAWAY_ROUTE, 'revised'));
  assert.equal(getawayMedal(GETAWAY_ROUTE, 'classic', 2000), 'gold');
  assert.equal(getawayMedal(GETAWAY_ROUTE, 'revised', 2000), 'silver');
  assert.equal(getawayMedal(GETAWAY_ROUTE, 'unknown-mode', 5000), null);
});

test('medals: an escape counts only banked points (the live combo banks at the gate, as at a finish); a bust counts nothing', () => {
  const { result, game } = driveGetaway(GETAWAY_ROUTE, POWER, getawayBank(getawayDrift({ minCorner: 1 / 50 }), getawayGrip({ lateral: 10, cap: 30 })));
  assert.equal(result.ended, 'escaped');
  assert.ok(result.value > 0);
  assert.equal(result.value, game.scoring.score, 'the value is the banked score');
  assert.equal(game.scoring.combo, null, 'nothing left unbanked');
  // A bust: the combo running at the time is lost, and the run has no value.
  const busted = driveGetaway(GETAWAY_ROUTE, POWER, getawayStall(getawayDrift({ minCorner: 1 / 50 }), { fromS: 230, seconds: 10 }));
  assert.equal(busted.result.ended, 'busted');
  assert.equal(busted.result.value, null);
  assert.equal(getawayMedal(GETAWAY_ROUTE, 'revised', busted.result.value), null);
});

// --- The police car ------------------------------------------------------------------------------
test('police: it moves and turns within its own limits: no teleport, no instant turn, never past its top speed', () => {
  const P = PURSUER;
  for (const mode of [CLASSIC, POWER]) {
    let worstMove = 0;
    let worstTurn = 0;
    let topSpeed = 0;
    let turned = 0;
    driveGetaway(GETAWAY_ROUTE, mode, getawayDrift({ targetSlip: 40 * Math.PI / 180, catchSlip: 52 * Math.PI / 180, minCorner: 1 / 90 }), { onTick: (g) => {
      const p = g.challenge.pursuer;
      worstMove = Math.max(worstMove, Math.hypot(p.x - p.prevX, p.y - p.prevY));
      const dh = Math.abs(Math.atan2(Math.sin(p.heading - p.prevHeading), Math.cos(p.heading - p.prevHeading)));
      worstTurn = Math.max(worstTurn, dh);
      turned += dh;
      topSpeed = Math.max(topSpeed, Math.abs(p.speed));
    } });
    assert.ok(worstMove <= P.vMax * DT + 1e-9, `moved ${worstMove} m in one step`);
    // The sharpest it can turn in a step is its crawl-speed pivot (crawl / turnRadius), or the
    // wall turning it to run along the wall, which is at most a right angle.
    assert.ok(worstTurn <= Math.PI / 2 + 1e-9, `turned ${worstTurn} rad in one step`);
    assert.ok(topSpeed <= P.vMax + 1e-9);
    assert.ok(turned > Math.PI, 'it turned through the bends');
  }
});

test('police: driven past a car that brakes to a stop, it comes back round and boxes it in', () => {
  const start = { x: 0, y: 0, heading: 0 };
  const p = createPursuer(start, PURSUER);
  Object.assign(p, { x: -6, y: 0, speed: 28, heading: 0 });
  const car = { x: 0, y: 0, vx: 0, vy: 0, speed: 0 };
  const bounds = { minX: -300, maxX: 300, minY: -300, maxY: 300 };
  let passed = false;
  let back = null;
  for (let t = 0; t < 12; t += DT) {
    const gap = stepPursuer(p, car, [{ x: 0, y: 0 }], DT, PURSUER, bounds);
    if (p.x > car.x + 2) passed = true;
    if (passed && back === null && gap < CAPTURE_MODELS.proximity.radius && Math.abs(p.speed) < 3) back = t;
  }
  assert.ok(passed, 'it overshot');
  assert.ok(p.overshoots >= 1);
  assert.ok(back !== null && back < 8, `back within the ring after ${back} s`);
});

test('police: it never stalls on ordinary geometry: across both layouts, modes and wild driving it is never stuck for more than a second', () => {
  for (const def of [GETAWAY_ROUTE, GETAWAY_OPEN]) for (const mode of [CLASSIC, POWER]) {
    const { run } = driveGetaway(def, mode, getawayDrift({ targetSlip: 42 * Math.PI / 180, catchSlip: 55 * Math.PI / 180, cooldown: 0.8, minCorner: 1 / 120 }));
    assert.ok(run.pursuer.longestStuck < 1, `${def.variant} ${mode.id}: stuck ${run.pursuer.longestStuck} s`);
  }
});

test('capture: sustained proximity busts a stopped car; a brief brush does not', () => {
  const C = CAPTURE_MODELS.proximity;
  // Pure meter: 2 s inside fills it; 1 s inside then out never does, and drains away.
  let meter = 0;
  let t = 0;
  for (; meter < 1 && t < 5; t += DT) meter = Math.min(1, meter + captureRate(C, 5, 0) * DT);
  assert.ok(Math.abs(t - C.fillTime) < 0.02, `filled in ${t} s`);
  meter = 0;
  let peak = 0;
  for (let s = 0; s < 1; s += DT) { meter = Math.min(1, meter + captureRate(C, 5, 0) * DT); peak = Math.max(peak, meter); }
  for (let s = 0; s < 3; s += DT) meter = Math.max(0, meter + captureRate(C, 20, 0) * DT);
  assert.ok(peak < 0.55 && meter === 0);
  // In the session: a car that stops is busted, and the run fails with no value.
  const { run, result } = driveGetaway(GETAWAY_ROUTE, CLASSIC, getawayStall(getawayGrip({ lateral: 10 }), { fromS: 60, seconds: 20 }));
  assert.equal(run.phase, 'failed');
  assert.equal(run.reason, 'busted');
  assert.equal(result.value, null);
  assert.equal(result.ended, 'busted');
});

test('capture: speed is no defence: a car at 30 m/s with the police car matching it on its bumper is busted', () => {
  for (const capture of ['proximity', 'pressure']) {
    const def = createGetawayChallenge({ variant: 'route', capture, pursuer: { delay: 0 } });
    const r = rig(def);
    // Both cars on the grid straight, the police car 4 m behind at the same speed.
    const p = r.run.pursuer;
    Object.assign(p, { x: r.car.x - 4, y: r.car.y, heading: 0, speed: 30 });
    r.car.heading = 0;
    let busted = null;
    for (let t = 0; t < 4 && r.run.phase === 'running'; t += DT) {
      const ax = r.car.x;
      const ay = r.car.y;
      Object.assign(r.car, { x: ax + 30 * DT, vx: 30, vy: 0, speed: 30, forwardSpeed: 30 });
      def.step(r.run, r.game, ax, ay, 0);
      if (r.run.phase === 'failed') busted = r.run.time;
    }
    assert.equal(r.run.reason, 'busted', capture);
    assert.ok(busted < 3, `${capture}: busted after ${busted} s`);
  }
});

test('capture ends the challenge: the session finishes, and a busted run sets nothing', () => {
  const seen = [];
  const game = createGame(undefined, { handling: CLASSIC, onRunEvent: (e) => seen.push(e) });
  startRun(game, { mode: 'gymkhana', ghost: false, handling: CLASSIC, challenge: GETAWAY_ROUTE });
  const drive = getawayStall(getawayGrip({ lateral: 10 }), { fromS: 60, seconds: 30 });
  for (let i = 0; i < 40 / DT && game.state !== 'finished'; i += 1) tick(game, drive(game));
  assert.equal(game.state, 'finished');
  const done = seen.find((e) => e.type === 'challenge');
  assert.deepEqual([done.challengeId, done.completed, done.value], ['getaway-drift-route', false, null]);
});

test('the same inputs give the same chase: runs are deterministic', () => {
  const a = driveGetaway(GETAWAY_ROUTE, POWER, getawayDrift({ minCorner: 1 / 50 })).result;
  const b = driveGetaway(GETAWAY_ROUTE, POWER, getawayDrift({ minCorner: 1 / 50 })).result;
  assert.deepEqual(a, b);
});

// --- Isolation ---------------------------------------------------------------------------------
test('isolation: the four challenges, their rules and their medal targets are exactly R1\'s', () => {
  assert.deepEqual(GYMKHANA_CHALLENGE_IDS, ['precision-180', 'linked-drift', 'one-drift', 'slalom-sprint']);
  assert.deepEqual(GYMKHANA_CHALLENGES.map((c) => c.rules), ['precision-180-1', 'linked-drift-1', 'one-drift-1', 'slalom-sprint-1']);
  assert.equal(challengeById('getaway-drift-route'), null);
  assert.equal(challengeById('getaway-drift-open'), null);
  const P180 = { gold: 7.6, silver: 8.3, bronze: 30 };
  const SLALOM = { gold: 14.8, silver: 18.5, bronze: 40 };
  assert.deepEqual(JSON.parse(JSON.stringify(MEDAL_TARGETS)), {
    'precision-180': { 'precision-180-1': { classic: P180, revised: P180 } },
    'linked-drift': { 'linked-drift-1+scoring-2': { classic: { gold: 850, silver: 450, bronze: 1 }, revised: { gold: 950, silver: 450, bronze: 1 } } },
    'one-drift': { 'one-drift-1+scoring-2': { classic: { gold: 800, silver: 400, bronze: 1 }, revised: { gold: 850, silver: 400, bronze: 1 } } },
    'slalom-sprint': { 'slalom-sprint-1': { classic: SLALOM, revised: SLALOM } },
  });
  assert.equal(medalFor(GETAWAY_ROUTE, 'classic', 5000), null, 'medals.js knows nothing of Getaway');
});

test('isolation: a Getaway run is never a gymkhana record: nothing is written, whatever it scores', () => {
  const writes = [];
  const storage = { getItem: () => null, setItem: (k, v) => writes.push([k, v]) };
  const records = createGymkhanaRecords(() => storage);
  const game = createGame(undefined, { handling: POWER, onRunEvent: (e) => records.handle(e) });
  startRun(game, { mode: 'gymkhana', ghost: false, handling: POWER, challenge: GETAWAY_ROUTE });
  const drive = getawayBank(getawayDrift({ minCorner: 1 / 50 }), getawayGrip({ lateral: 10, cap: 30 }));
  for (let i = 0; i < 120 / DT && game.state !== 'finished'; i += 1) tick(game, drive(game));
  assert.equal(game.challenge.phase, 'complete');
  assert.ok(game.challenge.result.value > 0);
  assert.deepEqual(writes, []);
  assert.equal(records.newBest, false);
  assert.equal(records.bestFor('getaway-drift-route', 'revised'), null);
  assert.equal(GYMKHANA_RECORDS_KEY, 'mini-drifters-gymkhana-v1');
});

test('isolation: the challenge reads the car and never writes it', () => {
  const def = createGetawayChallenge({ variant: 'route', pursuer: { delay: 0, startGap: 5 } });
  const r = rig(def);
  Object.assign(r.car, { x: r.car.x + 1, vx: 12, speed: 12, forwardSpeed: 12, slipAngle: 0.3 });
  const before = structuredClone(r.car);
  for (let i = 0; i < 240; i += 1) def.step(r.run, r.game, r.car.x, r.car.y, 0);
  assert.deepEqual(r.car, before);
});

test('isolation: the experimental files touch no storage, and the entry switch is off unless asked for', () => {
  for (const file of ['getaway.js', 'getaway-draw.js', 'getaway-entry.js']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|setItem/, file);
  }
  assert.deepEqual(getawayExtras(''), []);
  assert.deepEqual(getawayExtras('?gymkhana=1'), []);
  // R4B: the switch now offers the two city layouts (test/getaway-urban.test.mjs checks them). R4's
  // own layouts are built here directly, with the options R4's switch passed them.
  assert.deepEqual([GETAWAY_ROUTE, GETAWAY_OPEN].map((d) => [d.id, d.experimental, d.tier, d.captureModel.id, d.missPolicy]),
    [['getaway-drift-route', true, 'standard', 'proximity', 'recover'], ['getaway-drift-open', true, 'standard', 'proximity', 'recover']]);
  const other = createGetawayChallenge({ capture: 'pressure', tier: 'firm', missPolicy: 'strict' });
  assert.deepEqual([other.captureModel.id, other.tier, other.missPolicy], ['pressure', 'firm', 'strict']);
});
