// The audio-only virtual gearbox, alone and driven by the real simulation. It must
// change what is heard and nothing else: see also the determinism test in
// test/audio-lifecycle.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_TUNING as A, createAudioState, engineParams, engineTarget, gearForSpeed, readTelemetry, resetAudioState, stepAudioState, stepGears,
} from '../src/audio-telemetry.js';
import { createGame, startRun, tick } from '../src/game.js';
import { TUNING } from '../src/tuning.js';
import { driftDriver, gripDriver, recklessDriver } from './support/drivers.mjs';

const DEG = Math.PI / 180;
const FRAME = 1 / 60;
const G = A.gears;
const parked = Object.freeze({
  speed: 0, forwardSpeed: 0, throttle: 0, brake: 0, slipAngle: 0, frontSlip: 0, rearSlip: 0, rearGrip: 1, surface: 'road', reversing: false,
});
const car = (values) => ({ ...parked, ...values });

function hold(telemetry, seconds, state = createAudioState(), dt = FRAME) {
  for (let t = 0; t < seconds; t += dt) stepAudioState(state, telemetry, dt);
  return state;
}

// Drives the real simulation and records the gearbox each rendered frame.
function drive(driver, { seconds = 200, frame = FRAME, tuning = A } = {}) {
  const game = createGame();
  startRun(game);
  const state = createAudioState(tuning);
  const substeps = Math.round(frame / TUNING.simStep);
  const rows = [];
  for (let f = 0; f < seconds / frame && game.state !== 'finished'; f++) {
    for (let i = 0; i < substeps && game.state !== 'finished'; i++) tick(game, driver(game));
    const before = state.gear;
    stepAudioState(state, readTelemetry(game.car), frame, true, tuning);
    rows.push({
      t: f * frame, gear: state.gear, shifted: state.gear !== before && before > 0 && state.gear > 0, from: before, rpm: state.rpm, tire: state.tire,
      speed: game.car.speed, rear: Math.abs(game.car.rearSlip) / DEG, throttle: game.car.throttle, load: state.load, shiftLeft: state.shiftLeft,
    });
  }
  return rows;
}

const shiftsIn = (rows) => rows.filter((r) => r.shifted);
const flatOut = () => ({ up: true });
const namedDrivers = () => [['grip', gripDriver()], ['drift', driftDriver()], ['reckless', recklessDriver()]];

test('a stationary car is in first, and speed picks the gear', () => {
  assert.equal(createAudioState().gear, 1);
  assert.equal(hold(parked, 1).gear, 1);
  for (const [speed, gear] of [[0, 1], [G.topSpeeds[0] - 0.01, 1], [G.topSpeeds[0], 2], [G.topSpeeds[1], 3], [G.topSpeeds[2], 4], [999, 4], [NaN, 1], [-5, 1]]) {
    assert.equal(gearForSpeed(speed), gear, `speed ${speed}`);
  }
});

test('full throttle climbs through all four gears in order, never back down', () => {
  const rows = drive(flatOut, { seconds: 6 });
  const shifts = shiftsIn(rows);
  assert.deepEqual(shifts.map((r) => [r.from, r.gear]), [[1, 2], [2, 3], [3, 4]]);
  shifts.forEach((row, i) => {
    assert.ok(row.speed >= G.topSpeeds[i], `upshift ${i} at ${row.speed}`);
    assert.ok(row.speed < G.topSpeeds[i] + 1.5, `upshift ${i} came late, at ${row.speed}`);
  });
});

test('each upshift lowers the RPM smoothly and by a noticeable share, then RPM builds again', () => {
  const rows = drive(flatOut, { seconds: 6 });
  for (const shift of shiftsIn(rows)) {
    const at = rows.indexOf(shift);
    const before = rows[at - 1].rpm;
    const after = rows.slice(at, at + 40);
    const lowest = after.reduce((low, r) => (r.rpm < low.rpm ? r : low));
    const drop = 1 - lowest.rpm / before;
    assert.ok(drop > 0.18 && drop < 0.4, `${shift.from} to ${shift.gear} dropped ${(drop * 100).toFixed(0)}%`);
    const took = lowest.t - shift.t;
    assert.ok(took >= 0.08 && took <= 0.4, `drop took ${took} s`);
    for (let i = at; i < rows.indexOf(lowest); i++) {
      assert.ok(rows[i].rpm - rows[i + 1].rpm <= G.shiftFallLimit * FRAME + 1e-9, 'no jump within the drop');
    }
    assert.ok(rows[at + 60].rpm > lowest.rpm + 200, 'RPM builds in the next gear');
  }
});

