// The pure telemetry mapping, on its own and driven by the real simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_TUNING as A, createAudioState, engineTarget, readTelemetry, resetAudioState, stepAudioState, tireParams, tireTarget,
} from '../src/audio-telemetry.js';
import { createGame, startRun, tick } from '../src/game.js';
import { driftDriver, gripDriver } from './support/drivers.mjs';
import { mapCoyote } from '../src/coyote-model.js';
import { mapProceduralEngine } from '../src/audio-voices.js';

const DEG = Math.PI / 180;
const FRAME = 1 / 60;
const parked = Object.freeze({
  speed: 0, forwardSpeed: 0, throttle: 0, brake: 0, slipAngle: 0, frontSlip: 0, rearSlip: 0, rearGrip: 1, surface: 'road', reversing: false,
});
const car = (values) => ({ ...parked, ...values });

function settle(telemetry, seconds = 4, state = createAudioState()) {
  for (let t = 0; t < seconds; t += FRAME) stepAudioState(state, telemetry, FRAME);
  return state;
}

test('a parked car without throttle idles at exactly the bottom of the range', () => {
  const state = settle(parked);
  assert.equal(state.rpm, A.idleRpm);
  assert.equal(state.load, 0);
  assert.equal(state.tire, 0);
});

test('RPM stays within the lab range for any input, and all targets are finite', () => {
  const extremes = [0, 1, -1, 1e9, -1e9, NaN, Infinity, -Infinity, undefined];
  for (const speed of extremes) for (const throttle of extremes) for (const rearSlip of extremes) {
    const telemetry = car({ speed, forwardSpeed: speed, throttle, rearSlip, frontSlip: rearSlip, rearGrip: throttle, brake: throttle });
    const state = stepAudioState(createAudioState(), telemetry, FRAME);
    assert.ok(Number.isFinite(engineTarget(telemetry)));
    assert.ok(state.rpm >= 750 && state.rpm <= 7000, `rpm ${state.rpm}`);
    assert.ok(state.load >= 0 && state.load <= 1);
    const tire = tireParams(state);
    for (const value of Object.values(tire)) assert.ok(Number.isFinite(value));
    assert.ok(tire.tireIntensity >= 0 && tire.tireIntensity <= 1);
    for (const value of [...mapCoyote({ rpm: state.rpm, throttle: state.load }).coyoteRates, ...Object.values(mapProceduralEngine({ rpm: state.rpm, throttle: state.load }))]) {
      assert.ok(Number.isFinite(value));
    }
  }
  for (const dt of [NaN, -1, 0, Infinity, 1000]) {
    const state = stepAudioState(createAudioState(), car({ speed: 20, forwardSpeed: 20, throttle: 1 }), dt);
    assert.ok(Number.isFinite(state.rpm) && state.rpm <= 7000);
  }
});

test('Coyote playback stays inside the lab pitch limits at every RPM the model can reach', () => {
  for (let rpm = A.idleRpm; rpm <= A.maxRpm; rpm += 10) {
    for (const rate of mapCoyote({ rpm, throttle: 1 }).coyoteRates) assert.ok(rate >= 0.65 && rate <= 1.65);
  }
});

test('acceleration raises RPM continuously, with no jump between frames', () => {
  const game = createGame();
  startRun(game);
  const state = createAudioState();
  let previous = state.rpm;
  const seen = [];
  for (let frame = 0; frame < 60 * 5; frame++) {
    tick(game, { up: true });
    tick(game, { up: true });
    stepAudioState(state, readTelemetry(game.car), FRAME);
    const change = state.rpm - previous;
    assert.ok(change >= -1e-9, `RPM fell ${change} under steady acceleration at frame ${frame}`);
    assert.ok(change <= A.rpmRiseLimit * FRAME + 1e-9, `RPM jumped ${change}`);
    previous = state.rpm;
    seen.push(state.rpm);
  }
  assert.ok(seen[15] > A.idleRpm + 500, 'the first quarter second is audible');
  assert.ok(seen.at(-1) > seen[60] + 1000, 'RPM keeps climbing with speed');
});

