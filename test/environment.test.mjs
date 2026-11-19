// v0.6.0 R1: functional environments, on Dockyard. The physical surface (how the car drives) is
// kept apart from the competition rules (whether it is on the course), and Dockyard's warehouses,
// containers and concrete barriers are solid. Original, Switchback, the practice pad and the
// gymkhana pads have neither and must not change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as T } from '../src/tuning.js';
import { trackById, projectOnTrack, surfaceAt, isOnCourse } from '../src/track.js';
import { surfaceFactors, createCar, stepCar, updateDerived } from '../src/physics.js';
import { createScoring, updateScoring, classifyDrift, isOffCourse } from '../src/scoring.js';
import { createGame, startRun, tick, advance, countedScore } from '../src/game.js';
import { handlingById, HANDLING_MODES } from '../src/handling.js';
import { obstaclesFor, collidersFromProps, resolveObstacles, SOLID_KINDS, CONTACT } from '../src/obstacles.js';
import { buildDockyardScenery } from '../src/dockyard-scenery.js';
import { padTrack } from '../src/practice-pad.js';
import { PRECISION_180, LINKED_DRIFT, ONE_DRIFT, SLALOM_SPRINT } from '../src/gymkhana.js';
import { gripDriver, driftDriver } from './support/drivers.mjs';
import { onLine, chordControl, outsideControl } from './support/environment-drivers.mjs';

const DEG = Math.PI / 180;
const dt = T.simStep;
const steps = (seconds) => Math.round(seconds / dt);
const dock = trackById('dockyard');
const original = trackById('original');
const switchback = trackById('switchback');
const classic = handlingById('classic');
const power = handlingById('revised');
const MODES = [['Classic', classic], ['Power', power]];
const boxes = obstaclesFor(dock);
const reach = dock.halfWidth + dock.curbWidth;
const R = T.carRadius;
const KEYS = { up: false, down: false, left: false, right: false, handbrake: false };

// Distance from a point to a box (0 inside it).
const gapTo = (b, x, y) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minY - y, 0, y - b.maxY));
const clearance = (car) => Math.min(...boxes.map((b) => gapTo(b, car.x, car.y)));

// A run already under way, with the car placed by hand. No ghost, so nothing records the jump.
function placed(track, { x, y, heading, speed = 0 }, handling = classic) {
  const game = createGame(track, { handling });
  startRun(game, { track, handling, ghost: false });
  game.state = 'racing';
  Object.assign(game.car, { x, y, heading, vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed, yawRate: 0 });
  updateDerived(game.car);
  Object.assign(game.prev, { x, y, heading });
  game.trackInfo = projectOnTrack(track, x, y);
  game.trackS = game.trackInfo.s;
  return game;
}

// Ticks the game and watches the car never overlap a box.
function drive(game, seconds, input, watch = {}) {
  watch.minClear ??= Infinity;
  watch.hits ??= [];
  for (let i = 0; i < steps(seconds); i += 1) {
    tick(game, typeof input === 'function' ? input(i) : input);
    watch.minClear = Math.min(watch.minClear, clearance(game.car));
    if (game.lastContact?.tick === game.ticks - 1) watch.hits.push(game.lastContact.impact);
  }
  return watch;
}

// --- 1. Physical surfaces --------------------------------------------------------------------
test('Dockyard\'s apron is concrete; Original\'s and Switchback\'s are grass; the course is road and curbs on all three', () => {
  for (const [track, apron] of [[dock, 'concrete'], [original, 'grass'], [switchback, 'grass']]) {
    assert.equal(track.apron, apron);
    const p = track.points[Math.round(track.points.length / 2)];
    const at = (o) => [p.x - p.ty * o, p.y + p.tx * o];
    assert.equal(surfaceAt(track, ...at(5)), 'road');
    assert.equal(surfaceAt(track, ...at(11)), 'curb');
    assert.equal(surfaceAt(track, ...at(-11)), 'curb');
    assert.equal(surfaceAt(track, ...at(20)), apron);
    assert.equal(surfaceAt(track, ...at(-30)), apron);
    assert.equal(isOnCourse(track, 11.9), true);
    assert.equal(isOnCourse(track, 12.1), false);
  }
});

