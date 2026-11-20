// Getaway Drift in town (EXPERIMENTAL, v0.7.0 R4B research): street geometry and collision, the
// police car on the street network, breakable scenery, cameras and medals, and isolation from
// everything that ships.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TUNING } from '../src/tuning.js';
import { createGame, startRun, tick } from '../src/game.js';
import { createScoring } from '../src/scoring.js';
import { handlingById } from '../src/handling.js';
import { GYMKHANA_CHALLENGES } from '../src/gymkhana.js';
import { obstaclesFor, resolveObstacles } from '../src/obstacles.js';
import { padTrack } from '../src/practice-pad.js';
import {
  CITY_LAYOUTS, buildCity, locate, route, routeToGate, lineOfSight, onPavement, streetClearance, segmentHitsBox, insideRect,
} from '../src/getaway-city.js';
import { createUrbanChallenge, cityFor, URBAN_PURSUER, URBAN_TIERS, PURSUIT_MODES, BREAKABLE, SHOWMANSHIP } from '../src/getaway-urban.js';
import { getawayExtras, URBAN_DEFAULT_TIME } from '../src/getaway-entry.js';
import { driveUrban, urbanGrip, urbanDrift, urbanStall, urbanBank } from './support/urban-drivers.mjs';

const CLASSIC = handlingById('classic');
const POWER = handlingById('revised');
const DT = TUNING.simStep;
const R = TUNING.carRadius;
const PARKED = { delay: 1e9 };          // the police car never sets off: geometry and camera tests
const VARIANTS = ['downtown', 'industrial'];
const area = (b) => (b.maxX - b.minX) * (b.maxY - b.minY);

// A session on a city with the police car parked, the car placed and pointed by hand.
function session(variant, { at, heading, pursuit = 'intercept', pursuer = PARKED, handling = CLASSIC, showmanship = true } = {}) {
  const def = createUrbanChallenge({ variant, pursuit, pursuer, timeLimit: 300, showmanship });
  const game = createGame(undefined, { handling });
  startRun(game, { mode: 'gymkhana', ghost: false, handling, challenge: def });
  if (at) {
    game.car.x = at[0];
    game.car.y = at[1];
    game.car.heading = heading ?? 0;
    game.prev.x = at[0];
    game.prev.y = at[1];
    game.challenge.edge = -1;
  }
  return { def, game, city: def.geometry.city };
}
const insideSolid = (city, x, y, r = 0) => city.colliders.some((c) => x > c.minX - r + 1e-6 && x < c.maxX + r - 1e-6 && y > c.minY - r + 1e-6 && y < c.maxY + r - 1e-6
  && Math.hypot(x - Math.max(c.minX, Math.min(c.maxX, x)), y - Math.max(c.minY, Math.min(c.maxY, y))) < r - 0.05);

// --- Street geometry ------------------------------------------------------------------------------

test('geometry: the buildings are exactly what is not paved: no overlap, no gap, no invisible wall', () => {
  for (const v of VARIANTS) {
    const city = cityFor(v);
    // Sample a grid: every point is either paved (and in no building) or in a building (and not paved).
    const b = city.bounds;
    let paved = 0;
    let built = 0;
    for (let x = b.minX + 0.37; x < b.maxX; x += 1.3) {
      for (let y = b.minY + 0.41; y < b.maxY; y += 1.3) {
        const p = onPavement(city, x, y);
        const h = city.buildings.some((r) => insideRect(r, x, y));
        assert.notEqual(p, h, `${v}: (${x.toFixed(1)}, ${y.toFixed(1)}) paved ${p}, building ${h}`);
        if (p) paved += 1; else built += 1;
      }
    }
    assert.ok(paved > 1000 && built > 1000, `${v}: both present`);
    // The boxes themselves never overlap each other.
    for (let i = 0; i < city.buildings.length; i += 1) for (let j = i + 1; j < city.buildings.length; j += 1) {
      const p = city.buildings[i];
      const q = city.buildings[j];
      const overlap = Math.min(p.maxX, q.maxX) - Math.max(p.minX, q.minX) > 1e-6 && Math.min(p.maxY, q.maxY) - Math.max(p.minY, q.minY) > 1e-6;
      assert.ok(!overlap, `${v}: buildings ${i} and ${j} overlap`);
    }
    // And the session collides with exactly these solids.
    const { game } = session(v);
    assert.equal(game.obstacles, city.colliders);
    assert.equal(obstaclesFor(game.track), city.colliders);
  }
});

