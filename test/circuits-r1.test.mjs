// Mini Drifters v0.9.0 R1 — Four-Circuit Production Integration qualification tests.
// Covers Runway 27, Redline Mesa, Headland Run, and Nightshift Viaduct:
//   - Locked accepted R0 geometry and collider digests
//   - Curve health, checkpoints, shortcut and repeated-ground exploit resistance
//   - SCENERY_RULES clearance, gaps, gate clearance, connected open ground and collision physics
//   - Classic and Power driving behavior, recovery, switching and frame-rate determinism
//   - Records, saved reference ghosts, v0.8.0 save compatibility and R0 isolation
//   - Analytics category contract, publishing hygiene and performance budgets
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { TUNING as T } from '../src/tuning.js';
import { TRACKS, DEFAULT_TRACK_ID, trackById, buildTrack, projectOnTrack, surfaceAt, trackDelta } from '../src/track.js';
import { buildScenery, sceneryFor, SCENERY_RULES, KINDS, isSolidKind, clearanceOf } from '../src/scenery.js';
import { obstaclesFor, collidersFromScenery, resolveObstacles } from '../src/obstacles.js';
import { createLaps, updateLaps } from '../src/laps.js';
import { createGame, startRun, restartRun, tick, advance, countedScore, NO_INPUT } from '../src/game.js';
import { HANDLING_IDS, handlingById } from '../src/handling.js';
import { ghostIsCompatible } from '../src/ghost.js';
import { createRecords, RECORDS_KEY } from '../src/records.js';
import { createGhostStore, expectedIdentity, GHOST_STORE_KEY, GHOST_COMPATIBILITY } from '../src/ghost-store.js';
import { createReferenceGhosts } from '../src/reference-ghost.js';
import { categoryOf } from '../src/analytics.js';
import { SCORING_VERSION } from '../src/scoring.js';
import { gripDriver, driftDriver, recklessDriver } from './support/drivers.mjs';
import { onLine, chordControl } from './support/environment-drivers.mjs';
import { cutterDriver } from './support/exploit-drivers.mjs';

const NEW_IDS = Object.freeze(['runway-27', 'redline-mesa', 'headland-run', 'nightshift-viaduct']);
const DEG = Math.PI / 180;
const steps = (s) => Math.round(s / T.simStep);
const classic = handlingById('classic');
const power = handlingById('revised');

// Locked hashes from accepted v0.9.0-r0 human-approved geometries and colliders.
const LOCKED_R0 = Object.freeze({
  'runway-27': {
    name: 'Runway 27',
    points: 614,
    length: '1228.107253',
    colliders: 21,
    shapeDigest: 'fa84d13fcdafa3e89aaa33d1606009fb250e16d9e57c94bf99763c203c4f5d32',
    colliderDigest: '2241a35a9a6102273bd54ee78720d1ea5d26b30a8e14a6008a9f1f708b259311',
  },
  'redline-mesa': {
    name: 'Redline Mesa',
    points: 547,
    length: '1094.503624',
    colliders: 24,
    shapeDigest: '7eb1ece6802674c60f9ca5ed5ebfc691acec343f523e2e668ae0c8cf3991ed60',
    colliderDigest: '8e5a491b923dc395bf126528bc0e3908e3de346517cc90dfaba3c7995124510a',
  },
  'headland-run': {
    name: 'Headland Run',
    points: 582,
    length: '1163.964351',
    colliders: 40,
    shapeDigest: 'a0daf95787ff136025c9ded898d677df26e548c07be275f1fd6a3112f43ad9bd',
    colliderDigest: 'a004cd37bff0a7a5faaff0a3854857a98db566343752b7a386b5abf281b83ba8',
  },
  'nightshift-viaduct': {
    name: 'Nightshift Viaduct',
    points: 535,
    length: '1070.478565',
    colliders: 34,
    shapeDigest: 'd712b09a061642fc105fb749f394622655c10419574724b11807c7c58cc455d9',
    colliderDigest: '081c23832660052bff534167a6367c341577b8c2f17afdba073fc647c5a52d72',
  },
});

const round6 = (_, value) => (typeof value === 'number' ? Number(value.toFixed(6)) : value);
const sha = (data) => createHash('sha256').update(JSON.stringify(data, round6)).digest('hex');

function shapeDigest(track) {
  return sha({ points: track.points, finish: track.finish, gates: track.gates, bounds: track.bounds, start: track.start });
}

