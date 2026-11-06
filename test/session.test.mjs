import test from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as T } from '../src/tuning.js';
import { createGame, startRun, restartRun, togglePause, tick, advance, NO_INPUT } from '../src/game.js';
import { gripDriver, driftDriver, recklessDriver } from './support/drivers.mjs';

const THROTTLE = { ...NO_INPUT, up: true };
const steps = (seconds) => Math.round(seconds / T.simStep);

function runDriver(driver, maxSeconds = 400) {
  const game = createGame();
  startRun(game);
  while (game.state !== 'finished' && game.ticks < steps(maxSeconds)) tick(game, driver(game));
  return game;
}

// Whole-run results are shared across tests; each driver only needs to run once.
const runs = {
  grip: runDriver(gripDriver()),
  drift: runDriver(driftDriver()),
};

// One run says little, because small timing changes decide how a slide unfolds.
// These comparisons use the median across a set of start timings.
function sampleDriver(makeDriver, count = 12) {
  const samples = [];
  for (let offset = 0; offset < count; offset += 1) {
    const game = createGame();
    startRun(game);
    for (let i = 0; i < offset; i += 1) tick(game, NO_INPUT);
    const driver = makeDriver();
    while (game.state !== 'finished' && game.ticks < steps(500)) tick(game, driver(game));
    samples.push(game);
  }
  const median = (read) => [...samples].map(read).sort((a, b) => a - b)[Math.floor(count / 2)];
  return {
    samples,
    score: median((g) => g.scoring.score),
    spins: median((g) => g.scoring.spinouts),
    bestLap: median((g) => g.laps.bestLap ?? Infinity),
  };
}
const skilled = sampleDriver(() => driftDriver());
const reckless = sampleDriver(() => recklessDriver());

// --- Session flow -----------------------------------------------------------
test('the clock waits on the grid for the first pedal press', () => {
  const game = createGame();
  assert.equal(game.state, 'menu');
  startRun(game);
  assert.equal(game.state, 'ready');
  for (let i = 0; i < steps(2); i += 1) tick(game, NO_INPUT);
  assert.equal(game.runTime, 0);
  assert.equal(game.state, 'ready');
  assert.equal(game.car.speed, 0);
  tick(game, THROTTLE);
  assert.equal(game.state, 'racing');
  assert.ok(game.runTime > 0);
});

test('the menu does not simulate', () => {
  const game = createGame();
  assert.equal(advance(game, 0.1, THROTTLE), 0);
  assert.equal(game.ticks, 0);
});

test('pausing stops the simulation and resuming continues from the same place', () => {
  const game = createGame();
  startRun(game);
  advance(game, 0.2, THROTTLE);
  const { x } = game.car;
  const time = game.runTime;
  togglePause(game);
  for (let i = 0; i < 20; i += 1) assert.equal(advance(game, 0.1, THROTTLE), 0);
  assert.equal(game.car.x, x);
  assert.equal(game.runTime, time);
  togglePause(game);
  advance(game, 0.2, THROTTLE);
  assert.ok(game.car.x > x);
});

// --- 11. Reset and restart --------------------------------------------------
test('restart returns every part of the run to a clean grid', () => {
  const game = createGame();
  startRun(game);
  const startPose = { x: game.car.x, y: game.car.y, heading: game.car.heading };
  const driver = driftDriver();
  for (let i = 0; i < steps(25); i += 1) tick(game, driver(game));
  assert.ok(game.runTime > 20);
  assert.ok(game.scoring.score > 0 || game.scoring.combo, 'had started scoring');
  game.laps.completed = 2;
  game.scoring.spinouts = 4;
  game.laps.bestLap = 40;

  restartRun(game);
  assert.equal(game.state, 'ready');
  assert.deepEqual({ x: game.car.x, y: game.car.y, heading: game.car.heading }, startPose);
  assert.equal(game.car.speed, 0);
  assert.equal(game.car.yawRate, 0);
  assert.equal(game.car.rearGrip, 1);
  assert.equal(game.runTime, 0);
  assert.equal(game.laps.completed, 0);
  assert.equal(game.laps.next, 0);
  assert.equal(game.laps.lapTime, 0);
  assert.equal(game.laps.bestLap, null);
  assert.equal(game.scoring.score, 0);
  assert.equal(game.scoring.combo, null);
  assert.equal(game.scoring.spinouts, 0);
  assert.equal(game.furthest, 0);
  assert.equal(game.results, null);
  assert.equal(game.paused, false);
});

test('a run can be restarted from finished, or while paused', () => {
  const game = createGame();
  startRun(game);
  togglePause(game);
  restartRun(game);
  assert.equal(game.paused, false);
  assert.equal(game.state, 'ready');

  const driver = gripDriver();
  while (game.state !== 'finished') tick(game, driver(game));
  assert.equal(advance(game, 0.1, THROTTLE), 0, 'a finished run stops simulating');
  restartRun(game);
  assert.equal(game.state, 'ready');
  assert.equal(game.results, null);
});