test('geometry: every street is axis-aligned, its centre line clear of props by at least 3 m, and every objective reachable from the start', () => {
  for (const v of VARIANTS) {
    const city = cityFor(v);
    for (const e of city.edges) assert.ok(e.ax === e.bx || e.ay === e.by, `${v}: ${e.id}`);
    const clear = streetClearance(city);
    assert.ok(clear.worst >= 3 - 1e-9, `${v}: ${clear.worst.toFixed(2)} m at ${JSON.stringify(clear.where)}`);
    // The start, every camera's approach and the exit are connected without smashing anything.
    const start = locate(city, city.start.x, city.start.y);
    for (const gate of [...city.cameras, city.exit]) assert.ok(routeToGate(city, start, gate), `${v}: route to ${gate.kind} ${gate.number}`);
    // Every junction is reachable once the barricades are open; with them shut, all but the far
    // side of a blockade's dead-end stub still are.
    const nodes = Object.keys(city.nodes);
    for (const id of nodes) {
      const n = city.nodes[id];
      const e = city.edges[n.edges[0]];
      assert.ok(route(city, start, { edge: e.index, t: e.a === id ? 0 : e.len }, { throughBarricades: true }), `${v}: ${id}`);
    }
  }
});

test('geometry: documented dimensions (street widths, junction spacing, cameras, exit) are what the layouts build', () => {
  const d = cityFor('downtown');
  const i = cityFor('industrial');
  const widths = (c) => [...new Set(c.edges.map((e) => e.width))].sort((a, b) => a - b);
  assert.deepEqual(widths(d), [10, 16, 20]);
  assert.deepEqual(widths(i), [14, 20, 26, 44]);
  assert.equal(d.cameras.length, 4);
  assert.equal(i.cameras.length, 4);
  assert.deepEqual([d.exit.from, d.exit.to], ['A3', 'E']);
  assert.deepEqual([i.exit.from, i.exit.to], ['N03', 'X']);
  // Downtown's blocks: junctions 85-95 m apart along the grid.
  const grid = d.edges.filter((e) => !['alley', 'deadend'].includes(e.kind) && !['S', 'E'].includes(e.a) && !['S', 'E'].includes(e.b));
  for (const e of grid) assert.ok(e.len >= 40 && e.len <= 95, `${e.id} ${e.len}`);
  assert.equal(d.edges.filter((e) => e.kind === 'alley').length, 2);
  assert.equal(d.edges.filter((e) => e.kind === 'deadend').length, 1);
  assert.equal(i.edges.filter((e) => e.kind === 'deadend').length, 1);
});

test('collision: a car driven flat out at a building stops at its wall, at every speed, and never ends up inside', () => {
  for (const v of VARIANTS) {
    const city = cityFor(v);
    // Straight at the end wall of the dead end, and straight at a block corner across a junction.
    const de = city.edges.find((e) => e.kind === 'deadend');
    const endNode = city.nodes[city.nodes[de.b].edges.length === 1 ? de.b : de.a];
    const from = city.nodes[endNode.id === de.a ? de.b : de.a];
    const heading = Math.atan2(endNode.y - from.y, endNode.x - from.x);
    for (const speed of [8, 20, 42]) {
      const { game } = session(v, { at: [from.x, from.y], heading });
      game.car.vx = Math.cos(heading) * speed;
      game.car.vy = Math.sin(heading) * speed;
      let worst = 0;
      for (let k = 0; k < 600; k += 1) {
        tick(game, { up: true, down: false, left: false, right: false, handbrake: false });
        for (const c of city.colliders) {
          const nx = Math.max(c.minX, Math.min(c.maxX, game.car.x));
          const ny = Math.max(c.minY, Math.min(c.maxY, game.car.y));
          worst = Math.max(worst, R - Math.hypot(game.car.x - nx, game.car.y - ny));
        }
      }
      assert.ok(worst < 0.05, `${v} at ${speed} m/s: ${worst.toFixed(3)} m into a wall`);
      assert.ok(onPavement(city, game.car.x, game.car.y), `${v} at ${speed}: still on the pavement`);
    }
  }
});

test('collision: no tunnelling through the thinnest solids (1.6 m barriers, 4 m blockades) at top speed', () => {
  const city = cityFor('industrial');
  for (const solid of [...city.props.filter((p) => p.kind === 'barrier'), ...city.blockades]) {
    const cx = (solid.minX + solid.maxX) / 2;
    const cy = (solid.minY + solid.maxY) / 2;
    const thinX = solid.maxX - solid.minX < solid.maxY - solid.minY;
    // Fire a car at it, across its thin side, at 45 m/s, from 6 m away.
    for (const s of [-1, 1]) {
      const car = thinX ? { x: cx - s * 6, y: cy, vx: s * 45, vy: 0, yawRate: 0 } : { x: cx, y: cy - s * 6, vx: 0, vy: s * 45, yawRate: 0 };
      for (let k = 0; k < 40; k += 1) {
        const ax = car.x;
        const ay = car.y;
        car.x += car.vx * DT;
        car.y += car.vy * DT;
        resolveObstacles(car, [solid], ax, ay);
      }
      const passed = thinX ? Math.sign(car.x - cx) === s : Math.sign(car.y - cy) === s;
      assert.ok(!passed, `${solid.kind}: went through from side ${s}`);
    }
  }
});