test('concrete drives exactly as the road in both modes; grass and curb keep v0.5.0\'s numbers', () => {
  for (const [, mode] of MODES) {
    assert.deepEqual(surfaceFactors('concrete', mode.tuning), surfaceFactors('road', mode.tuning));
    assert.deepEqual(surfaceFactors('road', mode.tuning), { traction: 1, engine: 1, drag: 0 });
    assert.deepEqual(surfaceFactors('grass', mode.tuning), { traction: 0.58, engine: 0.6, drag: 0.42 });
    assert.deepEqual(surfaceFactors('curb', mode.tuning), { traction: 0.94, engine: 0.97, drag: 0 });
  }
});

// Measured with v0.5.0's physics (a044dde): five seconds of throttle with a little steering and two
// handbrake pulls, on each surface. Concrete must land exactly on road.
const V050_SURFACE_RUNS = {
  'classic/road': [98.120325, -29.289446, -0.487865, 33.875782],
  'classic/curb': [96.503847, -27.869248, -0.471978, 33.477175],
  'classic/grass': [38.810503, -9.038791, -0.417934, 11.105703],
  'revised/road': [97.367406, -30.599044, -0.50821, 33.832321],
  'revised/curb': [95.665523, -29.37232, -0.495775, 33.427364],
  'revised/grass': [38.776039, -9.064952, -0.421762, 11.090673],
};
test('road, curb and grass drive exactly as in v0.5.0, and concrete drives exactly as road, in both modes', () => {
  for (const mode of HANDLING_MODES) {
    const runOn = (surface) => {
      const car = createCar({ x: 0, y: 0, heading: 0 });
      for (let i = 0; i < 600; i += 1) stepCar(car, { ...KEYS, up: true, left: i % 240 > 200, handbrake: i % 300 > 280 }, surface, mode.tuning.simStep, mode.tuning);
      return car;
    };
    for (const surface of ['road', 'curb', 'grass']) {
      const car = runOn(surface);
      assert.deepEqual([car.x, car.y, car.heading, car.speed].map((v) => Number(v.toFixed(6))), V050_SURFACE_RUNS[`${mode.id}/${surface}`], `${mode.id} on ${surface}`);
    }
    const { surface: s1, ...road } = runOn('road');
    const { surface: s2, ...concrete } = runOn('concrete');
    assert.deepEqual(concrete, road, `${mode.id}: concrete is bit-for-bit road`);
    assert.deepEqual([s1, s2], ['road', 'concrete']);
  }
});

test('leaving Dockyard\'s road keeps full traction and goes off the course; leaving Original\'s blends down to grass', () => {
  for (const [, mode] of MODES) {
    for (const [track, apron, traction] of [[dock, 'concrete', 1], [original, 'grass', T.offTrackTraction]]) {
      // A straight, crossed at 30 degrees to the right at 25 m/s.
      const p = track.points[track === dock ? 30 : 15];
      const game = placed(track, { x: p.x, y: p.y, heading: Math.atan2(p.ty, p.tx) + 30 * DEG, speed: 25 }, mode);
      const seen = new Set();
      let lowest = 1;
      for (let i = 0; i < steps(2); i += 1) {
        tick(game, { ...KEYS, up: true });
        seen.add(`${game.car.surface}/${game.onCourse ? 'on' : 'off'}`);
        lowest = Math.min(lowest, game.car.traction);
      }
      assert.equal(game.car.surface, apron);
      assert.equal(game.onCourse, false);
      assert.deepEqual([...seen].sort(), ['curb/on', `${apron}/off`, 'road/on'].sort(), [...seen].join(', '));
      assert.ok(Math.abs(game.car.traction - traction) < 1e-9, `${track.id}: traction ${game.car.traction}`);
      if (track === dock) assert.ok(lowest >= T.curbTraction - 1e-9, 'only the curb dips it');
    }
  }
});

