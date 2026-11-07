// The second circuit, Switchback, and choosing between circuits. Original's own shape and
// lap rules stay covered by track-laps.test.mjs, which still builds it with buildTrack().
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TUNING as T } from '../src/tuning.js';
import { TRACKS, DEFAULT_TRACK_ID, trackById, buildTrack, projectOnTrack, surfaceAt, gateCrossing, trackDelta } from '../src/track.js';
import { createLaps, updateLaps } from '../src/laps.js';
import { createGame, startRun, restartRun, returnToMenu, tick, NO_INPUT } from '../src/game.js';
import { ghostIsCompatible } from '../src/ghost.js';
import { gripDriver, driftDriver, recklessDriver } from './support/drivers.mjs';

const original = trackById('original');
const track = trackById('switchback');
const DEG = Math.PI / 180;
const steps = (seconds) => Math.round(seconds / T.simStep);

// --- The choice of circuits ----------------------------------------------------------
test('there are two circuits with stable ids, and Original is the default', () => {
  assert.deepEqual(TRACKS.map((t) => [t.id, t.name]), [['original', 'Original'], ['switchback', 'Switchback']]);
  assert.equal(DEFAULT_TRACK_ID, 'original');
  assert.equal(createGame().track, original);
  assert.equal(trackById('switchback'), track, 'each circuit is built once');
  assert.equal(track.id, 'switchback');
  assert.throws(() => trackById('random'), /Unknown track/);
});

// Rounded so that the last bits of floating point on another platform can't fail it.
function shapeDigest(t) {
  const round = (value) => (typeof value === 'number' ? Number(value.toFixed(6)) : value);
  const shape = { points: t.points, finish: t.finish, gates: t.gates, bounds: t.bounds, start: t.start };
  return createHash('sha256').update(JSON.stringify(shape, (_, value) => round(value))).digest('hex');
}

test("Original's circuit is exactly the v0.1.0 one", () => {
  // Measured from the v0.1.0 tag's src/track.js.
  assert.equal(original.points.length, 644);
  assert.equal(original.length.toFixed(6), '1287.290411');
  assert.deepEqual({ x: original.start.x.toFixed(6), y: original.start.y, heading: original.start.heading }, { x: '-54.003306', y: -110, heading: 0 });
  assert.equal(shapeDigest(original), shapeDigest(buildTrack()));
  assert.equal(shapeDigest(original), '5c8ba903eb825b0f03bfb6f698b398edefaa6da091051bd4e32bb1ae989e3731');
});

// --- Switchback's shape ---------------------------------------------------------------
test('Switchback is a closed circuit of usable length, sampled evenly', () => {
  const { points, length, step } = track;
  assert.ok(length > 1150 && length < 1450, `${length} m, against Original's ${original.length.toFixed(0)} m`);
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    assert.ok([p.x, p.y, p.tx, p.ty, p.curvature].every(Number.isFinite), `point ${i}`);
    assert.ok(Math.abs(Math.hypot(p.tx, p.ty) - 1) < 1e-9, `tangent ${i}`);
    const gap = Math.hypot(q.x - p.x, q.y - p.y);
    assert.ok(Math.abs(gap - step) < 0.05, `${gap} m between points ${i} and ${i + 1}`);
    // Neighbouring tangents agree, so the line never folds back on itself.
    assert.ok(p.tx * q.tx + p.ty * q.ty > Math.cos(15 * DEG), `the line kinks at ${i}`);
  }
  assert.ok(Math.abs(points[points.length - 1].s + step - length) < 1e-6, 'the last point leads back to the first');
});

function segmentsCross(a, b, c, d) {
  const side = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

test('Switchback never crosses itself', () => {
  const { points } = track;
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      assert.equal(segmentsCross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n]), false, `segments ${i} and ${j}`);
    }
  }
});

test('sections of road that are apart along the lap are well apart on the ground', () => {
  const { points } = track;
  // Both roads and their curbs, with at least 20 m of grass between them.
  const clearance = 2 * (track.halfWidth + track.curbWidth) + 20;
  let closest = Infinity;
  for (let i = 0; i < points.length; i += 2) {
    for (let j = i + 2; j < points.length; j += 2) {
      const along = Math.min(points[j].s - points[i].s, track.length - (points[j].s - points[i].s));
      if (along < 80) continue;
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      closest = Math.min(closest, d);
      assert.ok(d > clearance, `s=${points[i].s.toFixed(0)} and s=${points[j].s.toFixed(0)} are ${d.toFixed(1)} m apart`);
    }
  }
  assert.ok(closest < 80, 'the switchbacks do come close to each other, or this checks nothing');
});