function pointAt(track, s) {
  const n = track.points.length;
  const f = (((s % track.length) + track.length) % track.length) / track.step;
  const i = Math.floor(f);
  const a = track.points[i % n];
  const b = track.points[(i + 1) % n];
  return { x: a.x + (b.x - a.x) * (f - i), y: a.y + (b.y - a.y) * (f - i) };
}

function driveLine(track, laps, from, to) {
  const results = [];
  let p = pointAt(track, from);
  for (let s = from; s < to;) {
    const next = Math.min(s + 1, to);
    const q = pointAt(track, next);
    const r = updateLaps(laps, track, p.x, p.y, q.x, q.y, 0.05);
    if (r) results.push(r);
    s = next;
    p = q;
  }
  return results;
}

function cutAcross(track, laps, fromS, toS) {
  const a = pointAt(track, fromS);
  const b = pointAt(track, toS);
  for (let i = 0; i < 40; i += 1) {
    updateLaps(
      laps, track,
      a.x + ((b.x - a.x) * i) / 40, a.y + ((b.y - a.y) * i) / 40,
      a.x + ((b.x - a.x) * (i + 1)) / 40, a.y + ((b.y - a.y) * (i + 1)) / 40,
      0.05,
    );
  }
}

function ptSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function colliderSignedDist(c, px, py) {
  if (c.shape === 'capsule') return ptSegDist(px, py, c.ax, c.ay, c.bx, c.by) - c.radius;
  if (c.shape === 'poly') {
    let best = -Infinity;
    let minEdge = Infinity;
    for (let i = 0; i < c.points.length; i += 1) {
      const [ax, ay] = c.points[i];
      const [bx, by] = c.points[(i + 1) % c.points.length];
      const ex = bx - ax;
      const ey = by - ay;
      const len = Math.hypot(ex, ey) || 1;
      best = Math.max(best, (px - ax) * (ey / len) + (py - ay) * (-ex / len));
      minEdge = Math.min(minEdge, ptSegDist(px, py, ax, ay, bx, by));
    }
    return best <= 0 ? best : minEdge;
  }
  const dx = Math.max(c.minX - px, 0, px - c.maxX);
  const dy = Math.max(c.minY - py, 0, py - c.maxY);
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return -Math.min(px - c.minX, c.maxX - px, py - c.minY, c.maxY - py);
}

function sampleCollider(c, step = 1.2) {
  const out = [];
  const edge = (ax, ay, bx, by, r = 0) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let i = 0; i <= n; i += 1) out.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, r]);
  };
  if (c.shape === 'capsule') edge(c.ax, c.ay, c.bx, c.by, c.radius);
  else if (c.shape === 'poly') c.points.forEach((p, i) => edge(...p, ...c.points[(i + 1) % c.points.length]));
  else {
    edge(c.minX, c.minY, c.maxX, c.minY);
    edge(c.maxX, c.minY, c.maxX, c.maxY);
    edge(c.maxX, c.maxY, c.minX, c.maxY);
    edge(c.minX, c.maxY, c.minX, c.minY);
  }
  return out;
}

function colliderGap(a, b) {
  const bx = Math.max(b.minX - a.maxX, a.minX - b.maxX, 0);
  const by = Math.max(b.minY - a.maxY, a.minY - b.maxY, 0);
  if (Math.hypot(bx, by) > SCENERY_RULES.gap + 2) return SCENERY_RULES.gap + 2;
  let best = Infinity;
  for (const [x, y, r] of sampleCollider(a)) best = Math.min(best, colliderSignedDist(b, x, y) - r);
  for (const [x, y, r] of sampleCollider(b)) best = Math.min(best, colliderSignedDist(a, x, y) - r);
  return Math.max(0, best);
}

// --- 1. Catalog and locked R0 geometry preservation ----------------------------------------
test('production catalog holds seven unique circuits with locked accepted R0 geometries', () => {
  assert.equal(TRACKS.length, 7);
  assert.equal(DEFAULT_TRACK_ID, 'original');
  assert.equal(new Set(TRACKS.map((t) => t.id)).size, 7);
  assert.ok(TRACKS.every((t) => !t.id.startsWith('exp-')), 'no experimental id prefix in production');

  for (const id of NEW_IDS) {
    const expected = LOCKED_R0[id];
    const track = trackById(id);
    const colliders = obstaclesFor(track);
    assert.equal(track.name, expected.name);
    assert.equal(track.apron, 'grass');
    assert.equal(track.points.length, expected.points);
    assert.equal(track.length.toFixed(6), expected.length);
    assert.equal(shapeDigest(track), expected.shapeDigest, `${id} shape must match locked R0 geometry`);
    assert.equal(colliders.length, expected.colliders);
    assert.equal(sha(colliders), expected.colliderDigest, `${id} colliders must match locked R0 scenery`);
  }
});