test('RPM is not simply a multiple of speed: throttle moves it at the same speed', () => {
  const on = engineTarget(car({ speed: 25, forwardSpeed: 25, throttle: 1 }));
  const off = engineTarget(car({ speed: 25, forwardSpeed: 25, throttle: 0 }));
  assert.ok(on > off + 500, `${on} vs ${off}`);
  const stoppedOn = engineTarget(car({ throttle: 1 }));
  assert.ok(stoppedOn > A.idleRpm + 1000 && stoppedOn < 3500, `stationary throttle ${stoppedOn}`);
});

test('throttle changes the engine character independently of RPM', () => {
  for (const rpm of [1500, 3500, 5500]) {
    const gentle = mapCoyote({ rpm, throttle: 0 });
    const hard = mapCoyote({ rpm, throttle: 1 });
    assert.deepEqual(gentle.coyoteRates, hard.coyoteRates);
    assert.deepEqual(gentle.coyoteWeights, hard.coyoteWeights);
    assert.ok(hard.coyoteGain > gentle.coyoteGain);
    assert.ok(hard.coyoteCutoff > gentle.coyoteCutoff);
  }
  const state = settle(car({ speed: 25, forwardSpeed: 25, throttle: 1 }));
  assert.ok(state.load > 0.99);
  stepAudioState(state, car({ speed: 25, forwardSpeed: 25, throttle: 0 }), 0.5);
  assert.ok(state.load < 0.5, 'lifting off reduces the load quickly');
});

test('sustained speed holds a steady elevated RPM, without oscillating', () => {
  const telemetry = car({ speed: 38, forwardSpeed: 38, throttle: 1 });
  const state = settle(telemetry);
  assert.ok(state.rpm > 5000, `held at ${state.rpm}`);
  const low = state.rpm;
  for (let t = 0; t < 10; t += FRAME) {
    stepAudioState(state, telemetry, FRAME);
    assert.ok(Math.abs(state.rpm - low) < 1);
  }
});

test('releasing the throttle settles RPM without a step, and a stopped car returns to idle', () => {
  const state = settle(car({ speed: 30, forwardSpeed: 30, throttle: 1 }));
  const start = state.rpm;
  let previous = start;
  for (let t = 0; t < 1; t += FRAME) {
    stepAudioState(state, car({ speed: 30, forwardSpeed: 30 }), FRAME);
    assert.ok(state.rpm <= previous + 1e-9);
    assert.ok(previous - state.rpm <= A.rpmFallLimit * FRAME + 1e-9);
    previous = state.rpm;
  }
  assert.ok(state.rpm < start - 300, 'lifting off lowers RPM');
  assert.ok(state.rpm > 3000, 'coasting at speed is still well above idle');
  assert.equal(settle(parked, 6, state).rpm, A.idleRpm);
});

test('braking lowers RPM with falling speed and ends at idle', () => {
  const game = createGame();
  startRun(game);
  const state = createAudioState();
  for (let frame = 0; frame < 60 * 4; frame++) {
    tick(game, { up: true });
    tick(game, { up: true });
    stepAudioState(state, readTelemetry(game.car), FRAME);
  }
  const top = state.rpm;
  let previous = top;
  // Down keeps pressing until the car stops, and is then released before reversing.
  while (game.car.forwardSpeed > 1) {
    tick(game, { down: true });
    tick(game, { down: true });
    stepAudioState(state, readTelemetry(game.car), FRAME);
    assert.ok(state.rpm <= previous + 1e-9, 'pitch never rises under braking');
    previous = state.rpm;
  }
  assert.ok(state.rpm < top - 800, `fell from ${top} to ${state.rpm}`);
  assert.equal(state.load < 0.01, true);
  assert.ok(settle(parked, 5, state).rpm === A.idleRpm);
});

test('reverse is a plausible low-to-moderate response', () => {
  const game = createGame();
  startRun(game);
  const state = createAudioState();
  let peak = 0;
  for (let frame = 0; frame < 60 * 6; frame++) {
    tick(game, { down: true });
    tick(game, { down: true });
    stepAudioState(state, readTelemetry(game.car), FRAME);
    peak = Math.max(peak, state.rpm);
  }
  assert.ok(game.car.forwardSpeed < -2, 'the car did reverse');
  assert.ok(state.rpm > A.idleRpm + 500, `reversing at ${state.rpm}`);
  assert.ok(peak <= A.idleRpm + A.reverseSpeedRpm + A.reverseThrottleRpm + 1, `peak ${peak}`);
  assert.ok(peak < 3000);
});