// Runs of road that bend one way, as in track-laps.test.mjs.
function curvatureRuns(t) {
  const { points, step } = t;
  const threshold = 1 / 220;
  const startAt = points.findIndex((p) => Math.abs(p.curvature) < threshold);
  const runs = [];
  let current = null;
  for (let k = 0; k < points.length; k += 1) {
    const p = points[(startAt + k) % points.length];
    const side = Math.abs(p.curvature) < threshold ? 0 : Math.sign(p.curvature);
    if (!current || current.side !== side) {
      current = { side, length: 0, turn: 0, tightest: 0, s: p.s };
      runs.push(current);
    }
    current.length += step;
    current.turn += p.curvature * step;
    current.tightest = Math.max(current.tightest, Math.abs(p.curvature));
  }
  const last = runs[runs.length - 1];
  if (runs.length > 1 && last.side === runs[0].side) {
    runs[0].length += last.length;
    runs[0].turn += last.turn;
    runs[0].tightest = Math.max(runs[0].tightest, last.tightest);
    runs.pop();
  }
  return runs;
}
// A corner worth the name: a short wiggle in the spline between corners doesn't count.
const cornersOf = (t) => curvatureRuns(t).filter((r) => r.side !== 0 && Math.abs(r.turn) > 25 * DEG);

test('Switchback has more, smaller corners than Original, linked left into right', () => {
  const corners = cornersOf(track);
  assert.ok(corners.length >= cornersOf(original).length + 4, `${corners.length} corners against ${cornersOf(original).length}`);
  // Medium corners: none of them a sweeper or hairpin turning 150 degrees or more.
  assert.ok(corners.every((c) => Math.abs(c.turn) < 140 * DEG), corners.map((c) => (c.turn / DEG).toFixed(0)).join(', '));
  const medium = corners.filter((c) => 1 / c.tightest >= 30 && 1 / c.tightest <= 60);
  assert.ok(medium.length >= 8, `${medium.length} corners of 30 to 60 m radius`);

  // Opposite corners back to back, with at most a short link of straight between them.
  const runs = curvatureRuns(track).filter((r) => r.side !== 0 ? Math.abs(r.turn) > 25 * DEG : r.length >= 20);
  const linked = runs.filter((r, i) => r.side !== 0 && runs[(i + 1) % runs.length].side === -r.side).length;
  assert.ok(linked >= 6, `${linked} left-right transitions`);
});

test('Switchback has one long straight and one tight corner, and nothing unusable', () => {
  const runs = curvatureRuns(track);
  const straights = runs.filter((r) => r.side === 0).sort((a, b) => b.length - a.length);
  assert.ok(straights[0].length >= 180, `longest straight ${straights[0].length} m`);
  assert.ok(straights[1].length < straights[0].length * 0.5, 'and only one of them');
  assert.ok(straights[0].length <= curvatureRuns(original).filter((r) => r.side === 0).sort((a, b) => b.length - a.length)[0].length,
    'not a faster circuit than Original');

  const tight = cornersOf(track).filter((c) => 1 / c.tightest < 25);
  assert.equal(tight.length, 1, 'exactly one corner tighter than 25 m');
  assert.ok(Math.abs(tight[0].turn) > 100 * DEG, `the tight corner turns ${(tight[0].turn / DEG).toFixed(0)} degrees`);

  const tightest = Math.max(...track.points.map((p) => Math.abs(p.curvature)));
  assert.ok(1 / tightest >= 18, `tightest radius ${(1 / tightest).toFixed(1)} m`);
});

test('the grid is on the road, on the straight, facing along the lap', () => {
  const at = projectOnTrack(track, track.start.x, track.start.y);
  assert.ok(at.distance < 0.01);
  assert.ok(at.s > 0 && at.s < 10, 'just past the line');
  assert.ok(Math.abs(at.curvature) < 1 / 220, 'on a straight');
  const along = Math.cos(track.start.heading) * at.tx + Math.sin(track.start.heading) * at.ty;
  assert.ok(along > 0.9999, 'facing the way the lap goes');
  assert.equal(surfaceAt(track, track.start.x, track.start.y), 'road');
  const b = track.bounds;
  for (const p of track.points) assert.ok(p.x - b.minX >= 48 - 1e-9 && b.maxX - p.x >= 48 - 1e-9 && p.y - b.minY >= 48 - 1e-9 && b.maxY - p.y >= 48 - 1e-9);
});