// --- 2. Geometry, checkpoints, shortcuts and exploit resistance ----------------------------
for (const id of NEW_IDS) {
  const track = trackById(id);

  test(`${id}: closed evenly-sampled circuit, no kinks or self-crossings, clean start and 16 ordered gates`, () => {
    const { points, length, step } = track;
    const n = points.length;
    assert.ok(length > 900 && length < 1450, `${length} m`);
    for (let i = 0; i < n; i += 1) {
      const p = points[i];
      const q = points[(i + 1) % n];
      assert.ok([p.x, p.y, p.tx, p.ty, p.curvature].every(Number.isFinite), `point ${i}`);
      assert.ok(Math.abs(Math.hypot(p.tx, p.ty) - 1) < 1e-9, `tangent ${i}`);
      assert.ok(Math.abs(Math.hypot(q.x - p.x, q.y - p.y) - step) < 0.05, `spacing ${i}`);
      assert.ok(p.tx * q.tx + p.ty * q.ty > Math.cos(15 * DEG), `kink at ${i}`);
    }
    const side = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    const cross = (a, b, c, d) => side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 2; j < n; j += 1) {
        if (i === 0 && j === n - 1) continue;
        assert.equal(cross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n]), false, `segments ${i} & ${j}`);
      }
    }
    // Separate road sections keep >= 20 m of grass between curbs.
    const minSep = 2 * (track.halfWidth + track.curbWidth) + 20;
    for (let i = 0; i < n; i += 2) {
      for (let j = i + 2; j < n; j += 2) {
        const along = Math.min(points[j].s - points[i].s, length - (points[j].s - points[i].s));
        if (along < 80) continue;
        const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        assert.ok(d > minSep, `sections at s=${points[i].s.toFixed(0)} and s=${points[j].s.toFixed(0)} are ${d.toFixed(1)} m apart`);
      }
    }
    // Grid on a straight facing the lap, bounds 48 m beyond road.
    const at = projectOnTrack(track, track.start.x, track.start.y);
    assert.ok(at.distance < 0.01 && at.s > 0 && at.s < 10);
    assert.ok(Math.abs(at.curvature) < 1 / 220, 'grid on straight');
    assert.ok(Math.cos(track.start.heading) * at.tx + Math.sin(track.start.heading) * at.ty > 0.9999);
    assert.equal(surfaceAt(track, track.start.x, track.start.y), 'road');
    const b = track.bounds;
    for (const p of points) {
      assert.ok(p.x - b.minX >= 48 - 1e-9 && b.maxX - p.x >= 48 - 1e-9 && p.y - b.minY >= 48 - 1e-9 && b.maxY - p.y >= 48 - 1e-9);
    }
    // 16 ordered checkpoints spanning road + curbs without touching distant road.
    const gates = [track.finish, ...track.gates];
    assert.equal(track.gates.length, 16);
    assert.equal(track.finish.s, 0);
    const reach = track.halfWidth + track.curbWidth;
    for (let i = 1; i < gates.length; i += 1) assert.ok(gates[i].s > gates[i - 1].s, `gate ${i}`);
    for (const gate of gates) {
      for (let f = 0; f <= 1; f += 0.02) {
        const gAt = projectOnTrack(track, gate.x1 + (gate.x2 - gate.x1) * f, gate.y1 + (gate.y2 - gate.y1) * f);
        if (Math.abs(trackDelta(track, gate.s, gAt.s)) > 70) assert.ok(gAt.distance > reach, `gate at s=${gate.s.toFixed(0)} touches road`);
      }
      assert.ok(Math.hypot(gate.x2 - gate.x1, gate.y2 - gate.y1) >= 2 * reach + 20);
    }
  });

  test(`${id}: full laps count, 16 m wide recovery holds, backward never counts, and straight-line shortcuts fail`, () => {
    const laps = createLaps();
    assert.deepEqual(driveLine(track, laps, 6, track.length + 6), ['lap']);
    assert.deepEqual(driveLine(track, laps, track.length + 6, 2 * track.length + 6), ['lap']);
    assert.equal(laps.completed, 2);

    // 16 m outside every corner stays valid.
    const wide = createLaps();
    const wideRes = [];
    let prev = pointAt(track, 6);
    for (let s = 7; s <= track.length + 6; s += 1) {
      const at = track.points[Math.round((s % track.length) / track.step) % track.points.length];
      const out = Math.abs(at.curvature) > 1 / 220 ? -Math.sign(at.curvature) * 16 : 0;
      const base = pointAt(track, s);
      const q = { x: base.x - at.ty * out, y: base.y + at.tx * out };
      const r = updateLaps(wide, track, prev.x, prev.y, q.x, q.y, 0.05);
      if (r) wideRes.push(r);
      prev = q;
    }
    assert.deepEqual(wideRes, ['lap']);

    // Driving backward never completes a lap.
    const rev = createLaps();
    prev = pointAt(track, 3 * track.length);
    for (let s = 3 * track.length - 1; s >= 0; s -= 1) {
      const q = pointAt(track, s);
      assert.notEqual(updateLaps(rev, track, prev.x, prev.y, q.x, q.y, 0.05), 'lap');
      prev = q;
    }
    assert.equal(rev.completed, 0);

    // Real-physics chord shortcut check: the highest-ratio straight-line cuts never beat a clean lap in Classic or Power.
    const reach = track.halfWidth + track.curbWidth;
    const cuts = [];
    for (let from = 15; from < track.length - 25; from += 25) {
      for (let to = from + 35; to < track.length - 5; to += 25) {
        const a = pointAt(track, from);
        const b = pointAt(track, to);
        const chord = Math.hypot(b.x - a.x, b.y - a.y);
        const saving = to - from - chord;
        if (saving < 14) continue;
        const testLaps = createLaps();
        driveLine(track, testLaps, 6, from);
        cutAcross(track, testLaps, from, to);
        if (driveLine(track, testLaps, to, track.length + 6)[0] !== 'lap') continue;
        let off = 0;
        for (let i = 0; i <= 40; i += 1) {
          if (projectOnTrack(track, a.x + ((b.x - a.x) * i) / 40, a.y + ((b.y - a.y) * i) / 40).distance > reach) off += chord / 40;
        }
        cuts.push({ from, to, saving, ratio: saving / Math.max(1, off) });
      }
    }
    cuts.sort((a, b) => b.ratio - a.ratio);
    const worst = cuts.slice(0, 3);
    for (const handling of [classic, power]) {
      const g0 = createGame(track, { handling });
      startRun(g0, { track, handling });
      const d0 = gripDriver();
      while (g0.state !== 'finished' && g0.ticks < steps(250)) tick(g0, d0(g0));
      const baseLap = g0.laps.bestLap;
      for (const c of worst) {
        const g = createGame(track, { handling });
        startRun(g, { track, handling });
        const d = onLine(() => gripDriver(), chordControl(track, c.from, c.to));
        while (g.state !== 'finished' && g.ticks < steps(220)) tick(g, d(g));
        if (g.laps.bestLap) {
          assert.ok(g.laps.bestLap >= baseLap - 0.1, `${id} ${handling.name}: cut ${c.from}->${c.to} beat road (${g.laps.bestLap.toFixed(2)}s vs ${baseLap.toFixed(2)}s)`);
        }
      }
    }
  });

  test(`${id}: repeated backward infield cutting and donut farming cannot farm unbounded drift score`, () => {
    // 1. Repeated backward infield cutting cannot farm new ground past the 4 m slack.
    let bestSep = Infinity;
    let pair = [0, 200];
    for (let i = 0; i < track.points.length; i += 4) {
      for (let j = i + 4; j < track.points.length; j += 4) {
        const along = Math.min(track.points[j].s - track.points[i].s, track.length - (track.points[j].s - track.points[i].s));
        if (along < 80) continue;
        const d = Math.hypot(track.points[i].x - track.points[j].x, track.points[i].y - track.points[j].y);
        if (d < bestSep) { bestSep = d; pair = [track.points[i].s, track.points[j].s]; }
      }
    }
    const [sLow, sHigh] = pair[0] < pair[1] ? pair : [pair[1], pair[0]];
    const fg = createGame(track, { handling: classic });
    startRun(fg, { track, handling: classic });
    const fd = cutterDriver(gripDriver(), { from: sHigh, to: sLow, times: 10 });
    let worstLead = -Infinity;
    while (fg.ticks < steps(320) && !(fd.cuts() === 10 && !fd.cutting())) {
      tick(fg, fd(fg));
      worstLead = Math.max(worstLead, fg.credited - fg.reached);
    }
    assert.ok(worstLead <= 4.01, `${id}: backward farming lead ${worstLead.toFixed(2)} m`);

    // 2. Repeated donut circling on Power cannot accumulate unbounded drift points.
    const game = createGame(track, { handling: power });
    startRun(game, { track, handling: power });
    for (let i = 0; i < steps(1.5); i += 1) tick(game, { ...NO_INPUT, up: true });
    for (let i = 0; i < steps(15); i += 1) tick(game, { ...NO_INPUT, up: true, left: true, handbrake: i % 120 < 20 });
    const scoreAt15 = countedScore(game) + (game.scoring.combo?.points ?? 0);
    for (let i = 0; i < steps(15); i += 1) tick(game, { ...NO_INPUT, up: true, left: true, handbrake: i % 120 < 20 });
    const scoreAt30 = countedScore(game) + (game.scoring.combo?.points ?? 0);
    assert.ok(scoreAt30 - scoreAt15 < 250, `donut farming grew score by ${scoreAt30 - scoreAt15} on ${id}`);
  });
}