test('blockades: wall to wall, so no gap past one, and both the guidance and the police route round them', () => {
  for (const v of VARIANTS) {
    const city = cityFor(v);
    assert.equal(city.blockades.length, 1, v);
    for (const bl of city.blockades) {
      const e = city.edges[bl.edge];
      const across = e.horizontal ? [bl.minY, bl.maxY] : [bl.minX, bl.maxX];
      const street = e.horizontal ? [e.ay - e.half, e.ay + e.half] : [e.ax - e.half, e.ax + e.half];
      assert.deepEqual(across, street, `${v}: spans the street exactly`);
      // Points just either side of it, along its street, are not joined except the long way round.
      const t1 = bl.at - 6;
      const t2 = bl.at + 6;
      const r = route(city, { edge: e.index, t: t1 }, { edge: e.index, t: t2 });
      assert.ok(r, `${v}: there is a way round`);
      assert.ok(r.length > 100, `${v}: and it is the long way (${r.length.toFixed(0)} m), not through`);
      // No planned route passes through it.
      for (const gate of [...city.cameras, city.exit]) {
        const g = routeToGate(city, locate(city, city.start.x, city.start.y), gate);
        for (let k = 1; k < g.points.length; k += 1) {
          assert.ok(!segmentHitsBox(...g.points[k - 1], ...g.points[k], bl, -0.01), `${v}: guidance to ${gate.kind} ${gate.number} through the blockade`);
        }
      }
    }
  }
});

test('dead ends: drive in, turn round, and drive out again on the guidance', () => {
  for (const v of VARIANTS) {
    const city = cityFor(v);
    const de = city.edges.find((e) => e.kind === 'deadend');
    const leaf = city.nodes[de.b].edges.length === 1 ? de.b : de.a;
    const mouth = leaf === de.a ? de.b : de.a;
    const L = city.nodes[leaf];
    const M = city.nodes[mouth];
    // Parked deep in it, nose to the end wall: the guide leads out by the mouth.
    const inside = [L.x + (M.x - L.x) * 0.25, L.y + (M.y - L.y) * 0.25];
    const { def, game } = session(v, { at: inside, heading: Math.atan2(L.y - M.y, L.x - M.x) });
    const drive = urbanGrip({ lateral: 9 });
    let out = false;
    for (let k = 0; k < Math.round(25 / DT) && !out; k += 1) {
      tick(game, drive(game));
      out = Math.hypot(game.car.x - M.x, game.car.y - M.y) < de.half + 2 && game.challenge.edge !== de.index;
    }
    assert.ok(out, `${v}: got out of the dead end (car at ${game.car.x.toFixed(0)}, ${game.car.y.toFixed(0)})`);
    assert.equal(def.id, `getaway-urban-${v}`);
  }
});

// --- Cameras, the escape gate, medals ---------------------------------------------------------------

// Moves a hand-placed car in a straight line from a to b, one tick at a time, at `speed`.
function slide(game, a, b, speed = 15) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const h = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const steps = Math.max(1, Math.ceil(len / (speed * DT)));
  const { car } = game;
  car.x = a[0];
  car.y = a[1];
  for (let k = 1; k <= steps; k += 1) {
    const ax = car.x;
    const ay = car.y;
    car.x = a[0] + (b[0] - a[0]) * (k / steps);
    car.y = a[1] + (b[1] - a[1]) * (k / steps);
    car.vx = Math.cos(h) * speed;
    car.vy = Math.sin(h) * speed;
    car.heading = h;
    car.speed = speed;
    car.forwardSpeed = speed;
    car.slipAngle = 0;
    game.ticks += 1;
    game.challengeDef.step(game.challenge, game, ax, ay, 0);
  }
}
const through = (cam, sign = 1, d = 12) => [[cam.cx - cam.tx * d * sign, cam.cy - cam.ty * d * sign], [cam.cx + cam.tx * d * sign, cam.cy + cam.ty * d * sign]];
function rigged(v, missPolicy = 'recover') {
  const def = createUrbanChallenge({ variant: v, pursuer: PARKED, missPolicy, timeLimit: 300 });
  const scoring = createScoring();
  const car = { x: 0, y: 0, vx: 0, vy: 0, speed: 0, forwardSpeed: 0, slipAngle: 0, handbrake: false, heading: 0, yawRate: 0 };
  const game = { car, scoring, challengeDef: def, challenge: def.createRun(), ticks: 0 };
  return { def, game, run: game.challenge, city: def.geometry.city };
}