// --- 2. Solid scenery -----------------------------------------------------------------------
test('the solid boxes are the scenery layout\'s own warehouses, containers and barriers, plus filled gaps', () => {
  const { props, boards } = buildDockyardScenery(dock);
  const solids = boxes.filter((b) => !b.filled);
  assert.deepEqual(SOLID_KINDS, ['warehouse', 'container', 'barrier']);
  assert.equal(solids.length, props.filter((p) => SOLID_KINDS.includes(p.kind)).length);
  assert.deepEqual(solids.map((b) => b.kind).sort(), [...Array(3).fill('warehouse'), ...Array(9).fill('container'), ...Array(7).fill('barrier')].sort());
  for (const b of solids) {
    const p = props[b.source];
    assert.deepEqual([b.minX, b.minY, b.maxX, b.maxY], [p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2], `${p.kind} at ${p.x},${p.y}`);
  }
  assert.deepEqual(collidersFromProps(props), boxes, 'one source, rebuilt identically');
  assert.equal(obstaclesFor(dock), boxes, 'built once per circuit');
  // Each filler spans only the gap between two solids that face each other, narrower than the car can use.
  for (const s of boxes.filter((b) => b.filled)) {
    const [a, c] = s.source.map((i) => solids.find((b) => b.source === i));
    assert.equal(s.kind, a.kind === c.kind ? a.kind : 'barrier', 'a filled gap is hit as what it joins');
    const w = s.maxX - s.minX;
    const h = s.maxY - s.minY;
    assert.ok(Math.min(w, h) < CONTACT.sealGap && Math.min(w, h) > 0);
    for (const x of [s.minX, s.maxX]) assert.ok(x >= Math.min(a.minX, c.minX) && x <= Math.max(a.maxX, c.maxX));
    for (const y of [s.minY, s.maxY]) assert.ok(y >= Math.min(a.minY, c.minY) && y <= Math.max(a.maxY, c.maxY));
  }
  // Paint and boards are never solid.
  for (const p of props.filter((q) => q.kind === 'loading')) assert.equal(boxes.some((b) => gapTo(b, p.x, p.y) === 0), false);
  for (const board of boards) assert.equal(boxes.some((b) => gapTo(b, board.x, board.y) < board.w / 2 + R), false, board.id);
});

test('no solid box can touch a car anywhere on the road or curbs', () => {
  for (const b of boxes) {
    for (let x = b.minX; x <= b.maxX; x += 0.5) {
      for (let y = b.minY; y <= b.maxY; y += 0.5) {
        const d = projectOnTrack(dock, x, y).distance;
        assert.ok(d >= reach + 4, `${b.kind} at ${x},${y} is ${d.toFixed(1)} m from the centreline`);
      }
    }
  }
  assert.ok(reach + 4 > reach + R, 'four metres past the curb is more than the car\'s radius');
});

test('the warehouses are solid, and stand beyond the perimeter wall, so the wall is what a car meets first', () => {
  const b = dock.bounds;
  const houses = boxes.filter((x) => x.kind === 'warehouse');
  assert.equal(houses.length, 3);
  for (const h of houses) {
    assert.ok(h.maxY < b.minY || h.minY > b.maxY, 'outside the wall');
    // Fired straight at its face, the car stops on it.
    const y = h.maxY < b.minY ? h.maxY + 6 : h.minY - 6;
    const car = createCar({ x: (h.minX + h.maxX) / 2, y, heading: 0 });
    car.vy = h.maxY < b.minY ? -30 : 30;
    let worst = Infinity;
    let hit = null;
    for (let i = 0; i < steps(0.5); i += 1) {
      const ax = car.x; const ay = car.y;
      car.y += car.vy * dt;
      hit = resolveObstacles(car, [h], ax, ay) ?? hit;
      worst = Math.min(worst, gapTo(h, car.x, car.y));
    }
    assert.ok(worst >= R - 1e-6, 'never inside');
    assert.ok(hit && Math.abs(hit.impact - 30) < 1e-9 && hit.kind === 'warehouse');
  }
});

