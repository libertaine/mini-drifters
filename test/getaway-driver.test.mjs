// Getaway Driver (EXPERIMENTAL, v0.8.0 R0 research): attention, patrols and sight, detection, the
// chase and the escape, the safehouse, and isolation from everything that ships.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TUNING } from '../src/tuning.js';
import { createGame, startRun, tick } from '../src/game.js';
import { handlingById } from '../src/handling.js';
import { GYMKHANA_CHALLENGES } from '../src/gymkhana.js';
import { GETAWAY_MISSIONS } from '../src/getaway-missions.js';
import { getawayIndex, createGetawayRecords } from '../src/getaway-records.js';
import { onPavement, lineOfSight } from '../src/getaway-city.js';
import {
  DRIVER, DRIVER_PATROLS, GETAWAY_DRIVER, createDriverChallenge, driverCityFor, buildLoop, unitSees, visionOutline,
} from '../src/getaway-driver.js';
import { RESEARCH_MISSIONS } from '../src/getaway-driver-entry.js';
import { driveUrban, urbanGrip } from './support/urban-drivers.mjs';

const CLASSIC = handlingById('classic');
const POWER = handlingById('revised');
const DT = TUNING.simStep;
const city = driverCityFor();
const NONE = { up: false, down: false, left: false, right: false, handbrake: false };

// A running session with the car placed by hand (and pointed), police where they start.
function session({ at = null, heading = 0, handling = CLASSIC, ...opts } = {}) {
  const def = createDriverChallenge(opts);
  const game = createGame(undefined, { handling });
  startRun(game, { mode: 'gymkhana', ghost: false, handling, challenge: def });
  tick(game, { ...NONE, up: true });   // the clock starts
  if (at) place(game, at, heading);
  return { def, game, run: game.challenge };
}
function place(game, [x, y], heading = 0, speed = 0) {
  Object.assign(game.car, { x, y, heading, vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed, yawRate: 0 });
  game.prev.x = x;
  game.prev.y = y;
  game.challenge.edge = -1;
}
// Park every police car far away, facing away (so nothing sees the car unless a test places one).
function parkAll(run) {
  for (const u of run.police) { u.post = { x: -120, y: -40, heading: Math.PI }; u.x = -120; u.y = -40; u.heading = Math.PI; u.loop = null; }
}
const steps = (game, seconds, input = NONE) => { for (let i = 0; i < Math.round(seconds / DT); i += 1) tick(game, input); };

// --- Isolation ---------------------------------------------------------------------------------------
test('isolation: shipped missions, gymkhana challenges and the records index never include Getaway Driver', () => {
  assert.deepEqual(GETAWAY_MISSIONS.map((m) => m.id), ['get-the-footage']);
  assert.ok(!GYMKHANA_CHALLENGES.some((c) => /driver/.test(c.id)));
  assert.ok(![...getawayIndex().keys()].some((id) => /driver/.test(id)));
  // No page here: the switch is off.
  assert.deepEqual(RESEARCH_MISSIONS, []);
  // The URL switch lives only in the entry file.
  for (const file of ['main.js', 'getaway-driver.js', 'getaway-driver-ui.js', 'gymkhana-ui.js', 'getaway-urban-draw.js', 'render.js']) {
    assert.doesNotMatch(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), /URLSearchParams|location\.search/, file);
  }
});

test('isolation: a completed run has no value, and the Getaway records ignore it and write nothing', () => {
  const writes = [];
  const storage = { getItem: () => null, setItem: (k) => writes.push(k), removeItem: () => {} };
  const records = createGetawayRecords(() => storage);
  assert.equal(records.available, true);
  const def = GETAWAY_DRIVER.environments[0];
  const { result } = driveUrban(def, CLASSIC, urbanGrip({ lateral: 8, cap: 17 }), { limit: 120 });
  assert.equal(result.ended, 'arrived');
  assert.equal(result.value, null);
  records.handle({ type: 'start', mode: 'gymkhana', challengeId: def.id, handling: 'classic', runId: 1 });
  records.handle({ type: 'challenge', challengeId: def.id, handling: 'classic', runId: 1, completed: true, value: 999 });
  assert.equal(records.bestFor(def.id, 'classic'), null);
  assert.deepEqual(writes, []);
});

// --- Patrols and sight -------------------------------------------------------------------------------
test('patrols: every loop stays on the pavement, clear of every solid and breakable by more than the car', () => {
  for (const spec of DRIVER_PATROLS.downtown) {
    if (!spec.nodes) {
      assert.ok(onPavement(city, spec.post.x, spec.post.y), spec.id);
      continue;
    }
    const loop = buildLoop(city, spec.nodes);
    for (const p of loop.samples) {
      assert.ok(onPavement(city, p.x, p.y), `${spec.id} ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      for (const c of [...city.colliders, ...city.breakables]) {
        const d = Math.hypot(Math.max(c.minX - p.x, 0, p.x - c.maxX), Math.max(c.minY - p.y, 0, p.y - c.maxY));
        assert.ok(d > TUNING.carRadius + 0.5, `${spec.id} too close to ${c.kind} at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      }
      assert.ok(p.v > 0 && p.v <= DRIVER.patrolSpeed);
    }
  }
});

