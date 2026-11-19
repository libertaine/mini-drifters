// Dockyard, the third circuit: its shape, checkpoints and lap rules, the real car on it in both
// handling modes, its ghost, its records, and what a v0.4.0 tab does to them. Modelled on
// tracks.test.mjs, which covers Switchback. Original's own shape stays pinned there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TUNING as T } from '../src/tuning.js';
import { TRACKS, DEFAULT_TRACK_ID, trackById, projectOnTrack, surfaceAt, trackDelta } from '../src/track.js';
import { createLaps, updateLaps } from '../src/laps.js';
import { createGame, startRun, tick, countedScore, NO_INPUT } from '../src/game.js';
import { ghostIsCompatible } from '../src/ghost.js';
import { handlingById } from '../src/handling.js';
import { SCORING_VERSION, LEGACY_SCORING_VERSION } from '../src/scoring.js';
import { createRecords, RECORDS_KEY, V2_RECORDS_KEY, LEGACY_RECORDS_KEY } from '../src/records.js';
import { createRecords as createV040Records, RECORDS_KEY as V040_RECORDS_KEY } from './support/records-e4481a4.mjs';
import { gripDriver, driftDriver, recklessDriver } from './support/drivers.mjs';
const track = trackById('dockyard');
const original = trackById('original');
const DEG = Math.PI / 180;
const steps = (seconds) => Math.round(seconds / T.simStep);
const classic = handlingById('classic');
const power = handlingById('revised');

// --- The choice of circuits ----------------------------------------------------------------
// Rounded so that the last bits of floating point on another platform can't fail it, as in
// tracks.test.mjs.
function shapeDigest(t) {
  const round = (value) => (typeof value === 'number' ? Number(value.toFixed(6)) : value);
  const shape = { points: t.points, finish: t.finish, gates: t.gates, bounds: t.bounds, start: t.start };
  return createHash('sha256').update(JSON.stringify(shape, (_, value) => round(value))).digest('hex');
}

// The control points the owner drove and accepted in the v0.5.0 prototype, which are the
// research report's. A change here is a change to the accepted circuit and needs review.
const ACCEPTED_DOCKYARD = [
  [-41, -78], [5.8, -78], [52.6, -78], [99.4, -78],
  [117.1, -75.5], [133.3, -68.3], [147, -56.8], [156.9, -42], [162.4, -25.1],
  [163.2, -14.6], [161.4, -4.4], [156.4, 4.7], [147.8, 11.3], [137.3, 13.6],
  [92.3, 13.6], [47.3, 13.6], [2.3, 13.6],
  [-7.4, 15.2], [-16, 19.8], [-22.7, 27], [-26.7, 35.9],
  [-32, 55.8], [-36.1, 64.7], [-42.8, 71.8], [-51.4, 76.4], [-61, 78],
  [-86, 78], [-108, 74.8], [-128.2, 65.6], [-145, 51], [-157, 32.3], [-163.2, 11.1],
  [-163.2, -11.2], [-156.9, -32.4], [-144.9, -51.1], [-128.1, -65.6], [-107.9, -74.9], [-85.9, -78],
];

test('Dockyard is the third circuit, on the accepted prototype\'s control points', () => {
  assert.deepEqual(TRACKS.map((t) => [t.id, t.name]), [['original', 'Original'], ['switchback', 'Switchback'], ['dockyard', 'Dockyard']]);
  assert.equal(DEFAULT_TRACK_ID, 'original');
  assert.equal(trackById('dockyard'), track, 'built once');
  assert.equal(track.id, 'dockyard');
  assert.deepEqual(TRACKS[2].control, ACCEPTED_DOCKYARD);
  // Measured from the accepted prototype's build of the circuit.
  assert.equal(track.points.length, 416);
  assert.equal(track.length.toFixed(6), '831.948976');
  assert.equal(shapeDigest(track), 'a05d469931122f9b85ca12f29b4883ba3cece97c007b9cdc0723352a17c1886a');
});

