// v0.6.0 R2: Original's and Switchback's scenery. Layout rules, collision geometry, and proof that
// the driving, the laps and the scoring are what they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TUNING as T } from '../src/tuning.js';
import { trackById, projectOnTrack, surfaceAt, surfaceFromDistance, isOnCourse } from '../src/track.js';
import { updateDerived } from '../src/physics.js';
import { createGame, startRun, tick, advance } from '../src/game.js';
import { handlingById } from '../src/handling.js';
import { obstaclesFor, collidersFromProps, resolveObstacles } from '../src/obstacles.js';
import { buildDockyardScenery } from '../src/dockyard-scenery.js';
import { sceneryFor, buildScenery, solidShapes, isSolidKind, KINDS, SCENERY_RULES } from '../src/scenery.js';
import { DRAWN_KINDS } from '../src/scenery-draw.js';
import { SCORING_VERSION } from '../src/scoring.js';
import { RECORDS_KEY, SCHEMA_VERSION } from '../src/records.js';
import { gripDriver, driftDriver, recklessDriver } from './support/drivers.mjs';
import { onLine, outsideControl } from './support/environment-drivers.mjs';
import { colliderClearance, colliderGap, wallGaps, signedDistance, colliderSamples } from './support/scenery-geometry.mjs';

const dt = T.simStep;
const steps = (seconds) => Math.round(seconds / dt);
const R = T.carRadius;
const CIRCUITS = ['original', 'switchback'].map((id) => trackById(id));
const MODES = [['Classic', handlingById('classic')], ['Power', handlingById('revised')]];
const reaches = (c, b) => c.maxX > b.minX && c.minX < b.maxX && c.maxY > b.minY && c.minY < b.maxY;

function placed(track, { x, y, heading, speed = 0 }) {
  const game = createGame(track);
  startRun(game, { track, ghost: false });
  game.state = 'racing';
  Object.assign(game.car, { x, y, heading, vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed, yawRate: 0 });
  updateDerived(game.car);
  Object.assign(game.prev, { x, y, heading });
  game.trackInfo = projectOnTrack(track, x, y);
  game.trackS = game.trackInfo.s;
  return game;
}

// --- Layout ----------------------------------------------------------------------------------------

test('each circuit\'s layout is deterministic, built once, and pinned', () => {
  // Fingerprints of the complete prop list. A deliberate layout change updates them here.
  const PINNED = { original: [1524, 53, 'e5c5dd91fffa0fe4'], switchback: [3077, 247, '3ce6a9db557ce48a'] };
  for (const track of CIRCUITS) {
    const a = buildScenery(track);
    const b = buildScenery(track);
    assert.deepEqual(a, b, `${track.id}: two builds are identical`);
    assert.equal(sceneryFor(track), sceneryFor(track), 'cached per track');
    assert.ok(Object.isFrozen(a.props) && Object.isFrozen(a.props[0]), 'frozen');
    const hash = createHash('sha256').update(JSON.stringify(a.props)).digest('hex').slice(0, 16);
    assert.deepEqual([a.props.length, obstaclesFor(track).length, hash], PINNED[track.id], `${track.id}: props, reachable colliders, content`);
    // Building the layout leaves the circuit untouched.
    const before = structuredClone(track);
    buildScenery(track);
    assert.deepEqual(track, before);
  }
  for (const id of ['dockyard']) assert.equal(sceneryFor(trackById(id)), null, 'Dockyard keeps its own layout');
});

test('every reachable solid stays at least 24 m from the centreline (12 m of grass past the curb)', () => {
  for (const track of CIRCUITS) {
    let closest = Infinity;
    for (const c of obstaclesFor(track)) closest = Math.min(closest, colliderClearance(track, c));
    assert.ok(closest >= SCENERY_RULES.solidClearance, `${track.id}: closest solid ${closest.toFixed(2)} m`);
  }
});

