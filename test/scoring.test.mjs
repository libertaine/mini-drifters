import test from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as T } from '../src/tuning.js';
import { createScoring, updateScoring, classifyDrift, angleScore, speedScore, currentMultiplier, bankCombo } from '../src/scoring.js';

const DEG = Math.PI / 180;
const dt = T.simStep;

// A healthy mid-corner drift, with overrides for each scenario.
const drifting = (over = {}) => ({
  speed: 25,
  forwardSpeed: 20,
  slipAngle: -35 * DEG,
  surface: 'road',
  progressRate: 22,
  newGround: 25 * dt,
  handbrake: false,
  impact: 0,
  ...over,
});
const straight = (over = {}) => drifting({ slipAngle: 0, forwardSpeed: 25, ...over });

function run(state, sample, seconds) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i += 1) updateScoring(state, sample, dt);
}

// --- 6. Drift qualification thresholds --------------------------------------
test('a slide qualifies only with speed, angle, road, progress and new ground', () => {
  const reason = (over, was = false) => classifyDrift(drifting(over), was, 0);
  assert.equal(reason({}), 'drifting');
  assert.equal(reason({ speed: T.topSpeed * T.driftMinSpeedRatio - 0.1 }), 'too slow');
  assert.equal(reason({ slipAngle: 11 * DEG }), 'low angle');
  assert.equal(reason({ slipAngle: 13 * DEG }), 'drifting');
  assert.equal(reason({ slipAngle: T.spinoutSlip + 0.01 }), 'over-rotated');
  assert.equal(reason({ surface: 'grass' }), 'off road');
  assert.equal(reason({ surface: 'curb' }), 'drifting');
  assert.equal(reason({ forwardSpeed: -5 }), 'reversing');
  assert.equal(reason({ progressRate: 2 }), 'no progress');
  assert.equal(classifyDrift(drifting(), false, 1), 'repeat ground');
});

test('a qualifying drift survives a dip just under the entry angle', () => {
  assert.equal(classifyDrift(drifting({ slipAngle: 10 * DEG }), false, 0), 'low angle');
  assert.equal(classifyDrift(drifting({ slipAngle: 10 * DEG }), true, 0), 'drifting');
});

test('thresholds match the design brief', () => {
  assert.equal(T.driftMinSpeedRatio, 0.25);
  assert.ok(Math.abs(T.driftMinSlip - 12 * DEG) < 1e-9);
  assert.ok(Math.abs(T.driftStrongLow - 25 * DEG) < 1e-9);
  assert.ok(Math.abs(T.driftStrongHigh - 50 * DEG) < 1e-9);
  assert.ok(Math.abs(T.spinoutSlip - 75 * DEG) < 1e-9);
});

test('angle points peak in the strong band, and extreme angle is not best', () => {
  assert.equal(angleScore(11 * DEG), 0);
  assert.ok(angleScore(15 * DEG) < angleScore(24 * DEG));
  assert.equal(angleScore(25 * DEG), 1);
  assert.equal(angleScore(50 * DEG), 1);
  assert.ok(angleScore(70 * DEG) < 0.5);
  assert.equal(angleScore(76 * DEG), 0);
});

test('faster drifts are worth more', () => {
  assert.ok(speedScore(T.topSpeed * 0.25) < speedScore(T.topSpeed * 0.5));
  assert.equal(speedScore(T.topSpeed * T.scoreFullSpeedRatio), 1);
  assert.equal(speedScore(T.topSpeed), 1);
});

test('a one-frame wiggle does not start a combo', () => {
  const s = createScoring();
  run(s, drifting(), T.driftConfirmTime * 0.5);
  run(s, straight(), 0.1);
  assert.equal(s.combo, null);
});

