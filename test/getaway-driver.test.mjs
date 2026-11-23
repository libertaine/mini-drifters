// Getaway Driver: the accepted R0 mechanics held fixed, attention, patrols and sight, detection, the
// chase and the escape, the safehouse and its three outcomes, the Getaway sheet, and isolation from
// the Get the Footage records and from analytics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { TUNING } from '../src/tuning.js';
import { createGame, startRun, tick } from '../src/game.js';
import { handlingById } from '../src/handling.js';
import { GYMKHANA_CHALLENGES } from '../src/gymkhana.js';
import { GETAWAY_MISSIONS, GETAWAY_SHEET } from '../src/getaway-missions.js';
import { createAnalytics, categoryOf } from '../src/analytics.js';
import { getawayIndex, createGetawayRecords } from '../src/getaway-records.js';
import { onPavement, lineOfSight } from '../src/getaway-city.js';
import {
  DRIVER, DRIVER_PATROLS, DRIVER_OUTCOMES, GETAWAY_DRIVER, createDriverChallenge, driverCityFor, driverOutcome, buildLoop, unitSees, visionOutline,
} from '../src/getaway-driver.js';
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

// --- The accepted mechanics ----------------------------------------------------------------------------
// The owner playtested R0 in Classic and Power and accepted these numbers (2026-11-23). R1 integrates
// the mission without changing them: police attention thresholds, patrols, the pursuit, the five
// seconds to lose them and the safehouse. A change here is a balance change and needs its own review.
const RAD = Math.PI / 180;
const ACCEPTED_DRIVER = {
  speedLimit: 20, speedRate: 0.05, driftSlip: 15 * RAD, driftFull: 40 * RAD, driftRate: 0.08, impactMin: 3, impactBump: 0.12,
  smashBump: { fruit: 0.2, barricade: 0.3 }, watched: 4, scrutiny: 0.1, scrutinyRange: 30, calmAfter: 1.5, decay: 0.05,
  suspectAt: 0.35, detectAt: 0.7, spotTime: 0.6, patrolSpeed: 11, patrolGrip: 5, patrolAccel: 3, patrolBrake: 5, lane: 2.5,
  visionRange: 65, visionHalf: 50 * RAD, nearSight: 14, respondSpeed: 24, pursuitPing: 4, loseGap: 45, loseTime: 5,
  afterEscape: 0.6, searchTime: 6, timeLimit: 150,
};
const ACCEPTED_PATROLS = {
  downtown: [
    { id: 'west', name: 'West', nodes: ['A0', 'B0', 'B1', 'A1'], start: 0.3 },
    { id: 'central', name: 'Central', nodes: ['B1', 'BA', 'B2', 'C2', 'CA', 'C1'], start: 0.1 },
    { id: 'east', name: 'East', nodes: ['D2', 'C2', 'B2', 'BB', 'B3', 'C3', 'D3'], start: 0.35 },
    { id: 'stakeout', name: 'Stakeout', post: { x: 326, y: -4.5, heading: Math.PI } },
  ],
};
// Whole runs by the scripted drivers, as R0 drove them (recorded from the R0 worktree).
const ACCEPTED_RUNS = {
  'classic/calm': { outcome: 'ghost', time: 36.041667, detections: 0, peakAttention: 0.159167 },
  'classic/brisk': { outcome: 'ghost', time: 30.391667, detections: 0, peakAttention: 0.324132 },
  'classic/fast': { outcome: 'busted', time: 29.883333, detections: 1, peakAttention: 1 },
  'revised/calm': { outcome: 'ghost', time: 36.008333, detections: 0, peakAttention: 0.1575 },
  'revised/brisk': { outcome: 'ghost', time: 30.483333, detections: 0, peakAttention: 0.322396 },
  'revised/fast': { outcome: 'busted', time: 38.116667, detections: 1, peakAttention: 1 },
};
const DRIVERS = { calm: [{ lateral: 8, cap: 17 }, 120], brisk: [{ lateral: 9, cap: 21 }, 150], fast: [{ lateral: 11 }, 160] };

test('accepted mechanics: attention, patrol, pursuit, escape and safehouse numbers are the R0 ones', () => {
  assert.deepEqual({ ...DRIVER, smashBump: { ...DRIVER.smashBump } }, ACCEPTED_DRIVER);
  assert.deepEqual(JSON.parse(JSON.stringify(DRIVER_PATROLS)), JSON.parse(JSON.stringify(ACCEPTED_PATROLS)));
  const def = GETAWAY_DRIVER.environments[0];
  assert.equal(def.id, 'getaway-driver-downtown');
  assert.equal(def.timeLimit, 150);
  assert.equal(def.captureModel.id, 'proximity');
  assert.equal(def.pursuerTuning.ping, 4);
  assert.equal(def.driverTuning.loseTime, 5);
});

test('accepted mechanics: whole runs repeat the R0 runs exactly, in both handling modes', () => {
  for (const [key, want] of Object.entries(ACCEPTED_RUNS)) {
    const [h, name] = key.split('/');
    const [drv, limit] = DRIVERS[name];
    const { result } = driveUrban(createDriverChallenge(), handlingById(h), urbanGrip(drv), { limit });
    assert.deepEqual({ outcome: result.outcome, time: +result.time.toFixed(6), detections: result.detections, peakAttention: +result.peakAttention.toFixed(6) }, want, key);
  }
});