// A container stack inside the Hook: 99..121 x -48..-29, sealed into one block.
const STACK = { x: 80, y: -38 };
test('a square container hit at speed stops the car on its face, bounces it back a little, and is a hard hit', () => {
  for (const [, mode] of MODES) {
    const game = placed(dock, { ...STACK, heading: 0, speed: 30 }, mode);
    const watch = drive(game, 1.2, KEYS);
    assert.ok(watch.minClear >= R - 1e-6, `never inside: ${watch.minClear}`);
    assert.ok(Math.abs(watch.hits[0] - 29.6) < 1, `hit at ${watch.hits[0]?.toFixed(1)} m/s`);
    assert.equal(game.lastContact.kind, 'container');
    assert.ok(game.car.x < 99 - R, 'bounced back off the face');
    assert.ok(game.car.vx <= 0 && game.car.speed < 10, `rolling back at ${game.car.speed.toFixed(1)} m/s`);
    assert.equal(watch.hits.filter((v) => v >= T.barrierSignificantImpact).length, 1, 'one hard hit, not a cascade');
  }
});

// The barrier row on the quay's outside: -65..-13 x -105..-103, two metres thick.
test('the thinnest solid, a concrete barrier, stops a car at top speed without letting it through', () => {
  for (const [, mode] of MODES) {
    const game = placed(dock, { x: -40, y: -86, heading: -Math.PI / 2, speed: T.topSpeed }, mode);
    const watch = drive(game, 1, { ...KEYS, up: true });
    assert.ok(watch.minClear >= R - 1e-6);
    assert.ok(game.car.y > -103, 'still on the quay side');
    assert.equal(game.lastContact.kind, 'barrier');
    assert.ok(watch.hits[0] > 35, `hit at ${watch.hits[0].toFixed(1)} m/s`);
  }
  // No step is long enough to jump it: even a car moving 2,400 m/s (20 m in one step) is caught.
  const wall = boxes.find((b) => b.kind === 'barrier');
  const car = createCar({ x: (wall.minX + wall.maxX) / 2, y: wall.maxY + 10, heading: -Math.PI / 2 });
  car.vy = -2400;
  const from = { x: car.x, y: car.y };
  car.y += car.vy * dt;
  const hit = resolveObstacles(car, boxes, from.x, from.y);
  assert.ok(hit && car.y >= wall.maxY + R - 1e-6, `stopped at ${car.y}`);
});

test('a glancing touch slides along the barrier: it keeps most of its speed and isn\'t a hard hit', () => {
  for (const [, mode] of MODES) {
    // Along the quay's outside, drifting 4 m/s toward the barrier row.
    const heading = Math.atan2(-4, 35);
    const game = placed(dock, { x: -70, y: -98.5, heading, speed: Math.hypot(35, 4) }, mode);
    const before = game.car.speed;
    const watch = drive(game, 0.6, { ...KEYS, up: true });
    assert.ok(watch.hits.length > 0, 'it touched');
    assert.ok(Math.max(...watch.hits) < T.barrierSignificantImpact, `largest ${Math.max(...watch.hits).toFixed(1)} m/s`);
    assert.ok(watch.minClear >= R - 1e-6);
    assert.ok(game.car.speed > 0.9 * before, `kept ${game.car.speed.toFixed(1)} of ${before.toFixed(1)} m/s`);
    assert.ok(game.car.x > -70 + 15, 'and carried on along it');
  }
});

test('pushing into a container at low speed rests on it: no jitter, no creep in, no hard hits', () => {
  for (const [, mode] of MODES) {
    const game = placed(dock, { x: 99 - R - 0.05, y: -38, heading: 0, speed: 1 }, mode);
    let lastX = game.car.x;
    let jump = 0;
    const watch = drive(game, 3, (i) => { jump = Math.max(jump, Math.abs(game.car.x - lastX)); lastX = game.car.x; return { ...KEYS, up: true }; });
    assert.ok(watch.minClear >= R - 1e-6);
    assert.ok(Math.abs(game.car.x - (99 - R)) < 0.01, `resting at ${game.car.x}`);
    assert.ok(jump < 0.05, `largest move in one step ${jump}`);
    assert.ok(watch.hits.length > 300, 'in contact throughout');
    assert.ok(watch.hits.every((v) => v < 1.5), `largest push ${Math.max(...watch.hits).toFixed(2)} m/s`);
    assert.ok(watch.hits.slice(10).every((v) => v < 0.2), 'then only the engine pushing');
    assert.ok(game.car.speed < 1);
  }
});