test('the model gives the same sound at any frame rate', () => {
  const telemetry = car({ speed: 25, forwardSpeed: 25, throttle: 1, rearSlip: 30 * DEG, frontSlip: 10 * DEG, rearGrip: 0.6 });
  const results = [30, 60, 144, 240].map((hz) => {
    const state = createAudioState();
    for (let i = 0; i < hz * 3; i++) stepAudioState(state, telemetry, 1 / hz);
    return state;
  });
  for (const r of results) {
    assert.ok(Math.abs(r.rpm - results[1].rpm) < 1, `${r.rpm} vs ${results[1].rpm}`);
    assert.ok(Math.abs(r.tire - results[1].tire) < 1e-3);
    assert.ok(Math.abs(r.load - results[1].load) < 1e-3);
  }
});

test('stationary tires are silent whatever the slip reads, and on every surface', () => {
  for (const surface of ['road', 'curb', 'grass']) for (let slip = 0; slip <= 90; slip += 5) for (const rearGrip of [1, 0.6, 0.26]) {
    const telemetry = car({ speed: 0, rearSlip: slip * DEG, frontSlip: slip * DEG, slipAngle: slip * DEG, rearGrip, surface });
    assert.equal(tireTarget(telemetry), 0);
    assert.equal(settle(telemetry, 1).tire, 0);
  }
  assert.equal(tireTarget(car({ speed: A.stillSpeed, rearSlip: 45 * DEG })), 0);
});

test('straight-line driving makes no tire noise, even with the handbrake rear loosened', () => {
  for (const rearGrip of [1, 0.26]) {
    assert.equal(tireTarget(car({ speed: 40, forwardSpeed: 40, rearGrip })), 0);
  }
  assert.equal(tireTarget(car({ speed: 40, forwardSpeed: 40, rearSlip: 0.5 * DEG, frontSlip: 0.5 * DEG })), 0);
});

test('tire noise grows progressively with rear slip and with speed, without steps', () => {
  let previous = 0;
  for (let slip = 0; slip <= 60; slip += 0.1) {
    const value = tireTarget(car({ speed: 25, rearSlip: slip * DEG }));
    assert.ok(value >= previous - 1e-9, `at ${slip} degrees`);
    assert.ok(value - previous < 0.02, `step at ${slip} degrees`);
    previous = value;
  }
  const scrub = tireTarget(car({ speed: 25, rearSlip: 4 * DEG, frontSlip: 7 * DEG }));
  const breaking = tireTarget(car({ speed: 25, rearSlip: 14 * DEG, frontSlip: 7 * DEG }));
  const sliding = tireTarget(car({ speed: 25, rearSlip: 32 * DEG, frontSlip: 7 * DEG }));
  assert.ok(scrub > 0 && scrub < 0.2, `cornering scrub ${scrub}`);
  assert.ok(breaking > scrub * 1.5);
  assert.ok(sliding > 0.7 && sliding > breaking * 1.5, `sliding ${sliding}`);
  const slow = tireTarget(car({ speed: 10, rearSlip: 32 * DEG }));
  const fast = tireTarget(car({ speed: 35, rearSlip: 32 * DEG }));
  assert.ok(fast > slow);
});

test('tire sound follows physics only: it needs no handbrake and no score', () => {
  const telemetry = car({ speed: 25, forwardSpeed: 15, rearSlip: 30 * DEG });
  assert.ok(tireTarget(telemetry) > 0.5, 'a slide with a free rear still squeals');
  assert.equal('handbrake' in readTelemetry({ handbrake: true }), false);
  assert.deepEqual(Object.keys(readTelemetry({})).sort(), [
    'brake', 'forwardSpeed', 'frontSlip', 'rearGrip', 'rearSlip', 'reversing', 'slipAngle', 'speed', 'surface', 'throttle',
  ]);
});

test('grass is softer and less sharp than the road', () => {
  const on = (surface) => {
    const state = settle(car({ speed: 25, rearSlip: 35 * DEG, surface }));
    return tireParams(state);
  };
  assert.ok(on('grass').tireIntensity < on('road').tireIntensity * 0.5);
  assert.ok(on('grass').tireCutoff < on('road').tireCutoff * 0.5);
  assert.equal(on('curb').tireIntensity, on('road').tireIntensity);
});