test('solids touch or leave 7 m between them and to the perimeter wall, so the car cannot wedge', () => {
  for (const track of CIRCUITS) {
    const boxes = obstaclesFor(track);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        // Pieces of one polyline are joined through the pieces between them.
        if (boxes[i].source === boxes[j].source && Math.abs(boxes[i].piece - boxes[j].piece) < 3) continue;
        const g = colliderGap(boxes[i], boxes[j]);
        assert.ok(g <= 1e-6 || g >= SCENERY_RULES.gap, `${track.id}: ${boxes[i].kind} #${boxes[i].source} and ${boxes[j].kind} #${boxes[j].source} are ${g.toFixed(2)} m apart`);
      }
      for (const g of wallGaps(boxes[i], track.bounds)) {
        assert.ok(g <= 1e-6 || g >= SCENERY_RULES.gap, `${track.id}: ${boxes[i].kind} #${boxes[i].source} is ${g.toFixed(2)} m off the wall`);
      }
    }
  }
});

test('all the open ground inside the wall is one connected space: nothing can enclose the car', () => {
  const cell = 1.5;
  for (const track of CIRCUITS) {
    const boxes = obstaclesFor(track);
    const b = track.bounds;
    const nx = Math.floor((b.maxX - b.minX - 2 * R) / cell);
    const ny = Math.floor((b.maxY - b.minY - 2 * R) / cell);
    const at = (i, j) => [b.minX + R + (i + 0.5) * cell, b.minY + R + (j + 0.5) * cell];
    const free = new Uint8Array(nx * ny);
    let total = 0;
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const [x, y] = at(i, j);
        const blocked = boxes.some((c) => x > c.minX - R && x < c.maxX + R && y > c.minY - R && y < c.maxY + R && signedDistance(c, x, y) < R);
        if (!blocked) { free[j * nx + i] = 1; total += 1; }
      }
    }
    const start = [Math.floor((track.start.x - b.minX - R) / cell), Math.floor((track.start.y - b.minY - R) / cell)];
    const seen = new Uint8Array(nx * ny);
    const queue = [start[1] * nx + start[0]];
    seen[queue[0]] = 1;
    let reached = 0;
    while (queue.length) {
      const k = queue.pop();
      reached += 1;
      const i = k % nx;
      const j = (k - i) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const u = i + di;
        const v = j + dj;
        if (u < 0 || v < 0 || u >= nx || v >= ny) continue;
        const q = v * nx + u;
        if (free[q] && !seen[q]) { seen[q] = 1; queue.push(q); }
      }
    }
    assert.equal(reached, total, `${track.id}: ${total - reached} open cells cannot be reached from the grid`);
  }
});

test('every collider is a drawn, raised prop, inside what is drawn; every raised prop in reach has one', () => {
  for (const kind of Object.keys(KINDS)) if (kind !== 'water' && kind !== 'paint' && kind !== 'guardrail') {
    assert.ok(DRAWN_KINDS.includes(kind), `${kind} is drawn`);
  }
  for (const track of CIRCUITS) {
    const { props } = sceneryFor(track);
    const boxes = obstaclesFor(track);
    for (const c of boxes) {
      const p = props[c.source];
      assert.ok(p && isSolidKind(p.kind) && DRAWN_KINDS.includes(p.kind), `${track.id}: collider #${c.source} is a drawn raised prop`);
      if (c.shape === 'capsule' && p.r !== undefined) {
        assert.ok(c.radius <= p.r && c.ax === p.x && c.ay === p.y, `${p.kind}: within its drawn circle`);
      } else if (c.shape === 'capsule') {
        assert.equal(c.radius, p.width / 2);
        assert.deepEqual([c.ax, c.ay, c.bx, c.by], [...p.points[c.piece], ...p.points[c.piece + 1]], `${p.kind}: on its drawn line`);
      } else if (c.shape === 'poly') {
        assert.equal(c.points, p.points, `${p.kind}: its own drawn outline`);
      } else {
        assert.deepEqual([c.minX, c.minY, c.maxX, c.maxY], [p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2], `${p.kind}: its drawn box`);
      }
    }
    props.forEach((p, i) => {
      const shapes = solidShapes([p]);
      if (!isSolidKind(p.kind)) {
        assert.equal(shapes.length, 0, `${p.kind} is flat`);
        assert.ok(!boxes.some((c) => c.source === i), `${track.id}: flat ${p.kind} #${i} has no collider`);
        return;
      }
      const inReach = shapes.some((s) => reaches(s.shape === 'box' ? s : boundsOf(s), track.bounds));
      assert.equal(boxes.some((c) => c.source === i), inReach, `${track.id}: ${p.kind} #${i} has a collider exactly when the car can reach it`);
    });
  }
});