test('a car pinned on a face, or in the corner where two containers meet, reverses out freely', () => {
  // The container group south of the quay leaves a corner at (-25, -39) facing south-east.
  const corner = { x: -25 + R * 0.7, y: -39 + R * 0.7 };
  for (const [, mode] of MODES) {
    // The open side: back the way the car came from the face, and south-east out of the corner.
    for (const [name, start, heading, out] of [['face', { x: 99 - R - 0.5, y: -38 }, 0, Math.PI], ['corner', corner, -135 * DEG, 45 * DEG]]) {
      const game = placed(dock, { ...start, heading, speed: 6 }, mode);
      const watch = drive(game, 1.5, { ...KEYS, up: true });
      assert.ok(watch.hits.length > 0 && watch.minClear >= R - 1e-6, `${name}: pinned, never inside`);
      drive(game, 2, { ...KEYS, down: true }, watch);
      assert.ok(clearance(game.car) > R + 2, `${name}: ${clearance(game.car).toFixed(1)} m clear after reversing`);
      // Swing the nose round in reverse, then drive out toward the open side.
      drive(game, 1.5, { ...KEYS, down: true, left: true }, watch);
      drive(game, 3, () => {
        const err = Math.atan2(Math.sin(out - game.car.heading), Math.cos(out - game.car.heading));
        return { ...KEYS, up: true, left: err < -0.05, right: err > 0.05 };
      }, watch);
      assert.ok(game.car.speed > 5, `${name}: driving away at ${game.car.speed.toFixed(1)} m/s`);
      assert.ok(clearance(game.car) > 8, `${name}: ${clearance(game.car).toFixed(1)} m clear`);
      assert.ok(watch.minClear >= R - 1e-6);
    }
  }
});

test('loading bays, slab joints and corner boards are never solid', () => {
  const { props, boards } = buildDockyardScenery(dock);
  const lanes = [
    ...props.filter((p) => p.kind === 'loading').map((p) => ({ x: p.x - p.w / 2 - 6, y: p.y, heading: 0, length: p.w + 12 })),
    ...boards.map((b) => ({ x: b.x - b.w / 2 - 6, y: b.y, heading: 0, length: b.w + 12 })),
    { x: -24, y: 30, heading: Math.PI / 2, length: 40 }, // across the slab joints at x = -24
  ];
  for (const lane of lanes) {
    const game = placed(dock, { ...lane, speed: 20 });
    const watch = drive(game, lane.length / 20, { ...KEYS, up: true });
    assert.deepEqual(watch.hits, [], `at ${lane.x},${lane.y}`);
  }
});

test('contact is deterministic and the same at any frame rate', () => {
  const crash = (frame) => {
    const game = placed(dock, { ...STACK, heading: 10 * DEG, speed: 28 }, power);
    // Input is held per frame, so it changes on a step every frame rate here lands on.
    while (game.ticks < 600) advance(game, frame, { ...KEYS, up: true, right: game.ticks >= 240 });
    const { car, lastContact, scoring } = game;
    return { ticks: game.ticks, car: { ...car }, lastContact, score: scoring.score };
  };
  const a = crash(1 / 60);
  assert.ok(a.lastContact, 'it hit');
  assert.deepEqual(crash(1 / 60), a, 'twice the same');
  assert.deepEqual(crash(1 / 120), a, 'at 120 Hz');
  assert.deepEqual(crash(1 / 30), a, 'at 30 Hz');
});

// --- 3. Scoring and laps ---------------------------------------------------------------------
const drifting = (over = {}) => ({ speed: 25, forwardSpeed: 20, slipAngle: -35 * DEG, surface: 'road', offCourse: false, progressRate: 22, newGround: 25 * dt, handbrake: false, impact: 0, ...over });

