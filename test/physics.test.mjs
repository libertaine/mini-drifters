import test from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as T } from '../src/tuning.js';
import { createCar, stepCar, slipAngleOf, steerLimit, tyreCurve } from '../src/physics.js';

const DEG = Math.PI / 180;

function simulate(script, seconds, { speed = 0, surface = 'road', tuning = T, onStep } = {}) {
  const car = createCar({ x: 0, y: 0, heading: 0 });
  car.vx = speed;
  const steps = Math.round(seconds / T.simStep);
  let peakSlip = 0;
  let peakYaw = 0;
  let spinTime = 0;
  for (let i = 0; i < steps; i += 1) {
    const t = i * T.simStep;
    stepCar(car, script(t, car), typeof surface === 'function' ? surface(t) : surface, T.simStep, tuning);
    const slip = Math.abs(car.slipAngle);
    peakSlip = Math.max(peakSlip, slip);
    peakYaw = Math.max(peakYaw, Math.abs(car.yawRate));
    if (slip > T.spinoutSlip) spinTime += T.simStep;
    onStep?.(car, t);
  }
  return { car, peakSlip, peakYaw, spinTime };
}

// --- 1. Acceleration and braking --------------------------------------------
test('acceleration is gradual, and top speed is approached but not passed', () => {
  const at1 = simulate(() => ({ up: true }), 1).car.speed;
  const at3 = simulate(() => ({ up: true }), 3).car.speed;
  const at20 = simulate(() => ({ up: true }), 20).car.speed;
  assert.ok(at1 > 6 && at1 < 14, `after 1 s: ${at1}`);
  assert.ok(at3 > at1 * 1.8, `after 3 s: ${at3}`);
  assert.ok(at20 > T.topSpeed * 0.97 && at20 <= T.topSpeed + 0.01, `after 20 s: ${at20}`);
});

test('releasing the throttle slows the car gently; braking slows it far harder', () => {
  const coast = simulate(() => ({}), 1, { speed: 30 }).car.speed;
  const brake = simulate(() => ({ down: true }), 1, { speed: 30 }).car.speed;
  assert.ok(coast > 27 && coast < 30, `coasting: ${coast}`);
  assert.ok(brake < 10, `braking: ${brake}`);
});

test('Down brakes to a stop, then reverses at a limited speed', () => {
  const { car } = simulate(() => ({ down: true }), 8, { speed: 20 });
  assert.ok(car.forwardSpeed < -T.reverseTopSpeed * 0.8, `reverse: ${car.forwardSpeed}`);
  assert.ok(car.forwardSpeed >= -T.reverseTopSpeed - 0.01);
});

test('a parked car stays parked, even with the wheel turned and the handbrake on', () => {
  const { car } = simulate(() => ({ right: true, handbrake: true }), 3);
  assert.equal(car.x, 0);
  assert.equal(car.y, 0);
  assert.equal(car.heading, 0);
});

// --- 2. Steering ------------------------------------------------------------
test('steering builds smoothly rather than snapping to full lock', () => {
  let afterOneStep = null;
  const { car } = simulate(() => ({ right: true, up: true }), 0.6, {
    speed: 15,
    onStep: (c) => { afterOneStep ??= c.steer; },
  });
  assert.ok(afterOneStep < 0.1, `first step: ${afterOneStep}`);
  assert.equal(car.steer, 1);
});

test('available steering lock shrinks as speed rises', () => {
  assert.ok(steerLimit(5) > steerLimit(15));
  assert.ok(steerLimit(15) > steerLimit(30));
  assert.ok(steerLimit(40) < 12 * DEG, `high speed: ${steerLimit(40) / DEG} deg`);
  assert.equal(steerLimit(1), T.maxWheelAngle);
});

test('left and right are mirror images', () => {
  const right = simulate(() => ({ up: true, right: true }), 2, { speed: 20 }).car;
  const left = simulate(() => ({ up: true, left: true }), 2, { speed: 20 }).car;
  assert.ok(right.heading > 0.5, 'right turns the nose clockwise on screen');
  assert.ok(Math.abs(right.heading + left.heading) < 1e-9);
  assert.ok(Math.abs(right.y + left.y) < 1e-9);
});