test('cameras: in order, forwards, each once; a reverse crossing films nothing', () => {
  for (const v of VARIANTS) {
    const { game, run, city } = rigged(v);
    const [c1, c2] = city.cameras;
    slide(game, ...through(c1, -1));
    assert.equal(run.nextCamera, 0, `${v}: backwards through camera 1 films nothing`);
    assert.equal(run.wrongWay, 1);
    slide(game, ...through(c1));
    assert.equal(run.nextCamera, 1, `${v}: forwards takes its shot`);
    assert.equal(run.event.type, 'shot');
    slide(game, ...through(c1, -1));
    slide(game, ...through(c1));
    assert.equal(run.nextCamera, 1, `${v}: filmed once`);
    slide(game, ...through(c2));
    assert.equal(run.nextCamera, 2);
    assert.equal(game.scoring.score, 0, 'no points for a camera');
  }
});

test('cameras: a later camera first is out of order; recover keeps the skipped one next and the gate shut, and going back for it works', () => {
  const { game, run, city } = rigged('industrial');
  const [c1, c2, c3, c4] = city.cameras;
  slide(game, ...through(c1));
  slide(game, ...through(c3));
  assert.equal(run.nextCamera, 1, 'camera 3 first: no shot');
  assert.equal(run.missed[1], true);
  assert.equal(run.missedShots, 1);
  assert.equal(run.event.type, 'missed');
  assert.deepEqual([run.event.camera, run.event.crossed], [2, 3]);
  assert.equal(run.phase, 'running');
  // The guidance now leads back to camera 2.
  game.challengeDef.step(run, game, game.car.x, game.car.y, 0);
  run.guideIn = 0;
  game.challengeDef.step(run, game, game.car.x, game.car.y, 0);
  const last = run.guide.points[run.guide.points.length - 1];
  assert.ok(Math.hypot(last[0] - (c2.cx + c2.tx * 6), last[1] - (c2.cy + c2.ty * 6)) < 1e-6, 'guide ends through camera 2');
  // The exit is shut until all four.
  slide(game, ...through(city.exit));
  assert.equal(run.phase, 'running');
  assert.equal(run.lockedTries, 1);
  for (const cam of [c2, c3, c4]) slide(game, ...through(cam));
  assert.equal(run.exitOpen, true);
  slide(game, ...through(city.exit));
  assert.equal(run.phase, 'complete');
  assert.equal(run.result.value, 0);
  assert.equal(run.result.missedShots, 1);
});

test('cameras: under the strict policy a later camera first cancels the upload', () => {
  const { game, run, city } = rigged('downtown', 'strict');
  slide(game, ...through(city.cameras[0]));
  slide(game, ...through(city.cameras[2]));
  assert.equal(run.phase, 'failed');
  assert.equal(run.reason, 'missed camera 2');
  assert.equal(run.result.value, null);
});

test('medals: a zero-point escape is Bronze; Silver and Gold need banked points; Classic and Power targets differ; a bust earns nothing', async () => {
  const { medalFor } = await import('../src/medals.js');
  for (const v of VARIANTS) {
    const def = createUrbanChallenge({ variant: v });
    const c = def.medalTargets.classic;
    const p = def.medalTargets.revised;
    assert.equal(c.bronze, 0);
    assert.ok(c.silver > 0 && c.gold > c.silver);
    assert.ok(p.silver > c.silver && p.gold > c.gold, `${v}: Power asks more`);
    // medals.js knows nothing of it.
    assert.equal(medalFor(def, 'classic', 5000), null);
  }
  // Through the real session: a clean grip escape, nothing banked.
  const def = createUrbanChallenge({ variant: 'downtown', pursuer: PARKED });
  const { result } = driveUrban(def, CLASSIC, urbanGrip({ lateral: 9 }));
  assert.equal(result.ended, 'escaped');
  assert.equal(result.value, result.score + result.smashBonus, 'R4C: Showmanship = banked drift + destruction bonus');
  const busted = driveUrban(createUrbanChallenge({ variant: 'downtown' }), CLASSIC, urbanStall(urbanGrip(), { after: 120, seconds: 6 }));
  assert.equal(busted.result.ended, 'busted');
  assert.equal(busted.result.value, null);
});