test('tire noise fades smoothly when traction returns, without retriggering', () => {
  const state = settle(car({ speed: 25, rearSlip: 35 * DEG }), 1);
  const start = state.tire;
  assert.ok(start > 0.8);
  let previous = start;
  let time = 0;
  while (state.tire > 0.01 && time < 3) {
    stepAudioState(state, car({ speed: 25 }), FRAME);
    assert.ok(state.tire < previous, 'never rises on the way down');
    assert.ok(previous - state.tire < 0.1, 'no cliff');
    previous = state.tire;
    time += FRAME;
  }
  assert.ok(time > 0.3 && time < 3, `settled in ${time} s`);
});

test('a stopped run or a reset leaves nothing behind', () => {
  const state = settle(car({ speed: 30, forwardSpeed: 30, throttle: 1, rearSlip: 40 * DEG }));
  for (let t = 0; t < 6; t += FRAME) stepAudioState(state, car({ speed: 30, rearSlip: 40 * DEG, throttle: 1 }), FRAME, false);
  assert.ok(state.tire < 1e-3, `finished car tire ${state.tire}`);
  assert.equal(state.rpm, A.idleRpm);
  const hot = settle(car({ speed: 30, forwardSpeed: 30, throttle: 1, rearSlip: 40 * DEG }));
  resetAudioState(hot);
  assert.deepEqual(hot, createAudioState());
});

// --- Against the real simulation -------------------------------------------

function drive(driver, frames = 60 * 200) {
  const game = createGame();
  startRun(game);
  const state = createAudioState();
  const rows = [];
  for (let frame = 0; frame < frames && game.state !== 'finished'; frame++) {
    tick(game, driver(game));
    if (game.state !== 'finished') tick(game, driver(game));
    stepAudioState(state, readTelemetry(game.car), FRAME);
    rows.push({
      rpm: state.rpm, tire: state.tire, speed: game.car.speed, throttle: game.car.throttle,
      slip: Math.abs(game.car.slipAngle) / DEG, rear: Math.abs(game.car.rearSlip) / DEG, front: Math.abs(game.car.frontSlip) / DEG,
    });
  }
  return rows;
}

const mean = (rows, key) => rows.reduce((sum, r) => sum + r[key], 0) / rows.length;

test('a controlled power drift keeps the engine up and the tires loud', () => {
  const rows = drive(driftDriver());
  const windows = [];
  let current = [];
  for (const row of rows) {
    if (row.slip > 15 && row.throttle > 0.9 && row.speed > 8) current.push(row);
    else {
      if (current.length > 36) windows.push(current);
      current = [];
    }
  }
  assert.ok(windows.length >= 5, `found ${windows.length} power drifts`);
  for (const window of windows) {
    let peak = 0;
    for (const { rpm } of window) {
      peak = Math.max(peak, rpm);
      assert.ok(peak - rpm < 500, `engine pitch sagged ${peak - rpm} RPM in a held drift`);
    }
  }
  const held = windows.flat();
  assert.ok(mean(held, 'rpm') > 4500, `drifting at ${mean(held, 'rpm')} RPM`);
  assert.ok(mean(held, 'tire') > 0.6, `drift tires ${mean(held, 'tire')}`);
});

test('a sustained drift sounds clearly different from ordinary cornering and straights', () => {
  const grip = drive(gripDriver());
  const corners = grip.filter((r) => r.front > 3 && r.rear < 6 && r.speed > 8);
  const straights = grip.filter((r) => r.front < 0.5 && r.rear < 0.5 && r.speed > 8);
  assert.ok(corners.length > 300 && straights.length > 100);
  assert.ok(mean(straights, 'tire') < 0.02, `straights ${mean(straights, 'tire')}`);
  assert.ok(mean(corners, 'tire') > 0.04 && mean(corners, 'tire') < 0.2, `cornering ${mean(corners, 'tire')}`);
  const drifts = drive(driftDriver()).filter((r) => r.slip > 20 && r.speed > 8);
  assert.ok(mean(drifts, 'tire') > mean(corners, 'tire') * 4, `drifts ${mean(drifts, 'tire')}`);
});

test('RPM never jumps across a whole driven run', () => {
  for (const driver of [gripDriver(), driftDriver()]) {
    let previous = A.idleRpm;
    for (const { rpm } of drive(driver)) {
      assert.ok(Math.abs(rpm - previous) <= A.rpmRiseLimit * FRAME + 1e-9, `${previous} to ${rpm}`);
      previous = rpm;
    }
  }
});