test('RPM stays within bounds in every gear, for any input', () => {
  const extremes = [0, 1, -1, 12, 20, 29, 42, 1e9, -1e9, NaN, Infinity, -Infinity, undefined];
  for (const speed of extremes) for (const throttle of extremes) for (const rearSlip of extremes) {
    const telemetry = car({ speed, forwardSpeed: speed, throttle, rearSlip });
    for (const gear of [0, 1, 2, 3, 4]) assert.ok(Number.isFinite(engineTarget(telemetry, A, gear)));
    const state = stepAudioState(createAudioState(), telemetry, FRAME);
    assert.ok(state.rpm >= A.idleRpm && state.rpm <= A.maxRpm);
    assert.ok([0, 1, 2, 3, 4].includes(state.gear), `gear ${state.gear}`);
    const { throttle: load } = engineParams(state);
    assert.ok(load >= 0 && load <= 1);
  }
  for (const [, driver] of namedDrivers()) {
    for (const { rpm } of drive(driver)) assert.ok(rpm >= A.idleRpm && rpm <= A.drivingMaxRpm, `rpm ${rpm}`);
  }
});

test('braking downshifts on the way to a stop, ending in first', () => {
  const game = createGame();
  startRun(game);
  const state = createAudioState();
  for (let f = 0; f < 60 * 5; f++) {
    tick(game, flatOut());
    tick(game, flatOut());
    stepAudioState(state, readTelemetry(game.car), FRAME);
  }
  assert.equal(state.gear, 4);
  const gears = [state.gear];
  while (game.car.forwardSpeed > 0.5 && !game.car.reversing) {
    tick(game, { down: true });
    tick(game, { down: true });
    stepAudioState(state, readTelemetry(game.car), FRAME);
    if (state.gear !== gears.at(-1)) gears.push(state.gear);
  }
  // The car reports reversing just before it stops, which takes the gearbox out of gear.
  const forward = gears.filter((gear) => gear > 0);
  for (let i = 1; i < forward.length; i++) assert.ok(forward[i] < forward[i - 1], `gears ${gears}`);
  assert.equal(forward.at(-1), 1);
});

test('speed wandering across a shift point changes gear once, not repeatedly', () => {
  for (const top of G.topSpeeds.slice(0, 3)) {
    const state = createAudioState();
    let t = 0;
    for (; t < 3; t += FRAME) stepAudioState(state, car({ speed: top - 1, forwardSpeed: top - 1, throttle: 1 }), FRAME);
    const start = state.shifts;
    for (; t < 23; t += FRAME) {
      const speed = top + 0.8 * Math.sin(t * 5);
      stepAudioState(state, car({ speed, forwardSpeed: speed, throttle: Math.sin(t * 3) > 0 ? 1 : 0 }), FRAME);
    }
    assert.equal(state.shifts - start, 1, `around ${top}`);
  }
});

test('shifts are never closer together than the minimum interval', () => {
  for (const [name, driver] of [...namedDrivers(), ['flat out', flatOut]]) {
    const times = shiftsIn(drive(driver)).map((r) => r.t);
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i] - times[i - 1] >= G.minShiftInterval - FRAME, `${name}: ${times[i - 1]} to ${times[i]}`);
    }
  }
});

test('real driving neither hunts between gears nor shifts constantly', () => {
  for (const [name, driver] of namedDrivers()) {
    const rows = drive(driver);
    const shifts = shiftsIn(rows);
    const minutes = rows.at(-1).t / 60;
    assert.ok(shifts.length > 5, `${name} used the gears: ${shifts.length}`);
    assert.ok(shifts.length / minutes < 25, `${name}: ${(shifts.length / minutes).toFixed(0)} shifts a minute`);
    let bounces = 0;
    for (let i = 2; i < shifts.length; i++) {
      if (shifts[i].gear === shifts[i - 2].gear && shifts[i].t - shifts[i - 2].t < 2) bounces += 1;
    }
    assert.equal(bounces, 0, `${name} went back and forth`);
  }
});