test('the gates run in lap order and none reaches onto another part of the road', () => {
  const gates = [track.finish, ...track.gates];
  assert.equal(track.finish.s, 0);
  for (let i = 1; i < gates.length; i += 1) assert.ok(gates[i].s > gates[i - 1].s, `gate ${i}`);
  assert.ok(gates[gates.length - 1].s < track.length);
  const reach = track.halfWidth + track.curbWidth;
  for (const gate of gates) {
    for (let f = 0; f <= 1; f += 0.02) {
      const at = projectOnTrack(track, gate.x1 + (gate.x2 - gate.x1) * f, gate.y1 + (gate.y2 - gate.y1) * f);
      if (Math.abs(trackDelta(track, gate.s, at.s)) > 70) assert.ok(at.distance > reach, `gate at s=${gate.s.toFixed(0)} touches road at s=${at.s.toFixed(0)}`);
    }
    // Each one spans the whole road and both curbs.
    const across = Math.hypot(gate.x2 - gate.x1, gate.y2 - gate.y1);
    assert.ok(across >= 2 * reach + 20, `gate at s=${gate.s.toFixed(0)} is ${across.toFixed(0)} m across`);
  }
});

// --- Laps on Switchback, along the centreline -------------------------------------------
function pointAt(s) {
  const n = track.points.length;
  const f = (((s % track.length) + track.length) % track.length) / track.step;
  const i = Math.floor(f);
  const a = track.points[i % n];
  const b = track.points[(i + 1) % n];
  return { x: a.x + (b.x - a.x) * (f - i), y: a.y + (b.y - a.y) * (f - i) };
}

function drive(laps, from, to) {
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
    const f0 = i / 40;
    const f1 = (i + 1) / 40;
    updateLaps(laps, track, a.x + (b.x - a.x) * f0, a.y + (b.y - a.y) * f0, a.x + (b.x - a.x) * f1, a.y + (b.y - a.y) * f1, 0.05);
  }
}

test('a full lap of Switchback counts, and a second one too', () => {
  const laps = createLaps();
  assert.deepEqual(drive(laps, 6, track.length + 6), ['lap']);
  assert.deepEqual(drive(laps, track.length + 6, 2 * track.length + 6), ['lap']);
  assert.equal(laps.completed, 2);
});

test('cutting across the grass on Switchback voids the lap', () => {
  const tight = cornersOf(track).find((c) => 1 / c.tightest < 25);
  const switchbacks = cornersOf(track).filter((c) => 1 / c.tightest >= 30 && 1 / c.tightest <= 40);
  const shortcuts = {
    // Straight down the diagonal, missing the whole staircase of switchbacks.
    'the switchbacks': [switchbacks[0].s, switchbacks[switchbacks.length - 1].s + switchbacks[switchbacks.length - 1].length],
    'the tight corner': [tight.s - 10, tight.s + tight.length + 10],
    'the infield': [track.gates[2].s + 10, track.gates[12].s - 10],
  };
  for (const [name, [from, to]] of Object.entries(shortcuts)) {
    const laps = createLaps();
    drive(laps, 6, from);
    cutAcross(laps, from, to);
    assert.deepEqual(drive(laps, to, track.length + 6), ['void'], name);
    assert.equal(laps.completed, 0, name);
  }
});