function boundsOf(s) {
  if (s.shape === 'poly') {
    const xs = s.points.map((q) => q[0]);
    const ys = s.points.map((q) => q[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }
  return { minX: Math.min(s.ax, s.bx) - s.radius, maxX: Math.max(s.ax, s.bx) + s.radius, minY: Math.min(s.ay, s.by) - s.radius, maxY: Math.max(s.ay, s.by) + s.radius };
}

test('paved ground (roads, car parks, gravel lots, the overlook) lies wholly beyond the wall', () => {
  for (const track of CIRCUITS) {
    const b = track.bounds;
    for (const p of sceneryFor(track).props) {
      if (!['road', 'parking', 'gravel', 'paved'].includes(p.kind)) continue;
      const samples = p.width
        ? p.points.slice(1).flatMap((q, i) => colliderSamples({ shape: 'capsule', ax: p.points[i][0], ay: p.points[i][1], bx: q[0], by: q[1], radius: p.width / 2 }))
        : colliderSamples({ shape: 'poly', points: p.points });
      for (const [x, y, r] of samples) {
        const inside = x + r > b.minX && x - r < b.maxX && y + r > b.minY && y - r < b.maxY;
        assert.ok(!inside, `${track.id}: ${p.kind} reaches inside the wall at ${x.toFixed(1)},${y.toFixed(1)}`);
      }
    }
  }
});

// --- Surfaces, checkpoints, laps -------------------------------------------------------------------

test('the ground under every flat prop drives as it did: road, curb or grass by distance alone', () => {
  for (const track of CIRCUITS) {
    assert.equal(track.apron, 'grass');
    const b = track.bounds;
    let checked = 0;
    for (const p of sceneryFor(track).props) {
      if (isSolidKind(p.kind)) continue;
      const pts = p.points ?? [[p.x, p.y]];
      for (const [x, y] of pts) {
        if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
        const d = projectOnTrack(track, x, y).distance;
        assert.equal(surfaceAt(track, x, y), d <= 10 ? 'road' : d <= 12 ? 'curb' : 'grass');
        assert.equal(isOnCourse(track, d), d <= 12);
        checked += 1;
      }
    }
    // Switchback's gravel shoulders (12..15 m) are drawn on ground that drives as grass.
    for (const d of [12.5, 14, 15]) assert.equal(surfaceFromDistance(track, d), 'grass');
    assert.ok(checked > 10, `${track.id}: ${checked} flat-prop points checked`);
  }
});

test('every checkpoint gate stays open from its inside tip to well past the outside curb', () => {
  for (const track of CIRCUITS) {
    const boxes = obstaclesFor(track);
    for (const g of [track.finish, ...track.gates]) {
      const len = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
      for (let d = 0; d <= len; d += 0.5) {
        const x = g.x1 + ((g.x2 - g.x1) * d) / len;
        const y = g.y1 + ((g.y2 - g.y1) * d) / len;
        if (projectOnTrack(track, x, y).distance > 22) continue;
        assert.ok(boxes.every((c) => signedDistance(c, x, y) >= R), `${track.id}: gate at s=${g.s.toFixed(0)} is blocked at ${x.toFixed(1)},${y.toFixed(1)}`);
      }
    }
  }
});

// The strongest check that nothing about driving changed: the same runs with and without the solid
// scenery come out identical, step for step, in both modes and for every kind of scripted driver.
test('scripted runs score, time and lap exactly as without the scenery, in both handling modes', () => {
  for (const track of CIRCUITS) {
    for (const [name, handling] of MODES) {
      for (const make of [gripDriver, driftDriver, recklessDriver]) {
        const run = (solids) => {
          const game = createGame(track, { handling });
          startRun(game, { track, handling });
          if (!solids) game.obstacles = Object.freeze([]);
          const driver = make();
          let path = 0;
          while (game.state !== 'finished' && game.ticks < steps(600)) {
            tick(game, driver(game));
            path = (path * 31 + Math.round(game.car.x * 1000) + Math.round(game.car.y * 1000)) % 1e9;
          }
          return { results: game.results, path, contact: game.lastContact };
        };
        const withScenery = run(true);
        const without = run(false);
        assert.equal(withScenery.contact, null, `${track.id} ${name} ${make.name}: never touched scenery`);
        assert.ok(withScenery.results, `${track.id} ${name} ${make.name}: finished`);
        assert.deepEqual(withScenery, { ...without, contact: null }, `${track.id} ${name} ${make.name}: identical to the run without scenery`);
      }
    }
  }
});

test('running 16 m wide through every corner never meets the scenery, and the laps still count', () => {
  for (const track of CIRCUITS) {
    for (const [name, handling] of MODES) {
      const game = createGame(track, { handling });
      startRun(game, { track, handling });
      const driver = onLine(gripDriver, outsideControl(track, 16));
      while (game.state !== 'finished' && game.ticks < steps(600)) tick(game, driver(game));
      assert.equal(game.lastContact, null, `${track.id} ${name}: no scenery contact`);
      assert.equal(game.state, 'finished');
      assert.equal(game.laps.voided, 0);
    }
  }
});

test('records and scoring identities are untouched', () => {
  assert.equal(SCORING_VERSION, 'scoring-2');
  assert.equal(RECORDS_KEY, 'mini-drifters-records-v3');
  assert.equal(SCHEMA_VERSION, 3);
});

// --- Contact with the rounded shapes ----------------------------------------------------------------

const firstOf = (track, kind, shape) => obstaclesFor(track).find((c) => c.kind === kind && (!shape || c.shape === shape));

test('a tree, a woodland stand and a retaining wall stop the car at their outline, square on and at speed', () => {
  const sw = trackById('switchback');
  const og = trackById('original');
  const cases = [[sw, firstOf(sw, 'pine')], [og, firstOf(og, 'tree')], [og, firstOf(og, 'stand')], [sw, firstOf(sw, 'retaining')], [sw, firstOf(sw, 'rock')]];
  for (const [track, c] of cases) {
    // Aim at the collider's surface from 6 m out, along its outward normal.
    const [sx, sy] = c.shape === 'poly' ? c.points[0] : [(c.ax + c.bx) / 2, (c.ay + c.by) / 2];
    const cx = (c.minX + c.maxX) / 2;
    const cy = (c.minY + c.maxY) / 2;
    let nx = sx - cx;
    let ny = sy - cy;
    // A tree or a rock is a capsule of no length: approach it from the east.
    if (Math.hypot(nx, ny) < 1e-6) [nx, ny] = c.shape === 'capsule' && (c.bx !== c.ax || c.by !== c.ay) ? [-(c.by - c.ay), c.bx - c.ax] : [1, 0];
    const n = Math.hypot(nx, ny) || 1;
    [nx, ny] = [nx / n, ny / n];
    const surface = c.shape === 'capsule' ? [sx + nx * c.radius, sy + ny * c.radius] : [sx, sy];
    const start = { x: surface[0] + nx * 6, y: surface[1] + ny * 6, heading: Math.atan2(-ny, -nx), speed: 28 };
    const game = placed(track, start);
    let closest = Infinity;
    let hit = null;
    for (let i = 0; i < steps(1.5); i += 1) {
      tick(game, { up: true, down: false, left: false, right: false, handbrake: false });
      closest = Math.min(closest, ...obstaclesFor(track).filter((b) => Math.abs(b.minX - game.car.x) < 300).map((b) => signedDistance(b, game.car.x, game.car.y)));
      if (game.lastContact && !hit) hit = game.lastContact;
    }
    assert.ok(hit, `${c.kind}: hit`);
    assert.equal(hit.kind, c.kind);
    assert.ok(hit.impact > 20, `${c.kind}: a hard hit (${hit.impact.toFixed(1)} m/s)`);
    assert.ok(closest >= R - 1e-6, `${c.kind}: the car never overlapped (${closest.toFixed(3)} m)`);
  }
});

test('a car centre placed inside a stand, or on a tree\'s spine, is pushed straight out', () => {
  const og = trackById('original');
  const stand = firstOf(og, 'stand');
  const cx = stand.points.reduce((a, q) => a + q[0], 0) / stand.points.length;
  const cy = stand.points.reduce((a, q) => a + q[1], 0) / stand.points.length;
  const car = { x: cx, y: cy, vx: 0, vy: 0, yawRate: 0 };
  for (let i = 0; i < 40; i += 1) resolveObstacles(car, [stand], car.x, car.y);
  assert.ok(signedDistance(stand, car.x, car.y) >= R - 1e-6, 'out of the stand');
  const tree = firstOf(og, 'tree');
  const on = { x: tree.ax, y: tree.ay, vx: 0, vy: 0, yawRate: 0 };
  resolveObstacles(on, [tree], on.x, on.y);
  assert.ok(signedDistance(tree, on.x, on.y) >= R - 1e-6, 'off the tree');
});

test('no speed tunnels through a retaining wall, and contact is the same at 30, 60 and 120 Hz', () => {
  const sw = trackById('switchback');
  const wall = firstOf(sw, 'retaining');
  const mx = (wall.ax + wall.bx) / 2;
  const my = (wall.ay + wall.by) / 2;
  let nx = -(wall.by - wall.ay);
  let ny = wall.bx - wall.ax;
  const n = Math.hypot(nx, ny);
  [nx, ny] = [nx / n, ny / n];
  const car = { x: mx + nx * 30, y: my + ny * 30, vx: 0, vy: 0, yawRate: 0 };
  const ax = car.x;
  const ay = car.y;
  car.x -= nx * 60; // a 2,400+ m/s step straight through it
  car.y -= ny * 60;
  car.vx = -nx * 2400;
  car.vy = -ny * 2400;
  resolveObstacles(car, obstaclesFor(sw), ax, ay);
  assert.ok((car.x - mx) * nx + (car.y - my) * ny > 0, 'stayed on its own side');
  const finals = [30, 60, 120].map((hz) => {
    const game = placed(sw, { x: mx + nx * 20, y: my + ny * 20, heading: Math.atan2(-ny, -nx), speed: 22 });
    for (let i = 0; i < hz * 2; i += 1) advance(game, 1 / hz, { up: true, down: false, left: false, right: false, handbrake: false });
    return [game.car.x, game.car.y, game.car.vx, game.car.vy, game.ticks];
  });
  assert.deepEqual(finals[0], finals[1]);
  assert.deepEqual(finals[1], finals[2]);
});

// --- Dockyard ---------------------------------------------------------------------------------------

test('Dockyard keeps exactly R1\'s solid scenery: 31 boxes from its own layout', () => {
  const dock = trackById('dockyard');
  const boxes = obstaclesFor(dock);
  assert.equal(boxes.length, 31);
  assert.deepEqual(boxes, collidersFromProps(buildDockyardScenery(dock).props));
  assert.ok(boxes.every((b) => b.shape === undefined), 'boxes only');
  assert.equal(dock.apron, 'concrete');
});

// --- Cost -------------------------------------------------------------------------------------------

test('layouts build quickly and contact checks stay cheap', () => {
  for (const track of CIRCUITS) {
    let t0 = performance.now();
    buildScenery(track);
    const build = performance.now() - t0;
    assert.ok(build < 500, `${track.id}: built in ${build.toFixed(0)} ms`);
    const boxes = obstaclesFor(track);
    const car = { x: track.start.x, y: track.start.y, vx: 30, vy: 0, yawRate: 0 };
    t0 = performance.now();
    for (let i = 0; i < 20000; i += 1) resolveObstacles(car, boxes, car.x - 0.25, car.y);
    const per = ((performance.now() - t0) / 20000) * 1000;
    assert.ok(per < 50, `${track.id}: ${per.toFixed(2)} µs per step`);
  }
});