// --- 7. Spinout detection ---------------------------------------------------
test('passing the spinout angle at speed counts one spin and loses the combo', () => {
  const s = createScoring();
  run(s, drifting(), 1);
  const points = Math.round(s.combo.points);
  assert.ok(points > 0);
  run(s, drifting({ slipAngle: 80 * DEG }), 0.3);
  assert.equal(s.spinouts, 1);
  assert.equal(s.combo, null);
  assert.equal(s.score, 0);
  assert.equal(s.event.type, 'lost');
  assert.equal(s.event.reason, 'spun out');
  assert.equal(s.event.points, points);
});

test('one long spin counts once, and a second counts only after recovery', () => {
  const s = createScoring();
  run(s, drifting({ slipAngle: 100 * DEG }), 1);
  run(s, drifting({ slipAngle: 60 * DEG }), 0.3);
  run(s, drifting({ slipAngle: 100 * DEG }), 0.5);
  assert.equal(s.spinouts, 1);
  run(s, straight(), 0.2);
  run(s, drifting({ slipAngle: 100 * DEG }), 0.5);
  assert.equal(s.spinouts, 2);
});

test('a brief flick past the threshold, or rotating while almost stopped, is not a spin', () => {
  const brief = createScoring();
  run(brief, drifting({ slipAngle: 80 * DEG }), T.spinoutHoldTime * 0.5);
  run(brief, drifting(), 0.2);
  assert.equal(brief.spinouts, 0);

  const slow = createScoring();
  run(slow, drifting({ slipAngle: 120 * DEG, speed: T.spinoutMinSpeed - 1 }), 1);
  assert.equal(slow.spinouts, 0);
});

// --- 8. Score accumulation and combo termination ----------------------------
test('points build unbanked, then bank when the grace period runs out', () => {
  const s = createScoring();
  run(s, drifting(), 2);
  assert.ok(s.combo.points > 0);
  assert.equal(s.score, 0, 'nothing is banked yet');

  run(s, straight(), T.comboGrace * 0.5);
  assert.ok(s.combo, 'the combo survives briefly straightening up');
  run(s, straight(), T.comboGrace * 0.6);
  assert.equal(s.combo, null);
  assert.ok(s.score > 0);
  assert.equal(s.event.type, 'banked');
  assert.equal(s.bestCombo, s.score);
});

test('a better angle and speed earn points faster', () => {
  const points = (over) => {
    const s = createScoring();
    run(s, drifting(over), 1);
    return s.combo.points;
  };
  assert.ok(points({ slipAngle: 35 * DEG }) > points({ slipAngle: 15 * DEG }));
  assert.ok(points({ speed: 28 }) > points({ speed: 14 }));
});

test('the multiplier climbs through its tiers with sustained drifting', () => {
  const s = createScoring();
  const seen = new Set();
  for (let i = 0; i < 14 * 120; i += 1) {
    updateScoring(s, drifting(), dt);
    if (s.combo) seen.add(currentMultiplier(s.combo));
  }
  assert.deepEqual([...seen], [1, 1.5, 2, 3]);
  assert.equal(s.bestMultiplier, 3);
});

test('the multiplier applies to banked points', () => {
  const s = createScoring();
  run(s, drifting(), 12);
  const expected = Math.round(s.combo.points * 3);
  bankCombo(s);
  assert.equal(s.score, expected);
});

test('relinking within the grace period keeps the combo and earns a tier', () => {
  const s = createScoring();
  run(s, drifting(), 0.5);
  assert.equal(currentMultiplier(s.combo), 1);
  run(s, straight(), T.comboGrace * 0.8);
  assert.ok(s.combo);
  run(s, drifting(), 0.3);
  assert.equal(currentMultiplier(s.combo), 1.5);
});

test('flicking to the opposite side earns a tier, but only after moving on', () => {
  const s = createScoring();
  run(s, drifting({ newGround: 0.0001 }), 0.5);
  run(s, drifting({ slipAngle: 35 * DEG, newGround: 0.0001 }), 0.3);
  assert.equal(currentMultiplier(s.combo), 1, 'no ground covered yet');
  run(s, drifting({ slipAngle: 35 * DEG }), 1.2);
  run(s, drifting({ slipAngle: -35 * DEG }), 0.3);
  assert.ok(currentMultiplier(s.combo) >= 1.5);
});