test('off the course is the rules\' own question: an explicit flag wins, and without one grass is off', () => {
  assert.equal(isOffCourse({ surface: 'concrete', offCourse: true }), true);
  assert.equal(isOffCourse({ surface: 'concrete', offCourse: false }), false);
  assert.equal(isOffCourse({ surface: 'grass' }), true, 'gymkhana and older callers');
  assert.equal(isOffCourse({ surface: 'road' }), false);
  assert.equal(isOffCourse({ surface: 'concrete' }), false, 'a paved surface alone is not off the course');
  assert.equal(classifyDrift(drifting({ surface: 'concrete', offCourse: true }), false, 0), 'off road');
  assert.equal(classifyDrift(drifting({ surface: 'concrete', offCourse: false }), false, 0), 'drifting');
});

test('drifting on off-course concrete pays nothing, and loses a live combo after 1.5 seconds', () => {
  const offCourse = drifting({ surface: 'concrete', offCourse: true });
  const fresh = createScoring();
  for (let i = 0; i < steps(3); i += 1) updateScoring(fresh, offCourse, dt);
  assert.equal(fresh.combo, null);
  assert.equal(fresh.score, 0);

  const state = createScoring();
  for (let i = 0; i < steps(1); i += 1) updateScoring(state, drifting(), dt);
  const points = state.combo.points;
  for (let i = 0; i < steps(1.45); i += 1) updateScoring(state, offCourse, dt);
  assert.ok(state.combo, 'still alive at 1.45 s');
  assert.equal(state.combo.points, points, 'and earned nothing out there');
  for (let i = 0; i < steps(0.1); i += 1) updateScoring(state, offCourse, dt);
  assert.equal(state.combo, null);
  assert.deepEqual([state.event.type, state.event.reason], ['lost', 'off the track']);
  assert.equal(state.score, 0, 'not banked');
});

test('in the game, a slide on Dockyard\'s apron is "off road" and scores nothing, however sideways', () => {
  for (const [, mode] of MODES) {
    const game = placed(dock, { x: 60, y: -112, heading: 0, speed: 25 }, mode);
    let pays = 0;
    for (let i = 0; i < steps(3); i += 1) {
      tick(game, { ...KEYS, up: true, right: true, handbrake: i % 120 < 30 });
      if (game.car.surface === 'concrete' && !game.onCourse && game.scoring.qualification === 'off road') pays += 1;
    }
    assert.ok(pays > 0, 'it was sliding on the apron');
    assert.equal(game.scoring.combo, null);
    assert.equal(game.scoring.score, 0);
  }
});

test('a hard hit on scenery loses the unbanked combo; a light touch keeps it', () => {
  const withCombo = (game) => {
    game.scoring.combo = { points: 400, tier: 2, grace: T.comboGrace, tierGround: 0, linkGround: 0, stallTimer: 0, stallGround: 0, side: 1 };
    game.lapScoreStart = 0;
    return game;
  };
  const hard = withCombo(placed(dock, { x: 99 - R - 3, y: -38, heading: 0, speed: 25 }));
  drive(hard, 0.5, KEYS);
  assert.ok(hard.lastContact.impact >= T.barrierSignificantImpact);
  assert.equal(hard.scoring.combo, null);
  assert.deepEqual([hard.scoring.event.type, hard.scoring.event.reason], ['lost', 'hit an obstacle']);
  assert.equal(hard.scoring.score, 0);

  const light = withCombo(placed(dock, { x: 99 - R - 0.4, y: -38, heading: 0, speed: 4 }));
  const watch = drive(light, 0.4, KEYS);
  assert.ok(watch.hits.length > 0 && Math.max(...watch.hits) < T.barrierSignificantImpact);
  assert.ok(light.scoring.combo, 'the combo survives a nudge');
});

test('drifting on a line 20 m outside every corner: no point is paid off the course, and every lap still counts', () => {
  for (const [, mode] of MODES) {
    const game = createGame(dock, { handling: mode });
    startRun(game, { track: dock, handling: mode });
    const driver = onLine(() => driftDriver(), outsideControl(dock, 20));
    let offTime = 0;
    let offPay = 0;
    let last = 0;
    while (game.state !== 'finished' && game.ticks < steps(300)) {
      tick(game, driver(game));
      const pts = game.scoring.combo?.points ?? 0;
      if (!game.onCourse) { offTime += dt; if (pts > last) offPay += pts - last; }
      last = pts;
    }
    assert.equal(game.state, 'finished');
    assert.ok(offTime > 60, `${offTime.toFixed(0)} s off the course`);
    assert.equal(offPay, 0);
    assert.equal(game.laps.voided, 0, 'running wide on concrete never voids');
  }
});