test('sight: a patrol car sees ahead within its cone and close by all round, never through a building', () => {
  const u = { mode: 'patrol', x: 0, y: 150, heading: 0 };   // C0, facing east along row C
  assert.equal(unitSees(city, u, { x: 50, y: 150 }), true);                 // ahead
  assert.equal(unitSees(city, u, { x: 50, y: 150 + 80 }), false);           // far off its nose
  assert.equal(unitSees(city, u, { x: 0, y: 160 }), true);                  // off to its side, but close
  assert.equal(unitSees(city, u, { x: 0, y: 180 }), false);                 // off to its side, beyond near sight
  assert.equal(unitSees(city, { ...u, mode: 'pursue' }, { x: 0, y: 180 }), true);  // a pursuer looks all round
  // Across a block: never.
  assert.equal(lineOfSight(city, 0, 150, 95, 75), false);
  assert.equal(unitSees(city, { ...u, heading: -Math.PI / 4 }, { x: 40, y: 110 }), false);
  // The drawn outline never reaches into a building.
  for (const spec of DRIVER_PATROLS.downtown.filter((p) => p.nodes)) {
    const loop = buildLoop(city, spec.nodes);
    for (let k = 0; k < loop.samples.length; k += 40) {
      const s = loop.samples[k];
      for (const [x, y] of visionOutline(city, { mode: 'patrol', x: s.x, y: s.y, heading: s.h })) {
        const inside = city.sightBlockers.some((b) => x > b.minX + 0.4 && x < b.maxX - 0.4 && y > b.minY + 0.4 && y < b.maxY - 0.4);
        assert.ok(!inside, `${spec.id} ray into a building at ${x.toFixed(1)},${y.toFixed(1)}`);
      }
    }
  }
});

// --- Attention ---------------------------------------------------------------------------------------
test('attention: speeding raises it, four times faster in sight of the police; calm and unseen, it drains', () => {
  // Unseen, at 30 m/s (10 over): speedRate per second.
  let { game, run } = session({ at: [-60, 225] });
  parkAll(run);
  const hold = (speed, seconds) => { for (let i = 0; i < Math.round(seconds / DT); i += 1) { place(game, [-60, 225], 0, speed); tick(game, NONE); } };
  hold(30, 2);
  assert.ok(Math.abs(run.attention - 2 * DRIVER.speedRate) < 0.02, run.attention);
  // Watched: a parked car facing the start sees it.
  ({ game, run } = session({ at: [-60, 225] }));
  parkAll(run);
  Object.assign(run.police[0], { post: { x: -20, y: 225, heading: Math.PI }, x: -20, y: 225, heading: Math.PI });
  for (let i = 0; i < Math.round(1 / DT); i += 1) { place(game, [-60, 225], 0, 30); tick(game, NONE); }
  assert.equal(run.seen, true);
  // 1 s at 4x speedRate, and no scrutiny beyond 30 m.
  assert.ok(Math.abs(run.attention - DRIVER.watched * DRIVER.speedRate) < 0.02, run.attention);
  // Calm, but still in sight: it does not drain.
  const seenLevel = run.attention;
  for (let i = 0; i < Math.round(4 / DT); i += 1) { place(game, [-60, 225], 0, 10); tick(game, NONE); }
  assert.ok(run.attention >= seenLevel - 1e-9);
  // Out of sight and calm: after calmAfter it drains at `decay`.
  parkAll(run);
  run.attention = 0.5;
  run.calm = 0;
  for (let i = 0; i < Math.round((DRIVER.calmAfter + 2) / DT); i += 1) { place(game, [-60, 225], 0, 10); tick(game, NONE); }
  assert.ok(Math.abs(run.attention - (0.5 - 2 * DRIVER.decay)) < 0.01, run.attention);
});

test('attention: a crash and a smash are noticed at once', () => {
  const { game, run } = session({ at: [100, 205], heading: -Math.PI / 2 });
  parkAll(run);
  // Up column 1 at speed through the fruit stand on its sidewalk (102, 174).
  place(game, [102, 190], -Math.PI / 2, 18);
  steps(game, 1.2, { ...NONE, up: true });
  assert.equal(run.smashes, 1);
  assert.ok(run.attention >= DRIVER.smashBump.fruit - 0.01, run.attention);
});

// --- Detection, report, chase ----------------------------------------------------------------------------
test('detection: seen at high attention for spotTime starts a chase; less than spotTime does not', () => {
  const { game, run } = session({ at: [-60, 225] });
  parkAll(run);
  run.attention = 0.9;
  const cop = run.police[0];
  Object.assign(cop, { post: { x: -20, y: 225, heading: Math.PI }, x: -20, y: 225, heading: Math.PI });
  steps(game, DRIVER.spotTime * 0.5);
  assert.equal(run.pursuing, false);
  assert.ok(cop.spotting > 0);
  steps(game, DRIVER.spotTime);
  assert.equal(run.pursuing, true);
  assert.equal(cop.mode, 'pursue');
  assert.equal(cop.lights, true);
  assert.equal(run.detections, 1);
  assert.equal(run.attention, 1);
  assert.equal(run.exitOpen, false);
});