test('a hard barrier hit loses the combo; a light brush does not', () => {
  const hard = createScoring();
  run(hard, drifting(), 1);
  updateScoring(hard, drifting({ impact: T.barrierSignificantImpact + 1 }), dt);
  assert.equal(hard.combo, null);
  assert.equal(hard.event.reason, 'hit the wall');
  assert.equal(hard.score, 0);

  const light = createScoring();
  run(light, drifting(), 1);
  updateScoring(light, drifting({ impact: T.barrierSignificantImpact - 2 }), dt);
  assert.ok(light.combo);
});

test('staying on the grass too long loses the combo; a short excursion does not', () => {
  const short = createScoring();
  run(short, drifting(), 1);
  run(short, straight({ surface: 'grass' }), T.comboOffTrackLimit * 0.6);
  assert.ok(short.combo);
  run(short, drifting(), 0.3);
  assert.ok(short.combo);

  const long = createScoring();
  run(long, drifting(), 1);
  run(long, straight({ surface: 'grass' }), T.comboOffTrackLimit + 0.1);
  assert.equal(long.combo, null);
  assert.equal(long.event.type, 'lost');
  assert.equal(long.event.reason, 'off the track');
});

test('no points are earned while on the grass', () => {
  const s = createScoring();
  run(s, drifting({ surface: 'grass' }), 1);
  assert.equal(s.combo, null);
  assert.equal(s.score, 0);
});

test('a combo is lost if the car stops making progress', () => {
  const s = createScoring();
  run(s, drifting(), 1);
  // Staying sideways with the qualification held open by progress that is too small.
  run(s, drifting({ newGround: 0.001 }), T.comboStallWindow + 0.05);
  assert.equal(s.score, 0);
  assert.equal(s.event.type, 'lost');
  assert.equal(s.event.reason, 'stopped making progress');
});

test('holding the handbrake through a slide scores far less than power-sliding', () => {
  const points = (handbrake) => {
    const s = createScoring();
    run(s, drifting({ handbrake }), 3);
    return s.combo.points;
  };
  assert.ok(points(true) < points(false) * 0.5);
});

test('tiny combos end quietly, with no message', () => {
  const s = createScoring();
  run(s, drifting({ slipAngle: 13 * DEG, speed: 11 }), T.driftConfirmTime + 0.01);
  run(s, straight(), T.comboGrace + 0.1);
  assert.equal(s.combo, null);
  assert.equal(s.event, null);
});

// --- 9. Suppression of stationary and donut scoring (unit level) ------------
test('standing still and spinning scores nothing', () => {
  const s = createScoring();
  run(s, { speed: 0.5, forwardSpeed: 0, slipAngle: 0, surface: 'road', progressRate: 0, newGround: 0, handbrake: true, impact: 0 }, 10);
  assert.equal(s.combo, null);
  assert.equal(s.score, 0);
});

test('reversing in circles scores nothing', () => {
  const s = createScoring();
  run(s, drifting({ speed: 8, forwardSpeed: -8, slipAngle: 150 * DEG, progressRate: 0, newGround: 0 }), 10);
  assert.equal(s.combo, null);
  assert.equal(s.score, 0);
});

test('sliding over ground already covered scores nothing', () => {
  const s = createScoring();
  run(s, drifting({ newGround: 0 }), 10);
  assert.equal(s.combo, null);
  assert.equal(s.score, 0);
});

test('holding the handbrake without a real slide scores nothing', () => {
  const s = createScoring();
  run(s, straight({ handbrake: true, slipAngle: 2 * DEG }), 5);
  assert.equal(s.combo, null);
  assert.equal(s.score, 0);
});