test('grip cornering is stable: full lock with throttle at any speed never spins', () => {
  for (const speed of [10, 20, 30, 40]) {
    const r = simulate(() => ({ up: true, right: true }), 6, { speed });
    assert.ok(r.peakSlip < 8 * DEG, `peak slip at ${speed} m/s: ${r.peakSlip / DEG} deg`);
  }
});

test('heading cannot change without a matching change in the velocity direction taking time', () => {
  // A quick turn-in points the nose before the car has fully changed direction.
  const { car } = simulate(() => ({ right: true }), 0.45, { speed: 28 });
  const travel = Math.atan2(car.vy, car.vx);
  assert.ok(car.heading > 0.05);
  assert.notEqual(car.heading.toFixed(4), travel.toFixed(4));
});

// --- 3. Lateral velocity and drift angle ------------------------------------
test('slip angle is the signed angle between nose and travel', () => {
  assert.equal(slipAngleOf(20, 0), 0);
  assert.ok(Math.abs(slipAngleOf(20, 20) - 45 * DEG) < 1e-9);
  assert.ok(Math.abs(slipAngleOf(20, -20) + 45 * DEG) < 1e-9);
  assert.equal(slipAngleOf(0.3, 0.3), 0, 'meaningless when nearly stopped');
});

test('body-frame velocity is computed from heading, independent of travel', () => {
  const car = createCar({ heading: Math.PI / 2 });  // nose pointing down the screen
  car.vx = 10;                                      // travelling to the right
  stepCar(car, {}, 'road', T.simStep);
  assert.ok(Math.abs(car.forwardSpeed) < 1);
  assert.ok(car.lateralSpeed < -9, `lateral ${car.lateralSpeed}`);
  assert.ok(Math.abs(Math.abs(car.slipAngle) - 90 * DEG) < 8 * DEG);
});

test('a drifting car reports substantial lateral velocity', () => {
  let lateral = 0;
  simulate((t) => ({ up: true, right: t > 0.1 && t < 0.8, handbrake: t > 0.3 && t < 0.6 }), 2, {
    speed: 25,
    onStep: (c) => { lateral = Math.max(lateral, Math.abs(c.lateralSpeed)); },
  });
  assert.ok(lateral > 8, `peak lateral ${lateral}`);
});

test('tyre grip rises to its peak, then eases off without a cliff', () => {
  const curve = (deg) => tyreCurve(deg * DEG, T.rearPeakSlip, T.rearSlideGrip, T.slideFalloff);
  assert.equal(curve(0), 0);
  assert.ok(Math.abs(curve(T.rearPeakSlip / DEG) - 1) < 1e-9);
  assert.ok(curve(4) > 0.5 && curve(4) < 1);
  assert.ok(curve(90) > T.rearSlideGrip - 1e-9 && curve(90) < 0.85);
  assert.equal(curve(-20), -curve(20));
  for (let d = 0.5; d < 60; d += 0.5) {
    assert.ok(Math.abs(curve(d + 0.5) - curve(d)) < 0.13, `jump near ${d} deg`);
  }
});

// --- 4. Handbrake -----------------------------------------------------------
test('the handbrake reduces rear grip progressively and recovers progressively', () => {
  const samples = [];
  simulate((t) => ({ handbrake: t < 0.5 }), 1.1, { speed: 20, onStep: (c, t) => samples.push([t, c.rearGrip]) });
  const at = (time) => samples.find(([t]) => t >= time)[1];
  assert.ok(at(0.03) > 0.6, `not instant: ${at(0.03)}`);
  assert.ok(Math.abs(at(0.45) - T.handbrakeLateralGrip) < 1e-9, `held: ${at(0.45)}`);
  assert.ok(at(0.6) > at(0.45) && at(0.6) < 0.7, `recovering: ${at(0.6)}`);
  assert.equal(at(1.05), 1);
});

test('the handbrake does nothing to the heading of a car driving straight', () => {
  const r = simulate(() => ({ handbrake: true }), 1, { speed: 25 });
  assert.ok(Math.abs(r.car.heading) < 1e-6);
  assert.ok(r.car.speed < 25 - T.handbrakeDrag * 0.6, `slowed to ${r.car.speed}`);
});