test('time limit: the run fails when it runs out', () => {
  const def = createUrbanChallenge({ variant: 'downtown', pursuer: PARKED, timeLimit: 60 });
  const game = createGame(undefined, { handling: CLASSIC });
  startRun(game, { mode: 'gymkhana', ghost: false, handling: CLASSIC, challenge: def });
  for (let k = 0; k < Math.round(61 / DT) && game.state !== 'finished'; k += 1) tick(game, { up: k < 5, down: false, left: false, right: false, handbrake: false });
  assert.equal(game.challenge.reason, 'out of time');
  assert.equal(URBAN_DEFAULT_TIME, 120);
});

// --- Scoring in town --------------------------------------------------------------------------------

test('scoring: every street metre pays once: a second pass down the same street, or circling, earns no new ground', () => {
  const { game, run, city } = rigged('downtown');
  const e = city.edges.find((x) => x.a === 'D0' && x.b === 'D1');
  const a = [e.ax + 10, e.ay];
  const b = [e.ax + 70, e.ay];
  slide(game, a, b);
  const first = run.ground;
  assert.ok(first >= 59 && first <= 62, `first pass ${first}`);
  slide(game, b, a);
  slide(game, a, b);
  assert.equal(run.ground, first, 'nothing new the second and third time');
  // A circle in the junction square covers a few metres once, then nothing.
  const D1 = city.nodes.D1;
  const pts = Array.from({ length: 73 }, (_, k) => [D1.x + Math.cos(k / 12 * Math.PI) * 6, D1.y + Math.sin(k / 12 * Math.PI) * 6]);
  for (let k = 1; k < pts.length; k += 1) slide(game, pts[k - 1], pts[k], 10);
  const afterOne = run.ground;
  for (let k = 1; k < pts.length; k += 1) slide(game, pts[k - 1], pts[k], 10);
  assert.equal(run.ground, afterOne, 'the second lap of the circle covers nothing new');
});

test('scoring: drifting pays through the real session in both modes, and a donut farms nothing', () => {
  // The scripted drifter is erratic in Power (one setting's score is no measure), so the best of three.
  for (const handling of [CLASSIC, POWER]) {
    const scores = [9.5, 10, 11].map((lateral) => {
      const { result } = driveUrban(createUrbanChallenge({ variant: 'industrial', pursuer: PARKED }), handling, urbanDrift({ lateral, tapSpeed: handling === POWER ? 13 : 11 }));
      assert.equal(result.ended, 'escaped');
      return result.score;
    });
    assert.ok(Math.max(...scores) > 300, `${handling.id}: ${scores}`);
  }
  // Circling on the spot: no new ground, so no points while doing it.
  const { game } = session('industrial', { at: [-40, 330], heading: 0 });
  for (let k = 0; k < Math.round(12 / DT); k += 1) tick(game, { up: true, down: false, left: false, right: true, handbrake: k % 120 < 60 });
  assert.ok(game.scoring.score + (game.scoring.combo ? game.scoring.combo.points : 0) < 60, `donut: ${game.scoring.score}`);
});

// --- Breakables -----------------------------------------------------------------------------------

test('breakables: a smash breaks it once, costs a share of speed, scores no drift points (R4C: its bonus only), and a restart puts it back', () => {
  for (const v of VARIANTS) {
    const city = cityFor(v);
    for (const br of city.breakables) {
      // Drive straight at it at 20 m/s from 12 m away, across its shorter side where it is a
      // barricade, and along the street for a stand.
      const e = br.edge !== null ? city.edges[br.edge] : null;
      const dir = e ? [e.dx, e.dy] : [0, 1];
      // A stand stands against a wall: come down the street a metre short of its street-side edge,
      // so the car clips it without touching the wall.
      const at = e ? [br.cx - dir[0] * 12, br.cy - dir[1] * 12] : [br.minX - 1, br.cy - 12];
      const { game, def } = session(v, { at, heading: Math.atan2(dir[1], dir[0]) });
      game.car.vx = dir[0] * 20;
      game.car.vy = dir[1] * 20;
      game.state = 'racing';
      let before = null;
      let smashTick = -1;
      for (let k = 0; k < 180; k += 1) {
        const v0 = game.car.speed;
        tick(game, { up: true, down: false, left: false, right: false, handbrake: false });
        if (game.challenge.broken[br.index] && smashTick < 0) { smashTick = k; before = v0; }
      }
      assert.ok(smashTick >= 0, `${v} ${br.kind}: smashed`);
      const hit = game.challenge.broken[br.index];
      assert.equal(hit.by, 'car');
      assert.equal(game.challenge.smashes, 1, `${v} ${br.kind}: broken once`);
      assert.ok(Math.abs(hit.speed - before) < 1.5, 'its record carries the impact speed');
      assert.equal(game.scoring.score, 0, 'no drift points scored');
      assert.equal(game.challenge.smashBonus, SHOWMANSHIP.bonus[br.kind], `${v} ${br.kind}: R4C's bonus, once`);
      // Once broken it is gone: the car is past it, through.
      const past = (game.car.x - at[0]) * dir[0] + (game.car.y - at[1]) * dir[1] - 12;
      assert.ok(past > 0, `${v} ${br.kind}: drove through`);
      // A restart: whole again.
      startRun(game, { mode: 'gymkhana', ghost: false, handling: CLASSIC, challenge: def });
      assert.equal(game.challenge.broken[br.index], null);
      assert.equal(game.challenge.smashes, 0);
      assert.equal(game.challenge.smashBonus, 0);
    }
  }
});