test('Switchback is exactly the v0.4.0 circuit', () => {
  const switchback = trackById('switchback');
  // Measured from the v0.4.0 tag's (e4481a4) src/track.js.
  assert.equal(switchback.points.length, 659);
  assert.equal(switchback.length.toFixed(6), '1318.987383');
  assert.equal(shapeDigest(switchback), '8fdee604cdc4ce21e3dbcc7b3cd80b5fe9cac0e6c4269e6ac3e12ed86c0d30dd');
});
// --- Dockyard's shape ----------------------------------------------------------------------
test('Dockyard is a closed circuit, sampled evenly, that never kinks or crosses itself', () => {
  const { points, length, step } = track;
  assert.ok(length > 800 && length < 870, `${length} m`);
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % n];
    assert.ok([p.x, p.y, p.tx, p.ty, p.curvature].every(Number.isFinite), `point ${i}`);
    assert.ok(Math.abs(Math.hypot(q.x - p.x, q.y - p.y) - step) < 0.05, `spacing at ${i}`);
    assert.ok(p.tx * q.tx + p.ty * q.ty > Math.cos(15 * DEG), `the line kinks at ${i}`);
  }
  const side = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const cross = (a, b, c, d) => side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      assert.equal(cross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n]), false, `segments ${i} and ${j}`);
    }
  }
});