test('a restarted run is deterministic: the same inputs give the same result', () => {
  const game = createGame();
  startRun(game);
  const play = () => {
    const driver = driftDriver();
    for (let i = 0; i < steps(30); i += 1) tick(game, driver(game));
    return { x: game.car.x, y: game.car.y, score: game.scoring.score, points: game.scoring.combo?.points };
  };
  const first = play();
  restartRun(game);
  assert.deepEqual(play(), first);
});

// --- 12. Frame-rate stability -----------------------------------------------
function playAt(frameTimes, seconds, script) {
  const game = createGame();
  startRun(game);
  let elapsedMicroseconds = 0;
  let frame = 0;
  let peak = 0;
  while (elapsedMicroseconds < seconds * 1e6 - 1) {
    const dt = frameTimes(frame);
    // Timed in whole microseconds, so that input changes land exactly on their marks.
    advance(game, dt, script(Math.round(elapsedMicroseconds) / 1e6));
    peak = Math.max(peak, Math.abs(game.car.slipAngle));
    elapsedMicroseconds += dt * 1e6;
    frame += 1;
  }
  return { game, peak };
}

// Inputs change only at half-second marks, which every tested frame rate lands on.
const drivingScript = (t) => ({
  up: true,
  down: false,
  left: t >= 4 && t < 4.5,
  right: t >= 3 && t < 4,
  handbrake: t >= 3.5 && t < 4,
});

test('the same drive gives the same result at any frame rate', () => {
  const reference = playAt(() => 1 / 120, 8, drivingScript);
  assert.ok(reference.peak > 15 * Math.PI / 180, 'the scripted drive really does slide');
  for (const fps of [30, 60, 100, 144, 240]) {
    const { game } = playAt(() => 1 / fps, 8, drivingScript);
    const label = `${fps} fps`;
    assert.equal(game.ticks, reference.game.ticks, `${label}: ticks`);
    assert.ok(Math.hypot(game.car.x - reference.game.car.x, game.car.y - reference.game.car.y) < 1e-6, `${label}: position`);
    assert.ok(Math.abs(game.car.speed - reference.game.car.speed) < 1e-6, `${label}: speed`);
    assert.ok(Math.abs(game.car.heading - reference.game.car.heading) < 1e-6, `${label}: heading`);
  }
});

test('irregular frame times do not change the outcome of a held input', () => {
  const seed = (i) => 1 / 240 + ((i * 2654435761) % 997) / 997 / 30; // repeatable uneven frames
  const script = () => ({ ...THROTTLE, right: true });
  const uneven = playAt(seed, 5, script).game;
  const reference = createGame();
  startRun(reference);
  while (reference.ticks < uneven.ticks) tick(reference, script());
  assert.ok(Math.abs(uneven.car.x - reference.car.x) < 1e-9);
  assert.ok(Math.abs(uneven.car.heading - reference.car.heading) < 1e-9);
});

test('a long stall is not caught up in one lurch', () => {
  const game = createGame();
  startRun(game);
  const ran = advance(game, 5, THROTTLE);
  assert.equal(ran, Math.round(T.maxFrameTime / T.simStep));
});

// --- Barrier ----------------------------------------------------------------
test('a hard hit on the perimeter wall bounces the car and loses the combo', () => {
  const game = createGame();
  startRun(game);
  tick(game, THROTTLE);
  const { bounds } = game.track;
  game.scoring.combo = { points: 500, tier: 2, grace: 2, tierGround: 0, linkGround: 0, stallTimer: 0, stallGround: 0, side: 1 };
  game.car.x = bounds.maxX - T.carRadius - 0.5;
  game.car.y = 0;
  game.car.vx = 30;
  game.car.vy = 5;
  for (let i = 0; i < 12; i += 1) tick(game, NO_INPUT);
  assert.ok(game.car.x <= bounds.maxX - T.carRadius + 1e-9, 'stayed inside');
  assert.ok(game.car.vx < 0, 'bounced');
  assert.ok(Math.abs(game.car.vx) < 12, 'lost most of its speed');
  assert.equal(game.scoring.combo, null);
  assert.equal(game.scoring.event.reason, 'hit the wall');
  assert.equal(game.scoring.score, 0);
});

// --- Whole runs by keyboard-limited drivers ---------------------------------
test('a grip driver finishes cleanly with three valid laps and almost no points', () => {
  const { state, laps, scoring, results } = runs.grip;
  assert.equal(state, 'finished');
  assert.equal(laps.completed, 3);
  assert.equal(laps.voided, 0);
  assert.equal(scoring.spinouts, 0);
  assert.ok(scoring.score < 300, `score ${scoring.score}`);
  assert.equal(results.bestLap, laps.bestLap);
  assert.ok(results.bestLap > 35 && results.bestLap < 60, `lap ${results.bestLap}`);
});