test('a tap, a pull and a held handbrake give clearly different results', () => {
  const run = (until) => simulate((t) => ({ up: true, right: t > 0.1, handbrake: t > 0.3 && t < until }), 4, { speed: 25 });
  const tap = run(0.4);
  const pull = run(0.65);
  const held = run(99);
  assert.ok(tap.peakSlip < 30 * DEG, `tap: ${tap.peakSlip / DEG}`);
  assert.ok(tap.spinTime === 0);
  assert.ok(pull.peakSlip > 40 * DEG && pull.peakSlip < 75 * DEG, `pull: ${pull.peakSlip / DEG}`);
  assert.ok(pull.spinTime === 0);
  assert.ok(held.peakSlip > 100 * DEG, `held: ${held.peakSlip / DEG}`);
  assert.ok(held.car.speed < 5, `held stops the car: ${held.car.speed}`);
});

test('handbrake rotation comes from the tyre model, not a fixed angle', () => {
  // The same input gives more rotation with more speed; at rest it gives none.
  const slow = simulate((t) => ({ right: t > 0.1, handbrake: t > 0.3 && t < 0.6 }), 1.5, { speed: 12 });
  const fast = simulate((t) => ({ right: t > 0.1, handbrake: t > 0.3 && t < 0.6 }), 1.5, { speed: 30 });
  assert.ok(fast.peakSlip > slow.peakSlip, `${fast.peakSlip / DEG} vs ${slow.peakSlip / DEG}`);
});

test('a longer handbrake pull gives a bigger slide, with no sudden snap between them', () => {
  // Players cannot time a key press to 20 ms, so neighbouring lengths must feel alike.
  const lengths = [0.06, 0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2, 0.22, 0.25, 0.3, 0.35];
  for (const speed of [18, 24, 30]) {
    let previous = 0;
    for (const length of lengths) {
      const { peakSlip } = simulate((t) => ({ up: true, right: t > 0.1, handbrake: t > 0.3 && t < 0.3 + length }), 6, { speed });
      assert.ok((peakSlip - previous) / DEG < 15,
        `at ${speed} m/s, ${length} s: ${(previous / DEG).toFixed(0)} to ${(peakSlip / DEG).toFixed(0)} deg`);
      previous = peakSlip;
    }
  }
});

test('going sideways does not give the car extra engine power', () => {
  const after = (heading) => {
    const car = createCar({ heading });
    car.vx = 36;
    for (let i = 0; i < 12; i += 1) stepCar(car, { up: true }, 'road', T.simStep);
    return car;
  };
  // Over a tenth of a second, tyre forces and thrust together must lose speed when sideways.
  assert.ok(after(45 * DEG).speed < after(0).speed - 0.3, `${after(45 * DEG).speed} vs ${after(0).speed}`);
});

test('fishtailing at speed costs real speed', () => {
  // Steers the nose at a straight-ahead target from a small upset, at full throttle.
  let keys = {};
  let next = 0;
  const { car } = simulate((t, c) => {
    if (t >= next) {
      next = t + 1 / 15;
      keys = { up: true, left: c.heading > 0.044, right: c.heading < -0.044 };
    }
    return keys;
  }, 7, {
    speed: 36,
    onStep: (c, t) => { if (t === 0) c.heading = 0.3; },
  });
  assert.ok(car.speed < 33, `still doing ${car.speed} m/s`);
});

// --- 5. Countersteering and recovery ----------------------------------------
const entry = (t) => t > 0.1 && t < 0.7;
const pull = (t) => t > 0.3 && t < 0.6;

test('steering into a slide shrinks it faster than doing nothing', () => {
  const hands = simulate((t) => ({ up: true, right: entry(t), handbrake: pull(t) }), 5, { speed: 25 });
  const caught = simulate((t) => ({ up: true, right: entry(t), left: t > 0.8 && t < 1.25, handbrake: pull(t) }), 5, { speed: 25 });
  assert.ok(caught.peakSlip < hands.peakSlip - 10 * DEG,
    `caught ${caught.peakSlip / DEG} vs hands-off ${hands.peakSlip / DEG}`);
});

