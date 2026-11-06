import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack, projectOnTrack, surfaceAt, gateCrossing, trackDelta } from '../src/track.js';
import { createLaps, updateLaps } from '../src/laps.js';

const track = buildTrack();
const STEP = 1;

function pointAt(s) {
  const n = track.points.length;
  const f = (((s % track.length) + track.length) % track.length) / track.step;
  const i = Math.floor(f);
  const t = f - i;
  const a = track.points[i % n];
  const b = track.points[(i + 1) % n];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Drive along the centreline between two positions (metres along the lap).
function drive(laps, from, to) {
  const direction = Math.sign(to - from);
  const results = [];
  let s = from;
  let p = pointAt(s);
  while (direction > 0 ? s < to : s > to) {
    const nextS = direction > 0 ? Math.min(s + STEP, to) : Math.max(s - STEP, to);
    const q = pointAt(nextS);
    const r = updateLaps(laps, track, p.x, p.y, q.x, q.y, 0.05);
    if (r) results.push(r);
    s = nextS;
    p = q;
  }
  return results;
}

// --- Circuit shape ----------------------------------------------------------
function curvatureRuns() {
  // Consecutive runs of the circuit that bend in one direction, starting from a straight.
  const { points, step } = track;
  const threshold = 1 / 220;
  const startAt = points.findIndex((p) => Math.abs(p.curvature) < threshold);
  const runs = [];
  let current = null;
  for (let k = 0; k < points.length; k += 1) {
    const p = points[(startAt + k) % points.length];
    const side = Math.abs(p.curvature) < threshold ? 0 : Math.sign(p.curvature);
    if (!current || current.side !== side) {
      current = { side, length: 0, turn: 0, tightest: 0 };
      runs.push(current);
    }
    current.length += step;
    current.turn += p.curvature * step;
    current.tightest = Math.max(current.tightest, Math.abs(p.curvature));
  }
  // The scan starts mid-straight, so the first and last runs are the same stretch of road.
  const last = runs[runs.length - 1];
  if (runs.length > 1 && last.side === runs[0].side) {
    runs[0].length += last.length;
    runs[0].turn += last.turn;
    runs[0].tightest = Math.max(runs[0].tightest, last.tightest);
    runs.pop();
  }
  return runs;
}

test('the circuit has a long straight, a sweeper, a hairpin and a transition', () => {
  const runs = curvatureRuns();
  const straights = runs.filter((r) => r.side === 0).sort((a, b) => b.length - a.length);
  assert.ok(straights[0].length > 200, `longest straight ${straights[0].length} m`);

  const corners = runs.filter((r) => r.side !== 0);
  const hairpin = corners.find((r) => Math.abs(r.turn) > 2.6 && 1 / r.tightest < 35);
  assert.ok(hairpin, 'a tight corner turning at least 150 degrees');

  const sweeper = corners.find((r) => Math.abs(r.turn) > 1.8 && 1 / r.tightest > 40);
  assert.ok(sweeper, 'a wide corner turning at least 100 degrees');

  const directTransition = runs.some((r, i) => {
    const a = runs[i];
    const b = runs[(i + 1) % runs.length];
    return a.side !== 0 && b.side === -a.side;
  });
  const shortLink = runs.some((r, i) => {
    const before = runs[(i + runs.length - 1) % runs.length];
    const after = runs[(i + 1) % runs.length];
    return r.side === 0 && r.length < 40 && before.side !== 0 && after.side === -before.side;
  });
  assert.ok(directTransition || shortLink, 'opposite corners linked with little or no straight');
});

test('the road never comes close to another part of itself', () => {
  const { points } = track;
  const clearance = track.halfWidth * 2 + track.curbWidth * 2 + 6;
  for (let i = 0; i < points.length; i += 5) {
    for (let j = i + 40; j < points.length; j += 5) {
      const along = Math.min(points[j].s - points[i].s, track.length - (points[j].s - points[i].s));
      if (along < 80) continue;
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      assert.ok(d > clearance, `s=${points[i].s} and s=${points[j].s} are ${d.toFixed(1)} m apart`);
    }
  }
});

test('surfaces are recognised across the road, curb and grass', () => {
  const p = track.points[0];
  const nx = -p.ty;
  const ny = p.tx;
  const at = (offset) => surfaceAt(track, p.x + nx * offset, p.y + ny * offset);
  assert.equal(at(0), 'road');
  assert.equal(at(track.halfWidth - 0.5), 'road');
  assert.equal(at(-track.halfWidth - 1), 'curb');
  assert.equal(at(track.halfWidth + track.curbWidth + 1), 'grass');
});

test('track progress follows the circuit and wraps correctly', () => {
  const near = projectOnTrack(track, track.points[50].x, track.points[50].y);
  assert.ok(Math.abs(near.s - track.points[50].s) < 0.01);
  assert.ok(near.distance < 0.01);
  assert.equal(trackDelta(track, 10, 15), 5);
  assert.equal(trackDelta(track, track.length - 1, 1), 2);
  assert.equal(trackDelta(track, 1, track.length - 1), -2);
});

test('no gate reaches onto another part of the road', () => {
  const reach = track.halfWidth + track.curbWidth;
  for (const gate of [track.finish, ...track.gates]) {
    for (let f = 0; f <= 1; f += 0.02) {
      const x = gate.x1 + (gate.x2 - gate.x1) * f;
      const y = gate.y1 + (gate.y2 - gate.y1) * f;
      const at = projectOnTrack(track, x, y);
      const along = Math.abs(trackDelta(track, gate.s, at.s));
      if (along > 70) assert.ok(at.distance > reach, `gate at s=${gate.s} touches road at s=${at.s}`);
    }
  }
});

test('gates register direction', () => {
  const g = track.gates[3];
  const a = { x: (g.x1 + g.x2) / 2 - g.tx * 2, y: (g.y1 + g.y2) / 2 - g.ty * 2 };
  const b = { x: (g.x1 + g.x2) / 2 + g.tx * 2, y: (g.y1 + g.y2) / 2 + g.ty * 2 };
  assert.equal(gateCrossing(g, a.x, a.y, b.x, b.y), 1);
  assert.equal(gateCrossing(g, b.x, b.y, a.x, a.y), -1);
  assert.equal(gateCrossing(g, a.x + 500, a.y, b.x + 500, b.y), 0);
});

// --- 10. Lap and checkpoint validation --------------------------------------
test('a full forward circuit counts as one lap', () => {
  const laps = createLaps();
  const r = drive(laps, 6, track.length + 6);
  assert.deepEqual(r, ['lap']);
  assert.equal(laps.completed, 1);
  assert.equal(laps.next, 0);
  assert.ok(laps.bestLap > 0);
});

test('best lap tracks the quickest valid lap', () => {
  const laps = createLaps();
  drive(laps, 6, track.length + 6);
  const first = laps.bestLap;
  laps.lapTime = -30; // a quicker second lap
  drive(laps, 6, track.length + 6);
  assert.equal(laps.completed, 2);
  assert.ok(laps.bestLap < first);
  assert.equal(laps.lastLap, laps.bestLap);
});

test('crossing the line alone is not a lap', () => {
  const laps = createLaps();
  assert.deepEqual(drive(laps, track.length - 10, track.length + 10), []);
  assert.equal(laps.completed, 0);
});

test('oscillating over the line never counts', () => {
  const laps = createLaps();
  for (let i = 0; i < 10; i += 1) {
    drive(laps, track.length + 6, track.length - 6);
    drive(laps, track.length - 6, track.length + 6);
  }
  assert.equal(laps.completed, 0);
  assert.equal(laps.voided, 0, 'nothing happened, so nothing was voided');
});

test('oscillating over the line straight after a lap does not count another', () => {
  const laps = createLaps();
  drive(laps, 6, track.length + 6);
  assert.equal(laps.completed, 1);
  for (let i = 0; i < 5; i += 1) {
    drive(laps, track.length + 6, track.length - 6);
    drive(laps, track.length - 6, track.length + 6);
  }
  assert.equal(laps.completed, 1);
});

test('driving the circuit backward never completes a lap', () => {
  const laps = createLaps();
  const r = drive(laps, track.length * 3, 0);
  assert.equal(laps.completed, 0);
  assert.ok(!r.includes('lap'));
});

test('reversing over the line and driving back the way you came voids rather than farms', () => {
  const laps = createLaps();
  drive(laps, 6, track.length + 6);
  // Back through the last checkpoint, then forward across it and the line again.
  const lastGate = track.gates[track.gates.length - 1].s;
  drive(laps, track.length + 6, lastGate - 10);
  const r = drive(laps, lastGate - 10, track.length + 6);
  assert.equal(laps.completed, 1);
  assert.deepEqual(r, ['void']);
});

function cutAcross(laps, fromS, toS) {
  // Straight line over the grass from one part of the road to another.
  const a = pointAt(fromS);
  const b = pointAt(toS);
  const n = 40;
  for (let i = 0; i < n; i += 1) {
    const f0 = i / n;
    const f1 = (i + 1) / n;
    updateLaps(laps, track, a.x + (b.x - a.x) * f0, a.y + (b.y - a.y) * f0, a.x + (b.x - a.x) * f1, a.y + (b.y - a.y) * f1, 0.05);
  }
}

test('a big shortcut across the infield voids the lap, and timing restarts at the line', () => {
  const laps = createLaps();
  drive(laps, 6, 700);
  cutAcross(laps, 700, 1100);
  const r = drive(laps, 1100, track.length + 6);
  assert.deepEqual(r, ['void']);
  assert.equal(laps.completed, 0);
  assert.equal(laps.bestLap, null);
  assert.ok(laps.lapTime < 2, `timing restarted: ${laps.lapTime}`);
  assert.equal(laps.valid, true);

  // The next honest lap counts normally: the mistake cost a lap, and no backtracking.
  const again = drive(laps, 6, track.length + 6);
  assert.deepEqual(again, ['lap']);
});

test('cutting the hairpin across the grass voids the lap', () => {
  const hairpin = track.points.reduce((a, b) => (Math.abs(b.curvature) > Math.abs(a.curvature) ? b : a));
  const laps = createLaps();
  const entry = hairpin.s - 55;
  const exit = hairpin.s + 55;
  drive(laps, 6, entry);
  cutAcross(laps, entry, exit);
  drive(laps, exit, track.length + 6);
  assert.equal(laps.completed, 0);
  assert.equal(laps.voided, 1);
});

test('running wide on the outside of a corner does not void the lap', () => {
  const laps = createLaps();
  let s = 6;
  let p = pointAt(s);
  const sweeperStart = 170;
  const sweeperEnd = 380;
  let results = [];
  while (s < track.length + 6) {
    const nextS = s + STEP;
    const base = pointAt(nextS);
    const at = track.points[Math.round((nextS % track.length) / track.step) % track.points.length];
    // Swing 30 m out through the sweeper, far off the road on the outside (left of travel).
    const wide = nextS > sweeperStart && nextS < sweeperEnd ? -30 : 0;
    const q = { x: base.x + -at.ty * wide, y: base.y + at.tx * wide };
    const r = updateLaps(laps, track, p.x, p.y, q.x, q.y, 0.05);
    if (r) results = [...results, r];
    s = nextS;
    p = q;
  }
  assert.deepEqual(results, ['lap']);
});

test('skipping most of the circuit cannot complete a lap', () => {
  const laps = createLaps();
  // Past the first checkpoint, then straight back to just before the line.
  drive(laps, 6, track.gates[0].s + 20);
  cutAcross(laps, track.gates[0].s + 20, track.length - 30);
  const r = drive(laps, track.length - 30, track.length + 6);
  assert.deepEqual(r, ['void']);
  assert.equal(laps.completed, 0);
});