// --- 3. Scenery clearance, collision physics & connected open ground -----------------------
const sceneryDrawSource = readFileSync(new URL('../src/scenery-draw.js', import.meta.url), 'utf8');
const drawnKindsMatch = sceneryDrawSource.match(/DRAWN_KINDS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
const DRAWN_KINDS = [...drawnKindsMatch[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);

for (const id of NEW_IDS) {
  const track = trackById(id);
  const scenery = sceneryFor(track);
  const colliders = obstaclesFor(track);

  test(`${id}: scenery meets SCENERY_RULES (24 m clearance, 7 m gap or touch, clear gates, connected ground, drawn kinds)`, () => {
    assert.ok(scenery && scenery.props.length > 50);
    assert.ok(colliders.length >= 15);
    for (const p of scenery.props) {
      assert.ok(KINDS[p.kind], `unknown kind ${p.kind}`);
      assert.ok(DRAWN_KINDS.includes(p.kind), `kind ${p.kind} must be in DRAWN_KINDS`);
    }
    const b = track.bounds;
    const reachableSources = new Set(colliders.map((c) => c.source));
    for (const idx of reachableSources) {
      const prop = scenery.props[idx];
      assert.ok(isSolidKind(prop.kind));
      const clr = clearanceOf(track, prop);
      assert.ok(clr >= SCENERY_RULES.solidClearance, `${id} prop #${idx} (${prop.kind}) clearance ${clr.toFixed(2)} < 24`);
    }
    // Wall gaps and pairwise gaps (skipping capsules belonging to the same source prop).
    for (let i = 0; i < colliders.length; i += 1) {
      const a = colliders[i];
      for (const gap of [a.minX - b.minX, b.maxX - a.maxX, a.minY - b.minY, b.maxY - a.maxY]) {
        assert.ok(gap <= 1e-6 || gap >= SCENERY_RULES.gap, `${id} collider #${i} (${a.kind}) wall gap ${gap.toFixed(2)}`);
      }
      for (let j = i + 1; j < colliders.length; j += 1) {
        const c = colliders[j];
        if (a.source === c.source) continue;
        const g = colliderGap(a, c);
        assert.ok(g <= 1e-6 || g >= SCENERY_RULES.gap, `${id} colliders #${i}(${a.kind}) & #${j}(${c.kind}) gap ${g.toFixed(2)}`);
      }
    }
    // Checkpoint gates clear of solids across road + recovery width.
    const R = T.carRadius + 0.4;
    for (const g of [track.finish, ...track.gates]) {
      const len = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
      for (let d = 0; d <= len; d += 1.0) {
        const x = g.x1 + ((g.x2 - g.x1) * d) / len;
        const y = g.y1 + ((g.y2 - g.y1) * d) / len;
        if (projectOnTrack(track, x, y).distance > 22) continue;
        for (const c of colliders) {
          assert.ok(colliderSignedDist(c, x, y) >= R, `${id} gate s=${g.s.toFixed(0)} blocked by ${c.kind}`);
        }
      }
    }
    // Single connected open ground (4 m grid flood-fill).
    const cell = 4;
    const cols = Math.floor((b.maxX - b.minX) / cell);
    const rows = Math.floor((b.maxY - b.minY) / cell);
    const open = new Uint8Array(cols * rows);
    let openCount = 0;
    let seedIdx = -1;
    for (let ry = 0; ry < rows; ry += 1) {
      const wy = b.minY + (ry + 0.5) * cell;
      for (let rx = 0; rx < cols; rx += 1) {
        const wx = b.minX + (rx + 0.5) * cell;
        if (wx - b.minX < T.carRadius || b.maxX - wx < T.carRadius || wy - b.minY < T.carRadius || b.maxY - wy < T.carRadius) continue;
        if (colliders.some((c) => colliderSignedDist(c, wx, wy) < T.carRadius)) continue;
        const idx = ry * cols + rx;
        open[idx] = 1;
        openCount += 1;
        if (seedIdx < 0 && Math.hypot(wx - track.start.x, wy - track.start.y) < 10) seedIdx = idx;
      }
    }
    assert.ok(seedIdx >= 0, `${id} start must sit in open ground`);
    const seen = new Uint8Array(cols * rows);
    const queue = [seedIdx];
    seen[seedIdx] = 1;
    let reached = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const idx = queue[head];
      reached += 1;
      const rx = idx % cols;
      const ry = (idx - rx) / cols;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = rx + dx;
        const ny = ry + dy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        const nIdx = ny * cols + nx;
        if (open[nIdx] && !seen[nIdx]) { seen[nIdx] = 1; queue.push(nIdx); }
      }
    }
    assert.equal(reached, openCount, `${id} has trapped pocket(s): ${openCount - reached} unreachable open cells`);
  });

  test(`${id}: direct solid collision stops cleanly without tunneling and fixed-step simulation is frame-rate independent`, () => {
    const target = colliders.find((c) => c.shape !== 'capsule' || c.radius >= 1.5) ?? colliders[0];
    const cx = (target.minX + target.maxX) / 2;
    const cy = (target.minY + target.maxY) / 2;
    const car = { x: target.minX - 18, y: cy, vx: 28, vy: 0, heading: 0, yawRate: 0 };
    let impacted = false;
    for (let i = 0; i < 120; i += 1) {
      const ax = car.x;
      const ay = car.y;
      car.x += car.vx * T.simStep;
      car.y += car.vy * T.simStep;
      const hit = resolveObstacles(car, [target], ax, ay);
      if (hit && hit.impact > 5) impacted = true;
      assert.ok(car.x < cx, `${id} car tunneled past ${target.kind}`);
    }
    assert.equal(impacted, true, `${id} expected solid impact on ${target.kind}`);

    // Frame-rate independence: 30 Hz vs 60 Hz vs 120 Hz advance for 5 s produces identical state.
    const finalAt = (hz) => {
      const g = createGame(track, { handling: power });
      startRun(g, { track, handling: power });
      const dt = 1 / hz;
      for (let i = 0; i < hz * 5; i += 1) advance(g, dt, { ...NO_INPUT, up: true, right: i >= hz * 2 });
      return [g.ticks, g.car.x, g.car.y, g.car.heading, g.car.speed];
    };
    const ref = finalAt(120);
    assert.deepEqual(finalAt(60), ref, `${id} 60 Hz matches 120 Hz`);
    assert.deepEqual(finalAt(30), ref, `${id} 30 Hz matches 120 Hz`);
  });
}