// R4C changed the rule: a smash never ends a combo. R4B's rule (the lost speed counted as an impact)
// is kept behind `showmanship: false` for the research comparison, and still holds there.
test('breakables: the speed cost is the kind\'s share; R4C keeps the combo at any speed, R4B\'s rule (showmanship off) ends it as a wall hit of that size would', () => {
  assert.equal(BREAKABLE.fruit.keep, 0.8);
  assert.equal(BREAKABLE.barricade.keep, 0.62);
  const city = cityFor('downtown');
  const bar = city.breakables.find((b) => b.kind === 'barricade');
  const e = city.edges[bar.edge];
  for (const [speed, comboLost, showmanship] of [[10, false, true], [24, false, true], [10, false, false], [24, true, false]]) {
    const at = [bar.cx - e.dx * 1.2, bar.cy - e.dy * 1.2 - (e.horizontal ? 0 : 3.6 * Math.sign(e.dy))];
    const { game } = session('downtown', { at: [bar.cx - e.dx * 4, bar.cy - e.dy * 4], heading: Math.atan2(e.dy, e.dx), showmanship });
    game.state = 'racing';
    game.car.vx = e.dx * speed;
    game.car.vy = e.dy * speed;
    game.scoring.combo = { points: 100, tier: 0, grace: 2, tierGround: 0, linkGround: 0, stallTimer: 0, stallGround: 0, side: 1 };
    let speedAfter = null;
    for (let k = 0; k < 120 && speedAfter === null; k += 1) {
      tick(game, { up: false, down: false, left: false, right: false, handbrake: false });
      if (game.challenge.broken[bar.index]) speedAfter = game.car.speed;
    }
    assert.ok(speedAfter !== null, `smashed at ${speed}`);
    assert.ok(Math.abs(speedAfter / game.challenge.broken[bar.index].speed - 0.62) < 0.02, `kept 62% (${speedAfter.toFixed(2)})`);
    // R4B: the lost speed is the impact: 38% of 10 m/s is under the 6 m/s that ends a combo; of 24 is over.
    assert.equal(game.scoring.combo === null, comboLost, `${showmanship ? 'R4C' : 'R4B'} at ${speed} m/s the combo ${comboLost ? 'is' : 'is not'} lost`);
    assert.equal(game.challenge.smashBonus, showmanship ? SHOWMANSHIP.bonus.barricade : 0);
    void at;
  }
});

test('breakables: a barricade closes its street to the guidance and the police until smashed, then opens it', () => {
  const city = cityFor('downtown');
  const bar = city.breakables.find((b) => b.kind === 'barricade');
  const e = city.edges[bar.edge];
  const before = route(city, { edge: e.index, t: bar.at - 5 }, { edge: e.index, t: bar.at + 5 });
  const broken = city.breakables.map((b) => b.index === bar.index ? { by: 'car' } : null);
  const after = route(city, { edge: e.index, t: bar.at - 5 }, { edge: e.index, t: bar.at + 5 }, { broken });
  assert.ok(before.length > 100, 'shut: the long way round');
  assert.ok(Math.abs(after.length - 10) < 1e-6, 'smashed: straight through');
  // Debris is a fixed handful of pieces per kind, worked out from the hit, not simulated.
  assert.ok(BREAKABLE.fruit.pieces <= 24 && BREAKABLE.barricade.pieces <= 12);
});

test('breakables: they are not solid colliders (solid things stay solid, and are a separate list)', () => {
  for (const v of VARIANTS) {
    const city = cityFor(v);
    for (const br of city.breakables) assert.ok(!city.colliders.some((c) => c.minX === br.minX && c.minY === br.minY && c.maxX === br.maxX && c.maxY === br.maxY), `${v} ${br.kind}`);
    assert.ok(city.colliders.every((c) => !['fruit', 'barricade'].includes(c.kind)));
  }
});

// --- The police car ------------------------------------------------------------------------------