test('on concrete the obvious shortcuts still void: across the Hook, the infield and the Basin', () => {
  for (const [name, [from, to]] of Object.entries({ 'quay to the acceleration zone': [100, 340], 'Basin exit across the infield to the chicane': [760, 470], 'across the Basin': [560, 780] })) {
    for (const [, mode] of MODES) {
      const game = createGame(dock, { handling: mode });
      startRun(game, { track: dock, handling: mode });
      const driver = onLine(() => gripDriver(), chordControl(dock, from, to));
      while (game.state !== 'finished' && game.ticks < steps(120)) tick(game, driver(game));
      assert.equal(game.laps.completed, 0, `${name} (${mode.id}): ${game.laps.completed} counted, ${game.laps.voided} voided`);
    }
  }
});

test('the chicane cannot be straight-lined across the concrete for a faster counted lap', {
  todo: 'R1 known limitation: on concrete, cutting the chicane (s 360 to 560) counts and is about 1.6 s faster; see docs/ENVIRONMENT-R1.md',
}, () => {
  const lap = (control) => {
    const game = createGame(dock, { handling: classic });
    startRun(game, { track: dock, handling: classic });
    const driver = onLine(() => gripDriver(), control);
    while (game.state !== 'finished' && game.ticks < steps(150)) tick(game, driver(game));
    return game.laps.bestLap ?? Infinity;
  };
  const road = lap(chordControl(dock, 0, 1));
  const cut = lap(chordControl(dock, 360, 560));
  assert.ok(cut > road - 0.5, `cut ${cut.toFixed(2)} s against the road's ${road.toFixed(2)} s`);
});

test('circling on the apron beside the road, across its edge and back, earns nothing', () => {
  for (const [, mode] of MODES) {
    const p = dock.points[40];
    const game = placed(dock, { x: p.x - p.ty * 12, y: p.y + p.tx * 12, heading: 0, speed: 16 }, mode);
    for (let i = 0; i < steps(12); i += 1) tick(game, { ...KEYS, up: true, right: true, handbrake: i % 240 < 40 });
    assert.ok(countedScore(game) < 50, `${countedScore(game)} points`);
  }
});

// --- 4. Everything else is unchanged ------------------------------------------------------------
// v0.6.0 R2 gave Original and Switchback solid scenery on purpose (test/scenery-r2.test.mjs checks
// it). What R1 pinned here still holds for them: no new surface, grass beyond the curbs. The practice
// pad and the gymkhana pads still have no solids at all.
test('the practice pad and every gymkhana pad have no solid scenery, and no circuit but Dockyard has a new surface', () => {
  const pad = padTrack();
  for (const track of [pad, ...[PRECISION_180, LINKED_DRIFT, ONE_DRIFT, SLALOM_SPRINT].map((c) => c.track)]) {
    assert.deepEqual(obstaclesFor(track), [], track.id);
    const game = createGame(track);
    startRun(game, { track });
    assert.deepEqual(game.obstacles, [], `${track.id}: no boxes in its session`);
    assert.notEqual(track.apron, 'concrete');
  }
  for (const track of [original, switchback]) {
    assert.equal(track.apron, 'grass', `${track.id}: grass beyond the curbs, as in v0.5.0`);
    const game = createGame(track);
    startRun(game, { track });
    assert.equal(game.obstacles, obstaclesFor(track), `${track.id}: its session has its R2 scenery`);
  }
  assert.equal(surfaceAt(pad, 300, 300), 'road', 'the pad is all road');
});

test('a full drift run on Original or Switchback never meets solid scenery', () => {
  for (const track of [original, switchback]) {
    for (const [, mode] of MODES) {
      const game = createGame(track, { handling: mode });
      startRun(game, { track, handling: mode });
      const driver = driftDriver();
      while (game.state !== 'finished' && game.ticks < steps(400)) tick(game, driver(game));
      assert.equal(game.state, 'finished');
      assert.equal(game.lastContact, null);
    }
  }
});