// --- 4. Both handling modes: Classic and Power --------------------------------------------
function runSim(track, makeDriver, handling) {
  const game = createGame(track, { handling });
  startRun(game, { track, handling });
  const driver = makeDriver();
  let hits = 0;
  while (game.state !== 'finished' && game.ticks < steps(500)) {
    tick(game, driver(game));
    if (game.lastImpact > 0 || (game.lastContact && game.lastContact.tick === game.ticks)) hits += 1;
  }
  return { game, hits };
}

for (const id of NEW_IDS) {
  const track = trackById(id);
  for (const [label, handling] of [['Classic', classic], ['Power', power]]) {
    test(`${id} (${label}): grip completes 3 clean laps, drift banks combos and outscores reckless`, () => {
      const grip = runSim(track, () => gripDriver(), handling);
      assert.equal(grip.game.state, 'finished');
      assert.equal(grip.game.laps.completed, T.runLaps);
      assert.equal(grip.game.laps.voided, 0);
      assert.equal(grip.hits, 0);
      assert.ok(grip.game.laps.bestLap > 20 && grip.game.laps.bestLap < 65, `bestLap=${grip.game.laps.bestLap}`);

      const drift = runSim(track, () => driftDriver(), handling);
      assert.equal(drift.game.state, 'finished');
      assert.equal(drift.game.laps.completed, T.runLaps);
      assert.equal(drift.game.laps.voided, 0);
      assert.ok(countedScore(drift.game) > 1500, `score=${countedScore(drift.game)}`);
      assert.ok(drift.game.scoring.bestMultiplier >= 2, `mult=${drift.game.scoring.bestMultiplier}`);
      assert.ok(drift.game.ghost.replay && ghostIsCompatible(drift.game.ghost, drift.game.ghost.replay));

      const reckless = runSim(track, () => recklessDriver(), handling);
      assert.equal(reckless.game.state, 'finished');
      assert.ok(countedScore(drift.game) > countedScore(reckless.game),
        `drift ${countedScore(drift.game)} <= reckless ${countedScore(reckless.game)}`);
    });
  }
}