test('detection: below DETECT a watching police car only grows suspicious; unseen, a full meter is reported', () => {
  let { game, run } = session({ at: [-60, 225] });
  parkAll(run);
  run.attention = DRIVER.detectAt - 0.2;
  Object.assign(run.police[0], { post: { x: -20, y: 225, heading: Math.PI }, x: -20, y: 225, heading: Math.PI });
  steps(game, 1);
  assert.equal(run.pursuing, false);
  ({ game, run } = session({ at: [-60, 225] }));
  run.attention = 0.99;
  for (let i = 0; i < 30; i += 1) { place(game, [-60, 225], 0, 35); tick(game, NONE); }
  assert.equal(run.reported, true);
  assert.equal(run.reports, 1);
  const sent = run.police.filter((u) => u.mode === 'respond');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].lights, true);
});

test('chase: BUST RISK fills only from a chasing car close and in sight, and a bust ends the run', () => {
  const { game, run } = session({ at: [-60, 225] });
  parkAll(run);
  run.attention = 1;
  const cop = run.police[0];
  Object.assign(cop, { post: { x: -66, y: 225, heading: 0 }, x: -66, y: 225, heading: 0 });
  steps(game, DRIVER.spotTime + 0.1);
  assert.equal(run.pursuing, true);
  steps(game, 2.5);
  assert.equal(run.phase, 'failed');
  assert.equal(run.reason, 'busted');
  assert.equal(run.result.outcome, 'busted');
  assert.equal(game.state, 'finished');
});

test('escape: out of sight and far enough for loseTime loses them; they search, then go back to patrol', () => {
  const { game, run, def } = session({ at: [-60, 225] });
  parkAll(run);
  run.attention = 1;
  const cop = run.police[1];
  Object.assign(cop, { post: { x: -20, y: 225, heading: Math.PI }, x: -20, y: 225, heading: Math.PI });
  steps(game, DRIVER.spotTime + 0.1);
  assert.equal(run.pursuing, true);
  // Teleport the car round two blocks: no police car can see it there.
  const hide = [137, 112];
  for (let i = 0; i < Math.round((DRIVER.loseTime - 0.5) / DT); i += 1) { place(game, hide, -Math.PI / 2, 0); tick(game, NONE); }
  assert.equal(run.pursuing, true);
  assert.ok(run.lose > 0.8, run.lose);
  for (let i = 0; i < Math.round(1 / DT); i += 1) { place(game, hide, -Math.PI / 2, 0); tick(game, NONE); }
  assert.equal(run.pursuing, false);
  assert.equal(run.escapes, 1);
  assert.equal(cop.mode, 'search');
  assert.ok(Math.abs(run.attention - DRIVER.afterEscape) < 0.02);
  assert.equal(run.exitOpen, true);
  for (let i = 0; i < Math.round((def.driverTuning.searchTime + 0.2) / DT); i += 1) { place(game, hide, -Math.PI / 2, 0); tick(game, NONE); }
  assert.ok(['return', 'patrol'].includes(cop.mode), cop.mode);
  assert.equal(cop.lights, false);
});

// --- The safehouse and whole runs ------------------------------------------------------------------------
test('safehouse: shut while chased, open otherwise; arriving unnoticed is a ghost run', () => {
  const { game, run } = session({ at: [290, 0] });
  parkAll(run);
  run.pursuing = true;
  for (let i = 0; i < Math.round(1.5 / DT); i += 1) { place(game, [290 + i * 0.25, 0], 0, 30); tick(game, NONE); }
  assert.equal(run.phase, 'running');
  assert.ok(run.lockedTries >= 1);
  run.pursuing = false;
  run.peakAttention = 0;
  run.attention = 0;
  run.police.forEach((u) => { u.mode = 'patrol'; });
  for (let i = 0; i < Math.round(1.5 / DT) && run.phase === 'running'; i += 1) { place(game, [295 + i * 0.25, 0], 0, 30); tick(game, NONE); }
  assert.equal(run.phase, 'complete');
  assert.equal(run.result.outcome, 'ghost');
});

test('whole runs: a calm driver arrives unnoticed in both handling modes; a fast one is chased; runs repeat exactly', () => {
  for (const h of [CLASSIC, POWER]) {
    const calm = driveUrban(createDriverChallenge(), h, urbanGrip({ lateral: 8, cap: 17 }), { limit: 120 });
    assert.equal(calm.result.outcome, 'ghost', h.id);
    assert.ok(calm.result.time > 30 && calm.result.time < 45, calm.result.time);
    const fast = driveUrban(createDriverChallenge(), h, urbanGrip({ lateral: 11 }), { limit: 160 });
    assert.ok(fast.result.detections >= 1, h.id);
    const again = driveUrban(createDriverChallenge(), h, urbanGrip({ lateral: 11 }), { limit: 160 });
    assert.deepEqual(again.result, fast.result);
  }
});