test('countersteering earns extra front wheel angle', () => {
  let counterWheel = 0;
  simulate((t) => ({ up: true, right: t < 0.7, left: t >= 0.7, handbrake: pull(t) }), 1.1, {
    speed: 25,
    onStep: (c) => { if (c.slipAngle < -20 * DEG && c.steer < -0.9) counterWheel = Math.min(counterWheel, c.wheelAngle); },
  });
  assert.ok(Math.abs(counterWheel) > steerLimit(25) * 1.2, `wheel ${counterWheel / DEG} deg`);
});

test('lifting off collects a slide that would otherwise continue under power', () => {
  const secondsToSettle = (lift) => {
    let settled = null;
    simulate((t) => ({ up: t < 0.7 || !lift, right: entry(t), handbrake: pull(t) }), 6, {
      speed: 25,
      onStep: (c, t) => {
        if (Math.abs(c.slipAngle) > 10 * DEG) settled = null;
        else if (settled === null) settled = t;
      },
    });
    return settled;
  };
  const lifted = secondsToSettle(true);
  const powered = secondsToSettle(false);
  assert.ok(lifted !== null && lifted < 3.5, `lift settles at ${lifted}`);
  assert.ok(powered === null || powered > lifted + 1, `power settles at ${powered}`);
});

test('a drift can be held on the keyboard at human reaction speed', () => {
  // On/off keys, deciding 8 times a second: throttle on, steer to hold about 30 degrees.
  for (const speed of [18, 26]) {
    let keys = {};
    let nextDecision = 0;
    let inDrift = 0;
    let total = 0;
    const r = simulate((t, car) => {
      if (t < nextDecision) return keys;
      nextDecision = t + 1 / 8;
      const slip = car.slipAngle / DEG;
      keys = { up: car.speed < speed + 4 };
      if (t < 0.8) {
        keys.right = true;
        keys.handbrake = t > 0.2 && t < 0.55;
      } else {
        if (slip > -26) keys.right = true;
        else if (slip < -34) keys.left = true;
        if (Math.abs(slip) < 8) keys.handbrake = true;
      }
      return keys;
    }, 12, {
      speed,
      onStep: (c, t) => {
        if (t < 2) return;
        total += 1;
        const a = Math.abs(c.slipAngle);
        if (a >= T.driftMinSlip && a < T.spinoutSlip) inDrift += 1;
      },
    });
    assert.ok(inDrift / total > 0.5, `in drift ${(inDrift / total * 100).toFixed(0)}% at ${speed} m/s`);
    assert.ok(r.spinTime === 0, `spin time ${r.spinTime} at ${speed} m/s`);
  }
});

test('grip returns progressively after a drift: slip decays over time, not in one step', () => {
  const series = [];
  simulate((t) => ({ up: t < 0.7, right: entry(t), handbrake: pull(t) }), 4, { speed: 25, onStep: (c) => series.push(c.slipAngle) });
  let biggestStep = 0;
  for (let i = 1; i < series.length; i += 1) biggestStep = Math.max(biggestStep, Math.abs(series[i] - series[i - 1]));
  assert.ok(biggestStep < 1.5 * DEG, `largest slip change per step ${biggestStep / DEG} deg`);
});

// --- Surfaces ---------------------------------------------------------------
test('grass reduces acceleration and cornering, and blends in rather than snapping', () => {
  const road = simulate(() => ({ up: true }), 3).car.speed;
  const grass = simulate(() => ({ up: true }), 3, { surface: 'grass' }).car.speed;
  assert.ok(grass < road * 0.7, `grass ${grass} vs road ${road}`);

  const cornering = (surface) => {
    const { car } = simulate(() => ({ up: true, right: true }), 3, { speed: 15, surface });
    return Math.abs(car.yawRate) * car.speed;
  };
  assert.ok(cornering('grass') < cornering('road') * 0.7, `${cornering('grass')} vs ${cornering('road')}`);

  let firstStepTraction = null;
  simulate(() => ({}), 0.5, { surface: 'grass', speed: 20, onStep: (c) => { firstStepTraction ??= c.traction; } });
  assert.ok(firstStepTraction > 0.9, `after one step: ${firstStepTraction}`);
});