test('switching across all 7 circuits resets cleanly and Original remains tick-for-tick identical', () => {
  const orig = trackById('original');
  const fresh = runSim(orig, () => driftDriver(), classic).game;
  const game = createGame();
  for (const id of NEW_IDS) {
    startRun(game, { track: trackById(id), handling: power });
    const d = driftDriver();
    for (let i = 0; i < steps(12); i += 1) tick(game, d(game));
    assert.equal(game.track.id, id);
    restartRun(game);
    assert.equal(game.state, 'ready');
    assert.equal(game.scoring.score, 0);
    assert.equal(game.laps.completed, 0);
  }
  startRun(game, { track: orig, handling: classic });
  const d = driftDriver();
  while (game.state !== 'finished' && game.ticks < steps(500)) tick(game, d(game));
  assert.deepEqual([game.ticks, game.scoring.score, game.laps.bestLap, game.car.x, game.car.y],
    [fresh.ticks, fresh.scoring.score, fresh.laps.bestLap, fresh.car.x, fresh.car.y]);
});

// --- 5. Records, reference ghosts, v0.8.0 save compatibility and R0 isolation ---------------
test('all 4 new circuits keep independent Classic/Power records and reference ghosts alongside v0.8.0 saves without R0 contamination', () => {
  const v080Records = {
    version: 3,
    tracks: {
      original: { classic: { fastestLap: 44.1, scoring: { [SCORING_VERSION]: { score: 25000, bestCombo: 4000 } } } },
      switchback: { revised: { fastestLap: 48.2, scoring: { [SCORING_VERSION]: { score: 31000, bestCombo: 6200 } } } },
      dockyard: { classic: { fastestLap: 30.9, scoring: { [SCORING_VERSION]: { score: 14000, bestCombo: 2100 } } } },
    },
  };
  const map = new Map([
    [RECORDS_KEY, JSON.stringify(v080Records)],
    ['mini-drifters-r0-records', JSON.stringify({ tracks: { 'exp-runway-27': { classic: { score: 999999 } } } })],
    ['mini-drifters-r0-ghosts', JSON.stringify({ ghosts: { 'exp-runway-27': { classic: { lapTime: 1.0 } } } })],
  ]);
  const writes = [];
  const storage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { writes.push(k); map.set(k, String(v)); },
  };

  const records = createRecords(() => storage);
  const ghostStore = createGhostStore(() => storage);
  const refs = createReferenceGhosts({
    store: ghostStore,
    bestLapFor: (trackId, handlingId) => records.forTrack(trackId, handlingId).fastestLap,
  });

  // Loading reads v0.8.0 records losslessly, leaves R0 keys ignored, and performs zero writes.
  assert.deepEqual(writes, []);
  assert.deepEqual(records.forTrack('original', 'classic'), { score: 25000, fastestLap: 44.1, bestCombo: 4000 });
  assert.deepEqual(records.forTrack('switchback', 'revised'), { score: 31000, fastestLap: 48.2, bestCombo: 6200 });
  assert.deepEqual(records.forTrack('dockyard', 'classic'), { score: 14000, fastestLap: 30.9, bestCombo: 2100 });
  for (const id of NEW_IDS) {
    for (const h of HANDLING_IDS) {
      assert.deepEqual(records.forTrack(id, h), { score: null, fastestLap: null, bestCombo: null });
      assert.equal(ghostStore.slot(id, h).status, 'none');
    }
  }

  // Run one real 3-lap session on each new circuit (alternating Classic & Power), saving records & reference ghost.
  const entries = [];
  for (let idx = 0; idx < NEW_IDS.length; idx += 1) {
    const id = NEW_IDS[idx];
    const handling = idx % 2 === 0 ? classic : power;
    const game = createGame(trackById(id), {
      onRunEvent: (e) => { records.handle(e); refs.handle(e); },
    });
    startRun(game, { track: trackById(id), handling });
    const d = gripDriver();
    while (game.state !== 'finished' && game.ticks < steps(400)) tick(game, d(game));
    assert.equal(game.state, 'finished');
    const savedRec = records.forTrack(id, handling.id);
    assert.equal(savedRec.score, game.results.score);
    assert.equal(savedRec.fastestLap, game.results.bestLap);
    assert.equal(savedRec.bestCombo, game.results.bestCombo);
    const otherMode = handling.id === 'classic' ? 'revised' : 'classic';
    assert.deepEqual(records.forTrack(id, otherMode), { score: null, fastestLap: null, bestCombo: null });
    const slot = ghostStore.slot(id, handling.id);
    assert.equal(slot.status, 'ok', `${id}/${handling.id} saved reference ghost`);
    assert.equal(ghostStore.slot(id, otherMode).status, 'none');
    entries.push({ id, handling: handling.id, identity: expectedIdentity(id, handling.id) });
  }

  // All identities carry compatibility=1 and distinct track fingerprints.
  assert.ok(entries.every((e) => e.identity.compatibility === GHOST_COMPATIBILITY && GHOST_COMPATIBILITY === 1));
  assert.equal(new Set(entries.map((e) => e.identity.track)).size, 4);

  // Reloading preserves v0.8.0 records, all 4 new circuits' records & ghosts, and never touches R0 keys.
  const reloadedRecords = createRecords(() => storage);
  const reloadedGhosts = createGhostStore(() => storage);
  assert.deepEqual(reloadedRecords.forTrack('original', 'classic'), { score: 25000, fastestLap: 44.1, bestCombo: 4000 });
  assert.deepEqual(reloadedRecords.forTrack('switchback', 'revised'), { score: 31000, fastestLap: 48.2, bestCombo: 6200 });
  assert.deepEqual(reloadedRecords.forTrack('dockyard', 'classic'), { score: 14000, fastestLap: 30.9, bestCombo: 2100 });
  for (const e of entries) {
    assert.ok(reloadedRecords.forTrack(e.id, e.handling).fastestLap > 0);
    assert.equal(reloadedGhosts.slot(e.id, e.handling).status, 'ok');
  }
  assert.ok(writes.every((k) => k === RECORDS_KEY || k === GHOST_STORE_KEY), `only production storage keys written: ${writes.join(', ')}`);
});