test('the gear holds through a power slide, whatever the speed does', () => {
  const state = hold(car({ speed: 25, forwardSpeed: 25, throttle: 1 }), 2);
  const gear = state.gear;
  const before = state.shifts;
  for (let t = 0; t < 6; t += FRAME) {
    const speed = 25 + 15 * Math.sin(t * 2);
    stepAudioState(state, car({ speed, forwardSpeed: speed * 0.7, throttle: 1, rearSlip: 30 * DEG }), FRAME);
  }
  assert.equal(state.gear, gear);
  assert.equal(state.shifts, before);
  // Once the slide is over the gearbox catches up, once.
  for (let t = 0; t < G.slideHoldTime + 0.1; t += FRAME) stepAudioState(state, car({ speed: 38, forwardSpeed: 38, throttle: 1 }), FRAME);
  assert.equal(state.gear, 4);
  assert.equal(state.shifts, before + 1);
});

test('no shift happens during a held slide in real driving', () => {
  for (const [name, driver] of namedDrivers()) {
    for (const shift of shiftsIn(drive(driver))) {
      assert.ok(shift.rear < G.slideHoldSlip, `${name} shifted at ${shift.rear} degrees of rear slip`);
    }
  }
});

test('a full power slide plays the approved mapping, in any gear', () => {
  const approved = ({ speed, throttle }) => {
    const ratio = Math.min(1, speed / A.referenceSpeed);
    return Math.min(A.drivingMaxRpm, A.idleRpm + (A.coastRpmAtReference - A.idleRpm) * ratio ** A.speedCurve
      + throttle * (A.launchFlare + (A.topSpeedFlare - A.launchFlare) * ratio) + A.spinFlare);
  };
  for (const speed of [10, 15, 20, 25, 30, 38]) {
    const telemetry = car({ speed, forwardSpeed: speed * 0.8, throttle: 1, rearSlip: 32 * DEG });
    for (const gear of [1, 2, 3, 4]) {
      assert.ok(Math.abs(engineTarget(telemetry, A, gear) - approved(telemetry)) < 1e-6, `gear ${gear} at ${speed}`);
    }
  }
});

test('reverse is separate: no gears, the same line as before, and first on the way out', () => {
  const state = hold(car({ speed: 6, forwardSpeed: -6, throttle: 1, reversing: true }), 2);
  assert.equal(state.gear, 0);
  assert.equal(state.shifts, 0);
  const expected = A.idleRpm + (6 / A.reverseSpeed) * A.reverseSpeedRpm + A.reverseThrottleRpm;
  assert.ok(Math.abs(state.rpm - expected) < 1, `reverse at ${state.rpm}`);
  hold(car({ speed: 3, forwardSpeed: 3, throttle: 1 }), 0.2, state);
  assert.equal(state.gear, 1);
  assert.equal(state.shifts, 0, 'leaving reverse is not a heard shift');
});

test('the shift is the same at any frame rate, steady or uneven', () => {
  const at = (rows) => shiftsIn(rows).map((r) => r.t);
  const reference = at(drive(flatOut, { seconds: 6, frame: 1 / 60 }));
  // The simulation advances in 1/120 s steps, so use rates it divides evenly.
  for (const hz of [30, 40, 120]) {
    const times = at(drive(flatOut, { seconds: 6, frame: 1 / hz }));
    assert.equal(times.length, reference.length, `${hz} Hz`);
    times.forEach((t, i) => assert.ok(Math.abs(t - reference[i]) < 2 / 30 + 1e-9, `${hz} Hz shift ${i}: ${t} vs ${reference[i]}`));
  }
  // The gearbox alone, on a fixed speed ramp with uneven frames.
  const ramp = (frames) => {
    const state = createAudioState();
    let time = 0, index = 0;
    const seen = [];
    while (time < 8) {
      const dt = frames[index++ % frames.length];
      time += dt;
      const speed = time * 5;
      const before = state.gear;
      stepAudioState(state, car({ speed, forwardSpeed: speed, throttle: 1 }), dt);
      if (state.gear !== before) seen.push(time);
    }
    return { seen, rpm: state.rpm };
  };
  const steady = ramp([FRAME]);
  for (const frames of [[1 / 144], [1 / 240], [1 / 30], [1 / 144, 1 / 30, 1 / 90, 0.05]]) {
    const uneven = ramp(frames);
    assert.equal(uneven.seen.length, steady.seen.length);
    uneven.seen.forEach((t, i) => assert.ok(Math.abs(t - steady.seen[i]) <= Math.max(...frames) + FRAME, `${t} vs ${steady.seen[i]}`));
    assert.ok(Math.abs(uneven.rpm - steady.rpm) < 40, `${uneven.rpm} vs ${steady.rpm}`);
  }
});