test('police: within its limits in town, in every mode: no teleport, never past its top speed, no instant turn, never inside a wall', () => {
  for (const v of VARIANTS) for (const pursuit of PURSUIT_MODES) {
    const def = createUrbanChallenge({ variant: v, pursuit });
    const P = def.pursuerTuning;
    let worstStep = 0;
    let worstTurn = 0;
    let worstWall = 0;
    driveUrban(def, CLASSIC, urbanBank(urbanDrift({}), urbanGrip({ cap: 30 })), { onTick: (game) => {
      const p = game.challenge.pursuer;
      worstStep = Math.max(worstStep, Math.hypot(p.x - p.prevX, p.y - p.prevY));
      worstTurn = Math.max(worstTurn, Math.abs(Math.atan2(Math.sin(p.heading - p.prevHeading), Math.cos(p.heading - p.prevHeading))));
      for (const c of def.geometry.city.colliders) {
        const nx = Math.max(c.minX, Math.min(c.maxX, p.x));
        const ny = Math.max(c.minY, Math.min(c.maxY, p.y));
        worstWall = Math.max(worstWall, R - Math.hypot(p.x - nx, p.y - ny));
      }
    } });
    assert.ok(worstStep <= P.vMax * DT + 1e-6, `${v}/${pursuit}: step ${worstStep}`);
    // Steering is capped by its grip and turning circle (at most sqrt(grip / turnRadius) rad/s);
    // a wall scrape may turn it up to 0.5 rad more in one step.
    assert.ok(worstTurn <= 0.5 + Math.sqrt(P.grip / P.turnRadius) * DT + 1e-6, `${v}/${pursuit}: turn ${worstTurn}`);
    assert.ok(worstWall < 0.05, `${v}/${pursuit}: ${worstWall.toFixed(3)} m into a wall`);
  }
});

test('police: it respects the blockade and intact barricades: it never crosses either', () => {
  for (const v of VARIANTS) for (const pursuit of ['network', 'intercept', 'trail']) {
    const def = createUrbanChallenge({ variant: v, pursuit });
    const city = def.geometry.city;
    let crossed = 0;
    driveUrban(def, CLASSIC, urbanDrift({}), { onTick: (game) => {
      const p = game.challenge.pursuer;
      for (const bl of city.blockades) if (segmentHitsBox(p.prevX, p.prevY, p.x, p.y, bl, 1.0)) crossed += 1;
    } });
    assert.equal(crossed, 0, `${v}/${pursuit}`);
  }
});

test('police: routing is street-aware: it plans round a blockade, and a plan never runs through a building', () => {
  for (const v of VARIANTS) {
    const def = createUrbanChallenge({ variant: v, pursuit: 'network' });
    const city = def.geometry.city;
    let plans = 0;
    driveUrban(def, CLASSIC, urbanGrip(), { onTick: (game) => {
      const p = game.challenge.pursuer;
      if (!p.path || p.replanIn !== def.pursuerTuning.replan) return;
      plans += 1;
      for (let k = 2; k < p.path.length; k += 1) {
        const [ax, ay] = p.path[k - 1];
        const [bx, by] = p.path[k];
        assert.ok(!city.colliders.some((c) => segmentHitsBox(ax, ay, bx, by, c, -0.5)), `${v}: plan leg ${k} through a solid`);
      }
    } });
    assert.ok(plans > 50, `${v}: planned ${plans} times`);
  }
});

test('police: it never stalls: across both layouts and all modes, never stuck more than 2 s, and a stopped car is busted', () => {
  for (const v of VARIANTS) for (const pursuit of PURSUIT_MODES) {
    for (const drive of [urbanGrip(), urbanDrift({}), urbanStall(urbanGrip(), { after: 150, seconds: 6 })]) {
      const { result, run } = driveUrban(createUrbanChallenge({ variant: v, pursuit }), CLASSIC, drive);
      assert.ok(run.pursuer.longestStuck < 2, `${v}/${pursuit}: stuck ${run.pursuer.longestStuck.toFixed(2)} s`);
      void result;
    }
    const stalled = driveUrban(createUrbanChallenge({ variant: v, pursuit }), CLASSIC, urbanStall(urbanGrip(), { after: 150, seconds: 6 }));
    assert.equal(stalled.result.ended, 'busted', `${v}/${pursuit}: a car that stops is caught`);
  }
});