// --- 6. Analytics category & performance budgets ------------------------------------------
test('new circuits use existing tracks analytics category and meet build/collision performance budgets', () => {
  assert.equal(categoryOf({ mode: 'normal' }), 'tracks');
  for (const id of NEW_IDS) {
    const spec = TRACKS.find((t) => t.id === id);
    const t0 = performance.now();
    const built = { ...buildTrack(spec.control), id: spec.id, name: spec.name, apron: 'grass' };
    const scenery = buildScenery(built);
    const colliders = collidersFromScenery(scenery, built.bounds);
    const buildMs = performance.now() - t0;
    assert.ok(buildMs < 500, `${id} build took ${buildMs.toFixed(1)} ms (budget < 500 ms)`);

    // Benchmark 2000 resolveObstacles checks along the road.
    const car = { x: built.start.x, y: built.start.y, vx: 20, vy: 0, heading: 0, yawRate: 0 };
    const c0 = performance.now();
    for (let i = 0; i < 2000; i += 1) {
      const pt = built.points[i % built.points.length];
      car.x = pt.x;
      car.y = pt.y;
      resolveObstacles(car, colliders, pt.x - 0.2, pt.y);
    }
    const perStepUs = ((performance.now() - c0) / 2000) * 1000;
    assert.ok(perStepUs < 50, `${id} resolveObstacles took ${perStepUs.toFixed(2)} µs/step (budget < 50 µs)`);
  }
});