test('an upshift briefly eases the load and tightens the pitch glide, then both return', () => {
  const state = hold(car({ speed: 11, forwardSpeed: 11, throttle: 1 }), 1.5);
  assert.equal(engineParams(state).glide, undefined);
  assert.ok(Math.abs(engineParams(state).throttle - state.load) < 1e-9);
  const moving = car({ speed: 12.5, forwardSpeed: 12.5, throttle: 1 });
  stepAudioState(state, moving, FRAME);
  assert.equal(state.gear, 2);
  let deepest = 1;
  for (let t = 0; t < G.shiftTime; t += FRAME) {
    const params = engineParams(state);
    assert.equal(params.glide, state.shiftLeft > 0 ? G.shiftGlide : undefined);
    assert.ok(params.throttle >= state.load * (1 - G.shiftLoadDip) - 1e-9, 'the dip stays subtle');
    deepest = Math.min(deepest, params.throttle / state.load);
    stepAudioState(state, moving, FRAME);
  }
  assert.ok(deepest < 0.85, `load only fell to ${deepest}`);
  hold(moving, 0.1, state);
  assert.equal(engineParams(state).glide, undefined);
  assert.ok(Math.abs(engineParams(state).throttle - state.load) < 1e-9);
});

test('a downshift does not dip the load', () => {
  const state = hold(car({ speed: 25, forwardSpeed: 25, throttle: 1 }), 2);
  assert.equal(state.gear, 3);
  stepAudioState(state, car({ speed: 10, forwardSpeed: 10, throttle: 1 }), FRAME);
  assert.ok(state.gear < 3);
  assert.equal(state.shiftDirection, -1);
  assert.ok(Math.abs(engineParams(state).throttle - state.load) < 1e-9);
});

test('a finished run settles without shifting, and a reset returns to first', () => {
  const state = hold(car({ speed: 35, forwardSpeed: 35, throttle: 1 }), 2);
  const { gear, shifts } = state;
  assert.equal(gear, 4);
  for (let t = 0; t < 6; t += FRAME) stepAudioState(state, car({ speed: 3, forwardSpeed: 3 }), FRAME, false);
  assert.equal(state.gear, gear);
  assert.equal(state.shifts, shifts);
  assert.equal(state.rpm, A.idleRpm);
  assert.equal(state.shiftLeft, 0);
  resetAudioState(state);
  assert.deepEqual(state, createAudioState());
  assert.equal(state.gear, 1);
});

test('gear state is a value the gearbox keeps to itself', () => {
  const telemetry = Object.freeze(car({ speed: 20, forwardSpeed: 20, throttle: 1 }));
  assert.doesNotThrow(() => stepGears(createAudioState(), telemetry, FRAME));
  assert.equal('gear' in readTelemetry({ gear: 3 }), false);
  assert.equal(Object.isFrozen(A.gears), true);
  assert.equal(Object.isFrozen(A.gears.topSpeeds), true);
  for (const key of Object.keys(TUNING)) assert.doesNotMatch(key, /gear|shift/i, 'physics tuning knows nothing of gears');
});

test('tires hear nothing of the gearbox', () => {
  const other = Object.freeze({ ...A, gears: Object.freeze({ ...A.gears, topSpeeds: Object.freeze([8, 14, 25, 42]), minShiftInterval: 0.3, slideHoldSlip: 45 }) });
  for (const make of [gripDriver, driftDriver]) {
    const these = drive(make());
    const those = drive(make(), { tuning: other });
    assert.equal(these.length, those.length);
    assert.notDeepEqual(these.map((r) => r.gear), those.map((r) => r.gear), 'the two gearboxes really differ');
    these.forEach((row, i) => assert.equal(row.tire, those[i].tire, `frame ${i}`));
  }
});

test('held power drifts stay up in the approved range', () => {
  const rows = drive(driftDriver());
  const windows = [];
  let current = [];
  for (const row of rows) {
    if (row.rear > 15 && row.throttle > 0.9 && row.speed > 8) current.push(row);
    else {
      if (current.length > 36) windows.push(current);
      current = [];
    }
  }
  assert.ok(windows.length >= 3, `${windows.length} held drifts`);
  for (const window of windows) {
    assert.ok(shiftsIn(window).length === 0, 'no shift inside a held drift');
    const rpm = window.reduce((sum, r) => sum + r.rpm, 0) / window.length;
    assert.ok(rpm > 4800, `held drift averaged ${rpm} RPM`);
  }
});