test('careful driving rarely slides by accident, whatever the timing', () => {
  // A single run can hide this: small timing changes decide whether a slide starts.
  const scores = [];
  for (let offset = 0; offset < 12; offset += 1) {
    const game = createGame();
    startRun(game);
    for (let i = 0; i < offset; i += 1) tick(game, NO_INPUT);
    const driver = gripDriver();
    while (game.state !== 'finished' && game.ticks < steps(400)) tick(game, driver(game));
    scores.push(game.scoring.score);
  }
  const accidental = scores.filter((score) => score > 500);
  assert.ok(accidental.length <= 2, `scores ${scores.join(', ')}`);
});

test('a drift driver can link corners with few spins, on keys alone', () => {
  for (const { state, laps } of skilled.samples) {
    assert.equal(state, 'finished');
    assert.equal(laps.completed, 3);
    assert.equal(laps.voided, 0);
  }
  assert.ok(skilled.spins <= 3, `median spins ${skilled.spins}`);
  assert.ok(skilled.score > 6000, `median score ${skilled.score}`);
  assert.ok(skilled.samples.every((g) => g.scoring.bestMultiplier === 3));
});

test('technique pays: control scores well above handbrake abuse, and is far quicker', () => {
  assert.ok(reckless.spins >= 5, `reckless median spins ${reckless.spins}`);
  assert.ok(skilled.score > reckless.score * 1.5, `median ${skilled.score} vs ${reckless.score}`);
  assert.ok(skilled.bestLap < reckless.bestLap * 0.8, `median ${skilled.bestLap} vs ${reckless.bestLap}`);
});

test('drifting costs some lap time, so points and pace remain a real trade-off', () => {
  assert.ok(runs.grip.laps.bestLap < skilled.bestLap);
  assert.ok(skilled.bestLap < runs.grip.laps.bestLap * 1.3, `${skilled.bestLap} vs ${runs.grip.laps.bestLap}`);
});

test('results report everything the end screen needs', () => {
  const { results, scoring, runTime } = runs.drift;
  assert.equal(results.score, scoring.score);
  assert.ok(Math.abs(results.runTime - runTime) < 1e-9);
  assert.ok(results.bestCombo > 0 && results.bestCombo <= results.score);
  assert.equal(results.spinouts, scoring.spinouts);
  assert.ok(results.remark.length > 5);
});

test('an unbanked combo at the finish line is banked', () => {
  const game = createGame();
  startRun(game);
  tick(game, THROTTLE);
  game.scoring.combo = { points: 100, tier: 2, grace: 2, tierGround: 0, linkGround: 0, stallTimer: 0, stallGround: 0, side: 1 };
  game.laps.completed = T.runLaps - 1;
  game.laps.next = game.track.gates.length;
  // Drive backward from just past the line, then forward across it.
  game.car.x -= 12;
  game.trackInfo = { ...game.trackInfo };
  const driveTo = () => {
    for (let i = 0; i < steps(3) && game.state !== 'finished'; i += 1) tick(game, THROTTLE);
  };
  driveTo();
  assert.equal(game.state, 'finished');
  assert.equal(game.results.score, 200);
});

// --- 9. Suppression of donuts, with real physics ----------------------------
function donutRun(script, seconds = 40) {
  const game = createGame();
  startRun(game);
  tick(game, THROTTLE);
  let t = 0;
  while (t < seconds && game.state !== 'finished') {
    tick(game, script(t, game));
    t += T.simStep;
  }
  const unbanked = game.scoring.combo?.points ?? 0;
  return { game, total: game.scoring.score + unbanked };
}

test('standing-start donuts score nothing', () => {
  const { total } = donutRun(() => ({ up: true, down: false, left: false, right: true, handbrake: true }));
  assert.equal(total, 0);
});

test('a car kept circling at speed scores next to nothing over 40 seconds', () => {
  // Pulses of handbrake with full lock keep the car rotating on the spot.
  const { total, game } = donutRun((t) => ({
    up: true,
    down: false,
    left: false,
    right: true,
    handbrake: t % 1.6 < 0.3,
  }));
  assert.equal(game.laps.completed, 0);
  assert.ok(total < runs.drift.scoring.score * 0.05, `circling earned ${total}`);
});

test('reversing in circles scores nothing', () => {
  const { total } = donutRun(() => ({ up: false, down: true, left: true, right: false, handbrake: false }));
  assert.equal(total, 0);
});

test('sawing back and forth across one spot scores nothing', () => {
  const { total } = donutRun((t) => {
    const forward = t % 3 < 1.5;
    return { up: forward, down: !forward, left: false, right: t % 1 < 0.5, handbrake: t % 3 > 1 && t % 3 < 1.2 };
  });
  assert.ok(total < 50, `sawing earned ${total}`);
});

test('grass scores nothing, however sideways', () => {
  const game = createGame();
  startRun(game);
  tick(game, THROTTLE);
  game.car.x = game.track.bounds.minX + 8;
  game.car.y = game.track.bounds.minY + 8;
  game.car.vx = 25;
  for (let i = 0; i < steps(3); i += 1) tick(game, { ...THROTTLE, right: true, handbrake: i % 120 < 30 });
  assert.equal(game.car.surface, 'grass');
  assert.equal(game.scoring.combo, null);
  assert.equal(game.scoring.score, 0);
});