test('separate sections of Dockyard have at least 20 m of grass between them', () => {
  const { points } = track;
  const clearance = 2 * (track.halfWidth + track.curbWidth) + 20;
  let closest = Infinity;
  for (let i = 0; i < points.length; i += 2) {
    for (let j = i + 2; j < points.length; j += 2) {
      const along = Math.min(points[j].s - points[i].s, track.length - (points[j].s - points[i].s));
      if (along < 80) continue;
      closest = Math.min(closest, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    }
  }
  assert.ok(closest > clearance, `${closest.toFixed(1)} m`);
  assert.ok(closest > 60, `the report measured 65 m: ${closest.toFixed(1)} m`);
});

test('the Hook tightens from about 64 m to about 24 m, and the Basin holds 69 to 80 m', () => {
  const radius = (s) => 1 / Math.abs(track.points[Math.round(s / track.step)].curvature);
  const wide = [170, 180, 190, 200, 210].map(radius);
  assert.ok(wide.every((r) => r > 58 && r < 70), wide.map((r) => r.toFixed(0)).join(', '));
  const tightening = [220, 230, 240, 250, 260, 270].map(radius);
  for (let i = 1; i < tightening.length; i += 1) assert.ok(tightening[i] < tightening[i - 1], tightening.map((r) => r.toFixed(0)).join(', '));
  assert.ok(tightening[tightening.length - 1] > 22 && tightening[tightening.length - 1] < 27);
  const tightest = Math.max(...track.points.map((p) => Math.abs(p.curvature)));
  assert.ok(1 / tightest >= 23.5, `tightest radius ${(1 / tightest).toFixed(1)} m`);
  const basin = track.points.filter((p) => p.s >= 580 && p.s <= 760).map((p) => 1 / Math.abs(p.curvature));
  assert.ok(Math.min(...basin) > 66 && Math.max(...basin) < 84, `${Math.min(...basin).toFixed(0)} to ${Math.max(...basin).toFixed(0)} m`);
});

test('the grid is on the quay straight, and the wall is 48 m beyond the outermost road', () => {
  const at = projectOnTrack(track, track.start.x, track.start.y);
  assert.ok(at.distance < 0.01 && at.s > 0 && at.s < 10);
  assert.ok(Math.abs(at.curvature) < 1 / 220, 'on a straight');
  assert.ok(Math.cos(track.start.heading) * at.tx + Math.sin(track.start.heading) * at.ty > 0.9999);
  assert.equal(surfaceAt(track, track.start.x, track.start.y), 'road');
  const b = track.bounds;
  for (const p of track.points) assert.ok(p.x - b.minX >= 48 - 1e-9 && b.maxX - p.x >= 48 - 1e-9 && p.y - b.minY >= 48 - 1e-9 && b.maxY - p.y >= 48 - 1e-9);
  // Visual boundaries: curbs are painted wherever the road bends.
  assert.ok(track.points.filter((p) => Math.abs(p.curvature) > track.curbCurvature).length > 150);
});

test('the 16 checkpoints run in lap order, span the road, and never reach another part of it', () => {
  const gates = [track.finish, ...track.gates];
  assert.equal(track.gates.length, 16);
  assert.equal(track.finish.s, 0);
  for (let i = 1; i < gates.length; i += 1) assert.ok(gates[i].s > gates[i - 1].s, `gate ${i}`);
  const reach = track.halfWidth + track.curbWidth;
  for (const gate of gates) {
    for (let f = 0; f <= 1; f += 0.02) {
      const at = projectOnTrack(track, gate.x1 + (gate.x2 - gate.x1) * f, gate.y1 + (gate.y2 - gate.y1) * f);
      if (Math.abs(trackDelta(track, gate.s, at.s)) > 70) assert.ok(at.distance > reach, `gate at s=${gate.s.toFixed(0)} touches road at s=${at.s.toFixed(0)}`);
    }
    assert.ok(Math.hypot(gate.x2 - gate.x1, gate.y2 - gate.y1) >= 2 * reach + 20);
  }
});

// --- Laps, along the centreline --------------------------------------------------------------
function pointAt(s) {
  const n = track.points.length;
  const f = (((s % track.length) + track.length) % track.length) / track.step;
  const i = Math.floor(f);
  const a = track.points[i % n];
  const b = track.points[(i + 1) % n];
  return { x: a.x + (b.x - a.x) * (f - i), y: a.y + (b.y - a.y) * (f - i) };
}

function driveLine(laps, from, to) {
  const results = [];
  let p = pointAt(from);
  for (let s = from; s < to;) {
    const next = Math.min(s + 1, to);
    const q = pointAt(next);
    const r = updateLaps(laps, track, p.x, p.y, q.x, q.y, 0.05);
    if (r) results.push(r);
    s = next;
    p = q;
  }
  return results;
}

function cutAcross(laps, fromS, toS) {
  const a = pointAt(fromS);
  const b = pointAt(toS);
  for (let i = 0; i < 40; i += 1) {
    updateLaps(laps, track, a.x + ((b.x - a.x) * i) / 40, a.y + ((b.y - a.y) * i) / 40, a.x + ((b.x - a.x) * (i + 1)) / 40, a.y + ((b.y - a.y) * (i + 1)) / 40, 0.05);
  }
}

function cutCounts(from, to) {
  const laps = createLaps();
  driveLine(laps, 6, from);
  cutAcross(laps, from, to);
  return driveLine(laps, to, track.length + 6)[0];
}

test('a full lap of Dockyard counts, and so does the next', () => {
  const laps = createLaps();
  assert.deepEqual(driveLine(laps, 6, track.length + 6), ['lap']);
  assert.deepEqual(driveLine(laps, track.length + 6, 2 * track.length + 6), ['lap']);
  assert.equal(laps.completed, 2);
});

test('the obvious shortcuts all void the lap', () => {
  const shortcuts = {
    'straight across the Hook': [150, 290],
    'missing the chicane and half the Basin': [380, 640],
    'across the middle of the Basin': [560, 780],
    'the quay to the acceleration zone, missing the Hook': [100, 340],
    'the acceleration zone back to the quay, missing the Basin': [330, 800],
  };
  for (const [name, [from, to]] of Object.entries(shortcuts)) assert.equal(cutCounts(from, to), 'void', name);
});

test('of every straight-line cut that saves 25 m or more, one still counts, and it is 106 m of grass', () => {
  const reach = track.halfWidth + track.curbWidth;
  const counted = [];
  let tried = 0;
  for (let from = 10; from < track.length - 20; from += 10) {
    for (let to = from + 30; to < track.length - 2; to += 10) {
      const a = pointAt(from);
      const b = pointAt(to);
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      if (to - from - chord < 25) continue;
      tried += 1;
      if (cutCounts(from, to) !== 'lap') continue;
      let off = 0;
      for (let i = 0; i <= 40; i += 1) if (projectOnTrack(track, a.x + ((b.x - a.x) * i) / 40, a.y + ((b.y - a.y) * i) / 40).distance > reach) off += chord / 40;
      counted.push({ from, to, saving: to - from - chord, off });
    }
  }
  assert.ok(tried > 2000, `${tried} cuts tried`);
  assert.equal(counted.length, 1, JSON.stringify(counted));
  assert.ok(counted[0].saving < 30 && counted[0].off > 100, JSON.stringify(counted[0]));
});

test('running wide on the outside of every corner does not void the lap', () => {
  const laps = createLaps();
  const results = [];
  let p = pointAt(6);
  for (let s = 7; s <= track.length + 6; s += 1) {
    const at = track.points[Math.round((s % track.length) / track.step) % track.points.length];
    const out = Math.abs(at.curvature) > 1 / 220 ? -Math.sign(at.curvature) * 16 : 0;
    const base = pointAt(s);
    const q = { x: base.x - at.ty * out, y: base.y + at.tx * out };
    const r = updateLaps(laps, track, p.x, p.y, q.x, q.y, 0.05);
    if (r) results.push(r);
    p = q;
  }
  assert.deepEqual(results, ['lap']);
});

test('driving Dockyard backward never completes a lap', () => {
  const laps = createLaps();
  let p = pointAt(3 * track.length);
  for (let s = 3 * track.length - 1; s >= 0; s -= 1) {
    const q = pointAt(s);
    assert.notEqual(updateLaps(laps, track, p.x, p.y, q.x, q.y, 0.05), 'lap');
    p = q;
  }
  assert.equal(laps.completed, 0);
});

// --- The real car ------------------------------------------------------------------------------
function run(makeDriver, handling, offset = 0, on = track) {
  const game = createGame(on, { handling });
  startRun(game, { track: on, handling });
  for (let i = 0; i < offset; i += 1) tick(game, NO_INPUT);
  const driver = makeDriver();
  const seen = { wallHits: 0, offCourse: 0, minWall: Infinity };
  const b = on.bounds;
  while (game.state !== 'finished' && game.ticks < steps(500)) {
    tick(game, driver(game));
    if (game.lastImpact > 0) seen.wallHits += 1;
    // Dockyard's apron is concrete (v0.6.0 R1), not grass, so this counts time off the course.
    if (!game.onCourse) seen.offCourse += T.simStep;
    seen.minWall = Math.min(seen.minWall, game.car.x - b.minX, b.maxX - game.car.x, game.car.y - b.minY, b.maxY - game.car.y);
  }
  return { game, ...seen };
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const OFFSETS = [0, 2, 4, 6, 8, 10];
const sample = (makeDriver, handling) => OFFSETS.map((offset) => run(makeDriver, handling, offset));
const MODES = [['Classic', classic], ['Power', power]];
const runs = Object.fromEntries(MODES.map(([name, handling]) => [name, {
  grip: sample(() => gripDriver(), handling), drift: sample(() => driftDriver(), handling), reckless: sample(() => recklessDriver(), handling),
}]));

for (const [name] of MODES) {
  test(`${name}: a grip driver laps Dockyard cleanly: three counted laps, no wall, never off the course`, () => {
    for (const r of runs[name].grip) {
      assert.equal(r.game.state, 'finished');
      assert.equal(r.game.laps.completed, T.runLaps);
      assert.equal(r.game.laps.voided, 0);
      assert.equal(r.wallHits, 0);
      assert.ok(r.offCourse < 1, `${r.offCourse.toFixed(1)} s off the course`);
      assert.ok(r.game.laps.bestLap > 28 && r.game.laps.bestLap < 32, `best lap ${r.game.laps.bestLap}`);
      assert.ok(r.game.results && Number.isFinite(r.game.results.runTime) && r.game.results.voidedLaps === 0, 'timing and results');
    }
  });

  test(`${name}: a drifting driver gets round with every lap counting, scores, and reaches the top multiplier`, () => {
    for (const r of runs[name].drift) {
      assert.equal(r.game.state, 'finished');
      assert.equal(r.game.laps.voided, 0);
      assert.equal(r.wallHits, 0);
      assert.ok(r.minWall > 15, `${r.minWall.toFixed(0)} m from the wall`);
      assert.ok(countedScore(r.game) > 1500, `score ${countedScore(r.game)}`);
    }
    assert.equal(median(runs[name].drift.map((r) => r.game.scoring.bestMultiplier)), 3);
    assert.ok(median(runs[name].drift.map((r) => r.game.scoring.spinouts)) <= 6);
  });

  test(`${name}: controlled drifting out-scores hauling on the handbrake, which never reaches the wall`, () => {
    const score = (list) => median(list.map((r) => countedScore(r.game)));
    assert.ok(score(runs[name].drift) > 2 * score(runs[name].reckless), `drift ${score(runs[name].drift)} against reckless ${score(runs[name].reckless)}`);
    for (const r of runs[name].reckless) {
      assert.equal(r.game.state, 'finished');
      assert.equal(r.wallHits, 0);
    }
  });
}

// v0.5.0's finding was that the one driver that ever voided a lap was the handbrake-hauler in
// Power, at checkpoint 11, 40 m into the Basin, crawling across the grass just past the
// checkpoint's inside end (1 to 8 laps of about 75). With the apron concrete (v0.6.0 R1) the car
// keeps its grip out there, recovers at speed and stays outside that end, so no scripted driver
// voids a lap. The checks on any void are kept, so a regression shows where it happened.
// Pinned so that it is looked at again if the layout or the apron moves.
test('lap voiding: checkpoint 11 still reaches 22 m inside the Basin, and on concrete no handbrake-hauler crawls inside it', () => {
  assert.equal(runs.Classic.reckless.reduce((a, r) => a + r.game.laps.voided, 0), 0);
  const gate = track.gates[11];
  const at = track.points[Math.round(gate.s / track.step)];
  assert.ok(Math.abs(gate.s - 588) < 1 && at.curvature > 1 / 90, 'checkpoint 11 is in the Basin');
  assert.ok(Math.abs(Math.hypot(gate.x1 - at.x, gate.y1 - at.y) - 22) < 0.01, 'it reaches 22 m inside the centreline: 10 m past the curb');
  let voided = 0;
  for (let i = 0; i < 24; i += 1) {
    const game = createGame(track, { handling: power });
    startRun(game, { track, handling: power });
    for (let k = 0; k < i * 2; k += 1) tick(game, NO_INPUT);
    const driver = recklessDriver();
    let wasValid = true;
    let wasNext = 0;
    let inside = 0;
    let speedThere = 0;
    while (game.state !== 'finished' && game.ticks < steps(500)) {
      tick(game, driver(game));
      if (Math.abs(game.trackS - gate.s) < 3) { inside = game.trackInfo.offset; speedThere = game.car.speed; }
      if (wasValid && !game.laps.valid) {
        voided += 1;
        assert.equal(wasNext, 11, 'the missed checkpoint');
        // Sampled within 3 m of the checkpoint, so a little either side of its 22 m reach.
        assert.ok(inside > 20 && inside < 28, `level with it the car was ${inside.toFixed(1)} m inside the centreline, on the grass`);
        assert.ok(speedThere < 12, `and crawling: ${speedThere.toFixed(1)} m/s`);
      }
      wasValid = game.laps.valid;
      wasNext = game.laps.next;
    }
  }
  assert.equal(voided, 0, `${voided} voided laps of about 75 (v0.5.0, on grass: 1 to 8)`);
});

// --- Ghost, records and changing circuit -----------------------------------------------------------
test('the ghost records and replays a Dockyard lap, and belongs to Dockyard alone', () => {
  const { game } = runs.Classic.drift[0];
  assert.ok(game.ghost.replay);
  assert.ok(ghostIsCompatible(game.ghost, game.ghost.replay));
  assert.equal(ghostIsCompatible(createGame(original).ghost, game.ghost.replay), false);
  assert.equal(ghostIsCompatible(createGame(trackById('switchback')).ghost, game.ghost.replay), false);
  const power2 = runs.Power.drift[0].game;
  assert.equal(ghostIsCompatible(power2.ghost, game.ghost.replay), false, 'a Classic lap is never shown to Power');
});

function memory() {
  const data = new Map();
  return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => { data.set(k, String(v)); }, removeItem: (k) => { data.delete(k); } };
}

test('Dockyard keeps its own records per handling, and never touches another circuit\'s', () => {
  const storage = memory();
  const records = createRecords(() => storage);
  const event = (e) => records.handle(e);
  event({ type: 'start', trackId: 'original', runId: 1, mode: 'normal', handling: 'classic' });
  event({ type: 'lap', trackId: 'original', runId: 1, handling: 'classic', valid: true, time: 50 });
  event({ type: 'finish', trackId: 'original', runId: 1, handling: 'classic', completed: 3, score: 5000, bestCombo: 900 });
  const before = structuredClone(records.forTrack('original', 'classic'));
  event({ type: 'start', trackId: 'dockyard', runId: 2, mode: 'normal', handling: 'revised' });
  event({ type: 'lap', trackId: 'dockyard', runId: 2, handling: 'revised', valid: true, time: 33.5 });
  event({ type: 'lap', trackId: 'dockyard', runId: 2, handling: 'revised', valid: false, time: 20 });
  event({ type: 'finish', trackId: 'dockyard', runId: 2, handling: 'revised', completed: 3, score: 7000, bestCombo: 1200 });
  assert.deepEqual({ ...records.forTrack('dockyard', 'revised') }, { score: 7000, fastestLap: 33.5, bestCombo: 1200 });
  assert.deepEqual({ ...records.forTrack('dockyard', 'classic') }, { score: null, fastestLap: null, bestCombo: null });
  assert.deepEqual(records.forTrack('original', 'classic'), before);
  const again = createRecords(() => storage);
  again.handle({ type: 'start', trackId: 'dockyard', runId: 1, mode: 'normal', handling: 'revised' });
  assert.equal(again.forTrack('dockyard', 'revised').score, 7000, 'kept across a reload');
});

// --- Saved records, and a v0.4.0 tab -----------------------------------------------------------
// v0.4.0's record keeper, unedited apart from its two import paths (support/records-e4481a4.mjs),
// stands in for a v0.4.0 tab left open in the same browser. It knows no Dockyard.
test('the v0.4.0 keeper used as the old tab is the released file, unedited apart from its imports', () => {
  const bytes = readFileSync(new URL('support/records-e4481a4.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    .replace("from '../../src/handling.js'", "from './handling.js'").replace("from '../../src/scoring.js'", "from './scoring.js'");
  // SHA-256 of `git show e4481a4:src/records.js`.
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '5c7b415bef84d5862e848100b3301d57b079ab5ecb36d5d201b3e0248a7d99b0');
  assert.equal(V040_RECORDS_KEY, RECORDS_KEY, 'both write the same key and schema');
});

const finishRun = (records, { trackId, handling, runId = 1, laps = [], score = 0, bestCombo = 0 }) => {
  records.handle({ type: 'start', trackId, runId, mode: 'normal', handling });
  for (const time of laps) records.handle({ type: 'lap', trackId, runId, handling, valid: true, time });
  records.handle({ type: 'finish', trackId, runId, handling, completed: 3, score, bestCombo });
};

test('Dockyard records go into the existing key and schema: no new key, nothing written on load', () => {
  const storage = memory();
  const records = createRecords(() => storage);
  assert.equal(storage.data.size, 0);
  finishRun(records, { trackId: 'dockyard', handling: 'classic', laps: [31.25], score: 4200, bestCombo: 800 });
  assert.deepEqual([...storage.data.keys()], [RECORDS_KEY]);
  const saved = JSON.parse(storage.getItem(RECORDS_KEY));
  assert.equal(saved.version, 3);
  assert.deepEqual(saved.tracks.dockyard.classic, { fastestLap: 31.25, scoring: { [LEGACY_SCORING_VERSION]: { score: null, bestCombo: null }, [SCORING_VERSION]: { score: 4200, bestCombo: 800 } } });
  const reloaded = memory();
  reloaded.setItem(RECORDS_KEY, storage.getItem(RECORDS_KEY));
  const writes = [];
  const watched = { getItem: reloaded.getItem, removeItem: reloaded.removeItem, setItem: (k, v) => { writes.push(k); reloaded.setItem(k, v); } };
  const again = createRecords(() => watched);
  again.handle({ type: 'start', trackId: 'dockyard', runId: 1, mode: 'normal', handling: 'classic' });
  assert.deepEqual(again.forTrack('dockyard', 'classic'), { score: 4200, fastestLap: 31.25, bestCombo: 800 });
  assert.deepEqual(writes, [], 'reading never writes');
});

test('every record v0.4.0 saved, in all three keys, shows exactly as v0.4.0 shows it, and Dockyard starts empty', () => {
  const storage = memory();
  storage.setItem(LEGACY_RECORDS_KEY, JSON.stringify({ version: 1, tracks: { original: { score: 15420, fastestLap: 47.31, bestCombo: 0 }, switchback: { score: 9000, fastestLap: 52.08, bestCombo: 700 } } }));
  storage.setItem(V2_RECORDS_KEY, JSON.stringify({ version: 2, tracks: { original: { classic: { score: 99999, fastestLap: 46.9, bestCombo: 2400 }, revised: { score: 21000, fastestLap: 49.5, bestCombo: 6100 } } } }));
  storage.setItem(RECORDS_KEY, JSON.stringify({ version: 3, tracks: {
    original: { revised: { fastestLap: 48.2, scoring: { [SCORING_VERSION]: { score: 30500, bestCombo: 7000 } } } },
    switchback: { classic: { fastestLap: 51.7, scoring: { [SCORING_VERSION]: { score: 11000, bestCombo: 1500 } } } },
  } }));
  const before = new Map(storage.data);
  const old = createV040Records(() => storage);
  const mine = createRecords(() => storage);
  for (const trackId of ['original', 'switchback']) {
    for (const handling of ['classic', 'revised']) {
      assert.deepEqual(mine.forTrack(trackId, handling), old.forTrack(trackId, handling), `${trackId}/${handling}`);
      assert.deepEqual(mine.legacyForTrack(trackId, handling), old.legacyForTrack(trackId, handling), `${trackId}/${handling} legacy`);
    }
  }
  assert.deepEqual(mine.forTrack('original', 'revised'), { score: 30500, fastestLap: 48.2, bestCombo: 7000 }, 'it really read something');
  assert.deepEqual(mine.legacyForTrack('switchback', 'classic'), { score: 9000, bestCombo: 700 });
  for (const handling of ['classic', 'revised']) {
    assert.deepEqual(mine.forTrack('dockyard', handling), { score: null, fastestLap: null, bestCombo: null });
    assert.deepEqual(mine.legacyForTrack('dockyard', handling), { score: null, bestCombo: null });
  }
  assert.deepEqual(storage.data, before, 'nothing was written');
});

test('a v0.4.0 tab writing new bests keeps the Dockyard records, and they still show afterwards', () => {
  const storage = memory();
  const mine = createRecords(() => storage);
  finishRun(mine, { trackId: 'dockyard', handling: 'revised', laps: [30.5], score: 9100, bestCombo: 2100 });
  finishRun(mine, { trackId: 'original', handling: 'classic', runId: 2, laps: [50], score: 3000, bestCombo: 500 });
  const dockyard = structuredClone(JSON.parse(storage.getItem(RECORDS_KEY)).tracks.dockyard);
  // The old tab sets new bests on Original and Switchback, re-reading the key as it does.
  const old = createV040Records(() => storage);
  finishRun(old, { trackId: 'original', handling: 'classic', runId: 3, laps: [45], score: 8000, bestCombo: 900 });
  assert.deepEqual(old.newBests, { score: true, fastestLap: true, bestCombo: true }, 'the old tab really wrote');
  finishRun(old, { trackId: 'switchback', handling: 'revised', runId: 4, laps: [55], score: 6000, bestCombo: 600 });
  const saved = JSON.parse(storage.getItem(RECORDS_KEY));
  assert.deepEqual(saved.tracks.dockyard, dockyard, 'carried through untouched');
  const after = createRecords(() => storage);
  assert.deepEqual(after.forTrack('dockyard', 'revised'), { score: 9100, fastestLap: 30.5, bestCombo: 2100 });
  assert.deepEqual(after.forTrack('original', 'classic'), { score: 8000, fastestLap: 45, bestCombo: 900 });
  assert.deepEqual(after.forTrack('switchback', 'revised'), { score: 6000, fastestLap: 55, bestCombo: 600 });
  // And this version's next write keeps what the old tab saved.
  finishRun(after, { trackId: 'dockyard', handling: 'classic', runId: 5, laps: [33], score: 100, bestCombo: 10 });
  const final = createRecords(() => storage);
  assert.deepEqual(final.forTrack('original', 'classic'), { score: 8000, fastestLap: 45, bestCombo: 900 });
  assert.deepEqual(final.forTrack('switchback', 'revised'), { score: 6000, fastestLap: 55, bestCombo: 600 });
  assert.deepEqual(final.forTrack('dockyard', 'revised'), { score: 9100, fastestLap: 30.5, bestCombo: 2100 });
  assert.deepEqual(final.forTrack('dockyard', 'classic'), { score: 100, fastestLap: 33, bestCombo: 10 });
});

test('a lap or finish event that names another circuit than the run\'s is ignored', () => {
  const storage = memory();
  const records = createRecords(() => storage);
  finishRun(records, { trackId: 'switchback', handling: 'classic', laps: [52], score: 5000, bestCombo: 700 });
  records.handle({ type: 'start', trackId: 'switchback', runId: 9, mode: 'normal', handling: 'classic' });
  records.handle({ type: 'lap', trackId: 'dockyard', runId: 9, handling: 'classic', valid: true, time: 1 });
  records.handle({ type: 'finish', trackId: 'dockyard', runId: 9, handling: 'classic', completed: 3, score: 1e6, bestCombo: 1e5 });
  assert.deepEqual(records.forTrack('dockyard', 'classic'), { score: null, fastestLap: null, bestCombo: null });
  assert.deepEqual(records.forTrack('switchback', 'classic'), { score: 5000, fastestLap: 52, bestCombo: 700 });
});

test('a run on Original is the same tick for tick after a session on Dockyard', () => {
  const fresh = run(() => driftDriver(), classic, 0, original).game;
  const game = createGame();
  startRun(game, { track });
  const warmup = driftDriver();
  for (let i = 0; i < steps(20); i += 1) tick(game, warmup(game));
  startRun(game, { track: original });
  assert.deepEqual({ x: game.car.x, y: game.car.y, heading: game.car.heading }, original.start);
  assert.equal(game.scoring.score, 0);
  assert.equal(game.laps.completed, 0);
  assert.equal(game.ghost.replay, null);
  const driver = driftDriver();
  while (game.state !== 'finished' && game.ticks < steps(500)) tick(game, driver(game));
  assert.equal(game.ticks, fresh.ticks);
  assert.equal(game.scoring.score, fresh.scoring.score);
  assert.equal(game.laps.bestLap, fresh.laps.bestLap);
  assert.deepEqual([game.car.x, game.car.y], [fresh.car.x, fresh.car.y]);
});