test('police: a reversing car is followed, and the police car backs off a wall it is pinned against', () => {
  const { game } = session('downtown', { pursuer: {}, pursuit: 'network' });
  // Drive off, then reverse for a while: the police car must come round to it.
  for (let k = 0; k < Math.round(4 / DT); k += 1) tick(game, { up: true, down: false, left: false, right: false, handbrake: false });
  let minGap = Infinity;
  for (let k = 0; k < Math.round(8 / DT) && game.state !== 'finished'; k += 1) {
    tick(game, { up: false, down: true, left: false, right: false, handbrake: false });
    minGap = Math.min(minGap, game.challenge.gap);
  }
  assert.ok(minGap < 9, `reached it: ${minGap.toFixed(1)} m`);
});

test('police: it reaches threatening range of a cautious driver, and a clean full-pace grip driver can still escape', () => {
  let close = 0;
  let gripEscapes = 0;
  for (let seed = 0; seed < 4; seed += 1) {
    for (const v of VARIANTS) {
      // A careful driver who never goes above 18 m/s (65 km/h): the police car catches up.
      const careful = driveUrban(createUrbanChallenge({ variant: v, pursuer: { delay: 1 + seed * 0.05 } }), CLASSIC, urbanGrip({ lateral: 9, cap: 18 - seed * 0.5 }));
      if (careful.result.minGap < 9) close += 1;
      const grip = driveUrban(createUrbanChallenge({ variant: v, pursuer: { delay: 1 + seed * 0.05 } }), CLASSIC, urbanGrip({ lateral: 10 - seed * 0.1 }));
      if (grip.result.ended === 'escaped') gripEscapes += 1;
    }
  }
  assert.ok(close >= 6, `the police got within 9 m of a careful driver in ${close} of 8`);
  assert.equal(gripEscapes, 8, 'every clean full-pace grip run escaped');
});

test('capture: the meter needs a line of sight: a police car on the far side of a building does not fill it', () => {
  // The car just up column 1 from D1, the police car just along row D from it: 8.9 m apart, with
  // the corner of the block between them.
  const { game, def, city } = session('downtown', { at: [89, 211], heading: -Math.PI / 2 });
  const p = game.challenge.pursuer;
  p.x = 82.8;
  p.y = 217.4;
  assert.equal(lineOfSight(city, p.x, p.y, game.car.x, game.car.y), false, 'no line of sight');
  game.challenge.time = 2;
  for (let k = 0; k < 60; k += 1) def.step(game.challenge, game, game.car.x, game.car.y, 0);
  assert.ok(Math.hypot(p.x - game.car.x, p.y - game.car.y) < def.captureModel.radius);
  assert.equal(game.challenge.meter, 0);
  assert.equal(game.challenge.sees, false);
});

test('chases are deterministic: the same inputs give the same run', () => {
  const run = () => driveUrban(createUrbanChallenge({ variant: 'industrial' }), POWER, urbanDrift({ lateral: 10, tapSpeed: 13 })).result;
  assert.deepEqual(run(), run());
});

// --- Isolation ------------------------------------------------------------------------------------

test('isolation: the four challenges are untouched, a city run is never a record, and the switch is off unless asked for', () => {
  assert.deepEqual(GYMKHANA_CHALLENGES.map((c) => c.id), ['precision-180', 'linked-drift', 'one-drift', 'slalom-sprint']);
  for (const c of GYMKHANA_CHALLENGES) assert.deepEqual(obstaclesFor(c.track), [], `${c.id}: no solids`);
  assert.deepEqual(obstaclesFor(padTrack()), []);
  for (const file of ['getaway-city.js', 'getaway-urban.js', 'getaway-urban-draw.js', 'getaway-entry.js']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|setItem/, file);
  }
  assert.deepEqual(getawayExtras(''), []);
  const two = getawayExtras('?getaway');
  assert.deepEqual(two.map((d) => [d.id, d.shortName, d.experimental, d.pursuit, d.tier, d.missPolicy, d.timeLimit]),
    [['getaway-urban-downtown', 'Getaway · Downtown', true, 'network', 'standard', 'recover', 120],
      ['getaway-urban-industrial', 'Getaway · Industrial', true, 'network', 'standard', 'recover', 120]]);
  const other = getawayExtras('?getaway&pursuit=trail&tier=r4&miss=strict&time=90');
  assert.deepEqual([other[0].pursuit, other[0].tier, other[0].missPolicy, other[0].timeLimit], ['trail', 'r4', 'strict', 90]);
  const junk = getawayExtras('?getaway&pursuit=x&tier=../y&miss=1&time=5');
  assert.deepEqual([junk[0].pursuit, junk[0].tier, junk[0].missPolicy, junk[0].timeLimit], ['network', 'standard', 'recover', 120]);
  assert.deepEqual(Object.keys(URBAN_TIERS), ['standard', 'r4']);
  assert.equal(URBAN_PURSUER.vMax, 35, 'top speed is R4\'s');
});