// --- The Getaway sheet and isolation ---------------------------------------------------------------------
test('sheet: the Getaway sheet offers Get the Footage then Getaway Driver, with no URL switch', () => {
  assert.deepEqual(GETAWAY_SHEET.map((m) => m.id), ['get-the-footage', 'getaway-driver']);
  assert.equal(GETAWAY_SHEET[1], GETAWAY_DRIVER);
  assert.deepEqual(GETAWAY_DRIVER.environments.map((d) => d.id), ['getaway-driver-downtown']);
  assert.ok(!existsSync(new URL('../src/getaway-driver-entry.js', import.meta.url)), 'the R0 ?driver switch is gone');
  for (const file of ['main.js', 'getaway-missions.js', 'getaway-driver.js', 'getaway-driver-ui.js', 'getaway-driver-records.js', 'gymkhana-ui.js', 'getaway-urban-draw.js', 'render.js']) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /URLSearchParams|location\.search|getaway-driver-entry|RESEARCH_MISSIONS/, file);
  }
  for (const text of [GETAWAY_DRIVER.description, ...GETAWAY_DRIVER.environments[0].points]) assert.doesNotMatch(text, /research/i);
});

test('isolation: gymkhana challenges and the Get the Footage records index never include Getaway Driver', () => {
  assert.deepEqual(GETAWAY_MISSIONS.map((m) => m.id), ['get-the-footage']);
  assert.ok(!GYMKHANA_CHALLENGES.some((c) => /driver/.test(c.id)));
  assert.ok(![...getawayIndex().keys()].some((id) => /driver/.test(id)));
});

test('analytics: a Getaway Driver run counts as a getaway run, and sends no outcome or count', () => {
  const sent = [];
  let t = 0;
  const analytics = createAnalytics({ send: (name, data) => sent.push([name, data]), now: () => t, foreground: () => true });
  const events = [];
  const def = createDriverChallenge();
  const game = createGame(undefined, { handling: CLASSIC, onRunEvent: (e) => {
    events.push(e);
    analytics.runEvent(e, { lap: 0, category: categoryOf({ mode: game.mode, layout: game.challengeDef?.layout }) });
  } });
  startRun(game, { mode: 'gymkhana', ghost: false, handling: CLASSIC, challenge: def });
  const drive = urbanGrip({ lateral: 8, cap: 17 });
  for (let i = 0; i < 120 / DT && game.state !== 'finished'; i += 1) {
    tick(game, drive(game));
    t += DT * 1000;
    analytics.frame({ runId: game.runId, category: categoryOf({ mode: game.mode, layout: def.layout }), racing: game.state === 'racing', active: true });
  }
  assert.equal(game.challenge.result.outcome, 'ghost');
  const ended = events.find((e) => e.type === 'challenge');
  assert.equal(ended.completed, true);
  assert.equal(ended.value, null);
  assert.ok(!('outcome' in ended), 'the run event carries no outcome');
  const runEvents = sent.filter(([name]) => name === 'md_run_start' || name === 'md_run_complete');
  assert.deepEqual(runEvents, [['md_run_start', { category: 'getaway' }], ['md_run_complete', { category: 'getaway' }]]);
  const payload = JSON.stringify(sent).toLowerCase();
  for (const word of ['ghost', 'low', 'lost', 'driver', 'outcome', 'count', 'downtown']) assert.ok(!payload.includes(word), `${word} in ${payload}`);
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

// Arrive at the safehouse from just short of it, with the run's history set by hand.
function arrive(history) {
  const { game, run } = session({ at: [290, 0] });
  parkAll(run);
  Object.assign(run, history);
  for (let i = 0; i < Math.round(1.5 / DT) && run.phase === 'running'; i += 1) { place(game, [295 + i * 0.25, 0], 0, 30); tick(game, NONE); }
  return run;
}

test('outcomes: Ghost run, Low profile and Lost them are told apart by attention and chases', () => {
  assert.deepEqual(DRIVER_OUTCOMES.map((o) => [o.id, o.outcome, o.name]),
    [['ghost', 'ghost', 'Ghost run'], ['low-profile', 'low profile', 'Low profile'], ['lost-them', 'lost them', 'Lost them']]);
  // Never SUSPICIOUS: a ghost run, right up to the line.
  assert.equal(arrive({ peakAttention: DRIVER.suspectAt - 0.01 }).result.outcome, 'ghost');
  // SUSPICIOUS (or hotter, even reported) but never chased: low profile.
  assert.equal(arrive({ peakAttention: DRIVER.suspectAt }).result.outcome, 'low profile');
  assert.equal(arrive({ peakAttention: 1, reports: 1 }).result.outcome, 'low profile');
  // Chased and lost: lost them, however calm the rest of the run.
  const lost = arrive({ peakAttention: 1, detections: 2, escapes: 2 });
  assert.equal(lost.result.outcome, 'lost them');
  assert.equal(lost.result.detections, 2);
  assert.equal(lost.result.value, null);
  // The HUD's "on for" line and the results use the same rule.
  assert.equal(driverOutcome({ detections: 0, peakAttention: 0.2 }), 'ghost');
  assert.equal(driverOutcome({ detections: 0, peakAttention: 0.5 }), 'low profile');
  assert.equal(driverOutcome({ detections: 1, peakAttention: 0.2 }), 'lost them');
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