test('running wide on the outside of the switchbacks does not void the lap', () => {
  // A wide line through every corner, as far out as the outside of the gates allows.
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

test('driving Switchback backward never completes a lap', () => {
  const laps = createLaps();
  const results = [];
  let p = pointAt(3 * track.length);
  for (let s = 3 * track.length - 1; s >= 0; s -= 1) {
    const q = pointAt(s);
    const r = updateLaps(laps, track, p.x, p.y, q.x, q.y, 0.05);
    if (r) results.push(r);
    p = q;
  }
  assert.equal(laps.completed, 0);
  assert.ok(!results.includes('lap'));
});

// --- The real car on Switchback ---------------------------------------------------------
function run(makeDriver, { offset = 0, on = track } = {}) {
  const game = createGame();
  startRun(game, { track: on });
  for (let i = 0; i < offset; i += 1) tick(game, NO_INPUT);
  const driver = makeDriver();
  const seen = { wallHits: 0, grass: 0 };
  while (game.state !== 'finished' && game.ticks < steps(500)) {
    tick(game, driver(game));
    if (game.lastImpact > 0) seen.wallHits += 1;
    if (game.car.surface === 'grass') seen.grass += T.simStep;
  }
  return { game, ...seen };
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const OFFSETS = [0, 2, 4, 6, 8, 10];
const sample = (makeDriver) => OFFSETS.map((offset) => run(makeDriver, { offset }));
const grip = sample(() => gripDriver());
const drift = sample(() => driftDriver());
const reckless = sample(() => recklessDriver());

test('a tidy grip driver laps Switchback cleanly: every lap counts, no wall, no grass', () => {
  for (const r of grip) {
    assert.equal(r.game.state, 'finished');
    assert.equal(r.game.laps.completed, T.runLaps);
    assert.equal(r.game.laps.voided, 0);
    assert.equal(r.wallHits, 0);
    assert.ok(r.grass < 1, `${r.grass.toFixed(1)} s on the grass`);
  }
});

test('a drifting driver gets round Switchback, chaining combos to the top multiplier', () => {
  for (const r of drift) {
    assert.equal(r.game.state, 'finished');
    assert.equal(r.game.laps.voided, 0);
    assert.equal(r.wallHits, 0);
    assert.ok(r.game.scoring.score > 2000, `score ${r.game.scoring.score}`);
  }
  assert.equal(median(drift.map((r) => r.game.scoring.bestMultiplier)), 3);
  assert.ok(median(drift.map((r) => r.game.scoring.spinouts)) <= 6, 'spins stay occasional');
});

test('on Switchback too, controlled drifting out-scores hauling on the handbrake', () => {
  const score = (runs) => median(runs.map((r) => r.game.scoring.score));
  assert.ok(score(drift) > score(reckless), `drift ${score(drift)} against reckless ${score(reckless)}`);
  assert.ok(reckless.every((r) => r.wallHits === 0), 'even the reckless driver never reaches the wall');
});

// --- Changing circuits ------------------------------------------------------------------
test('the ghost records and replays a Switchback lap, and belongs to Switchback alone', () => {
  const { game } = drift[0];
  assert.ok(game.ghost.replay, 'a valid lap became the ghost');
  assert.ok(ghostIsCompatible(game.ghost, game.ghost.replay));
  const onOriginal = createGame();
  assert.notEqual(onOriginal.ghost.track, game.ghost.track, 'the circuits have different identities');
  assert.equal(ghostIsCompatible(onOriginal.ghost, game.ghost.replay), false, 'a Switchback lap is never shown on Original');
  // Every recorded pose is on or near Switchback's road.
  const { x, y } = game.ghost.replay;
  for (let i = 0; i < x.length; i += 5) assert.ok(projectOnTrack(track, x[i], y[i]).distance < 30, `pose ${i}`);
});

test('changing circuit starts a fresh session with nothing carried over', () => {
  const game = createGame();
  startRun(game, { track });
  const driver = driftDriver();
  while ((game.laps.completed < 1 || !game.scoring.combo) && game.ticks < steps(200)) tick(game, driver(game));
  assert.ok(game.ghost.replay && game.scoring.score + game.scoring.combo.points > 0);

  startRun(game, { track: original });
  assert.equal(game.track, original);
  assert.equal(game.state, 'ready');
  assert.deepEqual({ x: game.car.x, y: game.car.y, heading: game.car.heading }, original.start);
  assert.equal(game.car.speed, 0);
  assert.equal(game.scoring.score, 0);
  assert.equal(game.scoring.combo, null);
  assert.equal(game.laps.completed, 0);
  assert.equal(game.laps.next, 0);
  assert.equal(game.laps.bestLap, null);
  assert.equal(game.runTime, 0);
  assert.equal(game.progress, 0);
  assert.equal(game.ghost.replay, null);
  assert.equal(game.ghost.recording, null);
  assert.ok(Math.abs(game.trackS - projectOnTrack(original, original.start.x, original.start.y).s) < 1e-9);
});

test('restart and the menu keep the circuit, and a plain startRun stays on it', () => {
  const game = createGame();
  startRun(game, { track });
  for (let i = 0; i < steps(3); i += 1) tick(game, { ...NO_INPUT, up: true });
  restartRun(game);
  assert.equal(game.track, track);
  assert.deepEqual({ x: game.car.x, y: game.car.y, heading: game.car.heading }, track.start);
  returnToMenu(game);
  assert.equal(game.track, track);
  assert.equal(game.state, 'menu');
  startRun(game);
  assert.equal(game.track, track);
  startRun(game, { track: original, ghost: false });
  assert.equal(game.track, original);
  assert.equal(game.ghost, null);
});

test('a run on Original is the same tick for tick after a session on Switchback', () => {
  const fresh = run(() => driftDriver(), { on: original }).game;
  const game = createGame();
  startRun(game, { track });
  const warmup = driftDriver();
  for (let i = 0; i < steps(20); i += 1) tick(game, warmup(game));
  startRun(game, { track: original });
  const driver = driftDriver();
  while (game.state !== 'finished' && game.ticks < steps(500)) tick(game, driver(game));
  assert.equal(game.ticks, fresh.ticks);
  assert.equal(game.scoring.score, fresh.scoring.score);
  assert.equal(game.laps.bestLap, fresh.laps.bestLap);
  assert.deepEqual([game.car.x, game.car.y], [fresh.car.x, fresh.car.y]);
});
