// v0.5.0 R2: Power's wheelspin seen and heard. Smoke, rubber and dust (src/tyre-effects.js, drawn by
// render.js) and the engine note (src/audio-telemetry.js) read the physics' own `car.wheelspin`.
// Nothing here simulates the tyres a second time, and Classic, which has no wheelspin, must see
// and hear exactly what it did before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TYRE_FX as F, createTyreEffectState, resetTyreEffectState, tyreEmission } from '../src/tyre-effects.js';
import * as audio from '../src/audio-telemetry.js';
import * as before from './support/audio-telemetry-bf7a1b7.mjs';
import { createGame, startRun, tick } from '../src/game.js';
import { trackById } from '../src/track.js';
import { handlingById } from '../src/handling.js';
import { padTrack } from '../src/practice-pad.js';
import { driftDriver, gripDriver, recklessDriver } from './support/drivers.mjs';

const DEG = Math.PI / 180;
const FRAME = 1 / 60;
const A = audio.AUDIO_TUNING;
const CLASSIC = handlingById('classic');
const POWER = handlingById('revised');

// What v0.4.0's render.js updateEffects decided, written out: the reference for Classic.
function legacyEmission(car) {
  const slipAbs = Math.abs(car.slipAngle);
  const onGrass = car.surface === 'grass';
  const rearSliding = Math.abs(car.rearSlip) > 11 * DEG || slipAbs > 11 * DEG;
  const skidding = !onGrass && car.speed > 6 && rearSliding;
  const mark = skidding ? Math.min(1, slipAbs / (35 * DEG) + 0.35) : 0;
  let rate = 0;
  let kind = 'smoke';
  if (!onGrass && car.speed > 8 && slipAbs > 16 * DEG) rate = 34 * Math.min(1, slipAbs / (45 * DEG));
  else if (onGrass && car.speed > 8) { rate = 18 * Math.min(1, car.speed / 25); kind = 'dust'; }
  return { mark, rate, kind };
}

// Every car state a scripted run passes through, sampled once per rendered frame.
function* run(handling, makeDriver, { track = trackById('original'), seconds = 120, mode } = {}) {
  const game = createGame(track, { handling });
  startRun(game, { track, handling, ...(mode ? { mode, ghost: false } : {}) });
  const driver = makeDriver();
  for (let i = 0; i < seconds * 120 && game.state !== 'finished'; i += 1) {
    tick(game, driver(game));
    if (i % 2) yield game;
  }
}

const car = (values) => ({
  speed: 0, forwardSpeed: 0, slipAngle: 0, rearSlip: 0, frontSlip: 0, surface: 'road', vx: 0, vy: 0, throttle: 0, ...values,
});

// --- Pictures ---------------------------------------------------------------------------------

test('Classic gets exactly the slide effects it had, frame for frame, on every circuit', () => {
  let frames = 0;
  for (const id of ['original', 'switchback', 'dockyard']) {
    for (const make of [gripDriver, driftDriver, recklessDriver]) {
      const state = createTyreEffectState();
      for (const game of run(CLASSIC, make, { track: trackById(id), seconds: 60 })) {
        assert.equal('wheelspin' in game.car, false, 'a Classic car has no wheelspin state');
        const now = tyreEmission(game.car, state);
        const old = legacyEmission(game.car);
        assert.equal(now.mark, old.mark);
        assert.equal(now.spinMark, false);
        assert.equal(now.smokeRate, old.rate);
        if (old.rate > 0) assert.equal(now.smokeKind, old.kind);
        assert.equal(now.smokeStrength, 1);
        assert.equal(now.wheelspinSmoke, false);
        frames += 1;
      }
    }
  }
  assert.ok(frames > 15000, `${frames} frames compared`);
});

test('a car whose wheels are not spinning gets the slide effects only, in any mode', () => {
  for (let i = 0; i < 4000; i += 1) {
    const c = car({
      speed: (i % 50), slipAngle: ((i * 7919) % 180 - 90) * DEG, rearSlip: ((i * 104729) % 120 - 60) * DEG,
      surface: ['road', 'curb', 'grass'][i % 3], wheelspin: i % 2 ? 0 : (i % 4 ? 0.29 : undefined),
    });
    const now = tyreEmission(c, createTyreEffectState());
    const old = legacyEmission(c);
    assert.equal(now.mark, old.mark);
    assert.equal(now.smokeRate, old.rate);
    assert.equal(now.smokeStrength, 1);
  }
});

test('wheelspin smoke starts at the onset and grows with wheelspin, never past the cap', () => {
  const at = (wheelspin, speed = 15) => tyreEmission(car({ speed, wheelspin }), createTyreEffectState());
  assert.equal(at(0).smokeRate, 0);
  assert.equal(at(F.spinSmokeOnset).smokeRate, 0, 'nothing at the onset itself');
  let last = 0;
  for (let w = 0.3; w <= 1.0001; w += 0.02) {
    const e = at(w);
    assert.ok(e.smokeRate >= last, `rate rises at ${w.toFixed(2)}`);
    assert.ok(e.smokeRate <= F.spinSmokeRate);
    assert.ok(e.smokeStrength >= F.spinSmokeStrengthFloor && e.smokeStrength <= 1);
    last = e.smokeRate;
  }
  assert.equal(at(1).smokeRate, F.spinSmokeRate);
  assert.ok(at(0.4).smokeRate < 0.15 * F.spinSmokeRate, 'light spin is only a wisp');
  assert.equal(at(1).smokeKind, 'smoke');
  assert.equal(at(1).wheelspinSmoke, true);
});

test('a slide and wheelspin together take the larger effect, never the sum', () => {
  for (const slip of [0, 10, 20, 30, 45, 60]) {
    for (const wheelspin of [0, 0.5, 0.8, 1]) {
      const c = car({ speed: 18, slipAngle: slip * DEG, rearSlip: slip * DEG, wheelspin });
      const both = tyreEmission(c, createTyreEffectState());
      const slide = legacyEmission(c);
      const spin = tyreEmission(car({ speed: 18, wheelspin }), createTyreEffectState());
      assert.equal(both.smokeRate, Math.max(slide.rate, spin.smokeRate));
      assert.ok(both.mark >= slide.mark, 'a slide mark is never lighter for spinning');
      assert.ok(both.mark <= 1);
    }
  }
});

test('a stopped car lays no rubber however hard its wheels spin, and its burnout smoke is modest', () => {
  const state = createTyreEffectState();
  const still = tyreEmission(car({ speed: 0, wheelspin: 1 }), state);
  assert.equal(still.mark, 0);
  assert.equal(still.smokeRate, F.spinSmokeRate * F.spinSmokeStillShare, 'a burnout on the spot smokes, at a reduced rate');
  assert.equal(tyreEmission(car({ speed: 0, wheelspin: 0 }), state).smokeRate, 0, 'a parked car with no spin makes nothing');
  for (const speed of [0, 0.3, 1, 2, 2.49]) {
    assert.equal(tyreEmission(car({ speed, wheelspin: 1 }), state).mark, 0, `no mark starts at ${speed} m/s`);
  }
  const donut = tyreEmission(car({ speed: 4.5, wheelspin: 0.9 }), state);
  assert.ok(donut.mark > 0 && donut.mark < tyreEmission(car({ speed: 15, wheelspin: 0.9 }), createTyreEffectState()).mark, 'a donut marks, more lightly than a fast spin');
  let last = 0;
  for (let speed = 0; speed <= 12; speed += 0.5) {
    const rate = tyreEmission(car({ speed, wheelspin: 1 }), createTyreEffectState()).smokeRate;
    assert.ok(rate >= last, `smoke grows with speed (${speed})`);
    last = rate;
  }
});

test('a donut hovering around the mark speed lays one ring, not dashes', () => {
  const state = createTyreEffectState();
  tyreEmission(car({ speed: 5, wheelspin: 0.9 }), state);
  for (let i = 0; i < 200; i += 1) {
    const speed = 2.1 + 3 * Math.abs(Math.sin(i * 0.7)); // 2.1 to 5.1 m/s
    assert.ok(tyreEmission(car({ speed, wheelspin: 0.5 + 0.4 * Math.abs(Math.cos(i * 1.3)) }), state).mark > 0, `frame ${i} at ${speed.toFixed(2)} m/s`);
  }
});

test('on grass wheelspin throws dust, never smoke or rubber', () => {
  const state = createTyreEffectState();
  for (const speed of [3, 6, 10, 20]) {
    const e = tyreEmission(car({ speed, wheelspin: 1, surface: 'grass' }), state);
    assert.equal(e.mark, 0);
    assert.equal(e.smokeKind, 'dust');
    assert.ok(e.smokeRate >= legacyEmission(car({ speed, surface: 'grass' })).rate);
    assert.ok(e.smokeRate <= Math.max(F.spinDustRate, F.dustRate));
  }
  assert.equal(state.spinMarking, false);
});

test('the wheelspin mark has hysteresis, so a flickering spin lays one mark rather than dashes', () => {
  const state = createTyreEffectState();
  const at = (wheelspin, speed = 15) => tyreEmission(car({ speed, wheelspin }), state).mark > 0;
  assert.equal(at(0.39), false, 'not yet');
  assert.equal(at(0.4), true, 'on');
  for (const w of [0.3, 0.26, 0.38, 0.25]) assert.equal(at(w), true, `still on at ${w}`);
  assert.equal(at(0.24), false, 'off');
  assert.equal(at(0.3), false, 'and stays off until the on level');
  at(0.9);
  assert.equal(state.spinMarking, true);
  resetTyreEffectState(state);
  assert.equal(state.spinMarking, false, 'a reset forgets the mark');
  at(0.9);
  assert.equal(at(0.9, 2.2), true, 'slowing a little does not end it');
  assert.equal(at(0.9, 1.9), false, 'all but stopping does');
  assert.equal(at(0.9, 2.2), false, 'and it starts again only above the start speed');
});

test('every decision is finite and bounded for any input', () => {
  const values = [NaN, Infinity, -Infinity, -1, 0, 0.5, 1, 2, 1e9];
  const state = createTyreEffectState();
  for (const speed of values) for (const wheelspin of values) for (const slip of values) {
    const e = tyreEmission(car({ speed, wheelspin, slipAngle: slip, rearSlip: slip }), state);
    for (const key of ['mark', 'smokeRate', 'smokeStrength']) assert.ok(Number.isFinite(e[key]) && e[key] >= 0, `${key} ${e[key]}`);
    assert.ok(e.mark <= 1 && e.smokeStrength <= 1);
    assert.ok(e.smokeRate <= Math.max(F.smokeRate, F.spinSmokeRate, F.dustRate, F.spinDustRate));
  }
});

test('Power driving: wheelspin on the road is now nearly always seen, and ordinary grip driving stays clean', () => {
  const tally = (make, id) => {
    const state = createTyreEffectState();
    let spin = 0; let seen = 0; let smoke = 0; let frames = 0;
    for (const game of run(POWER, make, { track: trackById(id), seconds: 120 })) {
      if (game.state !== 'racing') continue;
      frames += 1;
      const e = tyreEmission(game.car, state);
      if (e.smokeKind === 'smoke' && e.smokeRate >= 3) smoke += 1;
      if (game.car.surface === 'grass' || (game.car.wheelspin ?? 0) < 0.5) continue;
      spin += 1;
      if (e.mark > 0 || (e.smokeKind === 'smoke' && e.smokeRate >= 3)) seen += 1;
    }
    return { spin, seen: seen / Math.max(1, spin), smoke: smoke / frames };
  };
  const drift = tally(driftDriver, 'original');
  assert.ok(drift.spin > 300 && drift.seen > 0.95, `drift: ${JSON.stringify(drift)}`);
  // R1's picture showed only 60 to 74% of these moments (review harness, results/baseline-r1.txt).
  const grip = tally(gripDriver, 'dockyard');
  assert.ok(grip.smoke < 0.02, `tidy driving on Dockyard smokes ${(grip.smoke * 100).toFixed(1)}% of the time`);
});

// --- render.js ---------------------------------------------------------------------------------

test('render.js decides nothing itself, caps what it keeps, and clears every mark and puff together', () => {
  const src = readFileSync(new URL('../src/render.js', import.meta.url), 'utf8');
  assert.match(src, /tyreEmission\(car, r\.tyreState\)/);
  assert.doesNotMatch(src, /smokeMinSlip|skidMinSlip|wheelspin \?\?|car\.wheelspin/, 'thresholds live in tyre-effects.js');
  assert.match(src, /skidCapacity: 1800/);
  assert.match(src, /smokeCapacity: 110/);
  assert.match(src, /if \(r\.smoke\.length >= FX\.smokeCapacity\) r\.smoke\.shift\(\)/);
  const clear = src.match(/function clearTyreMarks\(r\) \{([\s\S]*?)\n\}/)[1];
  for (const part of ['r.skids.length = 0', 'r.skidHead = 0', 'r.lastWheels = null', 'r.markAnchor = null', 'resetTyreEffectState(r.tyreState)', 'r.smoke.length = 0', 'r.smokeCarry = 0']) {
    assert.ok(clear.includes(part), part);
  }
  assert.match(src, /export function resetEffects\(r, car\) \{\s+clearTyreMarks\(r\);/);
  assert.match(src, /r\.track = track;\s+clearTyreMarks\(r\);/, 'changing circuit clears too');
  // Paused, finished and title frames lay nothing: the decision is made only in a live frame.
  assert.match(src, /if \(!game\.paused && game\.state !== 'finished' && game\.state !== 'menu'\) updateEffects\(/);
});

test('the effects never reach the simulation: tyre-effects.js only reads the car', () => {
  const src = readFileSync(new URL('../src/tyre-effects.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import/m, 'no imports at all');
  assert.doesNotMatch(src, /car\.\w+\s*=[^=]/, 'never writes to the car');
  const c = car({ speed: 15, wheelspin: 0.9, slipAngle: 0.3 });
  const copy = structuredClone(c);
  tyreEmission(c, createTyreEffectState());
  assert.deepEqual(c, copy);
});

// --- Sound -------------------------------------------------------------------------------------

function listen(module, handling, makeDriver, { track = trackById('original'), seconds = 120, strip = false } = {}) {
  const state = module.createAudioState();
  const out = [];
  for (const game of run(handling, makeDriver, { track, seconds })) {
    const t = module.readTelemetry(game.car);
    if (strip) delete t.wheelspin;
    module.stepAudioState(state, t, FRAME, game.state === 'racing' || game.state === 'ready');
    out.push({ rpm: state.rpm, load: state.load, tire: state.tire, slide: state.slide, gear: state.gear, shifts: state.shifts,
      engine: module.engineParams(state), tires: module.tireParams(state) });
  }
  return out;
}

test('Classic sounds exactly as it did in R1, every frame, on every circuit', () => {
  for (const id of ['original', 'switchback', 'dockyard']) {
    for (const make of [gripDriver, driftDriver, recklessDriver]) {
      const now = listen(audio, CLASSIC, make, { track: trackById(id), seconds: 60 });
      const then = listen(before, CLASSIC, make, { track: trackById(id), seconds: 60 });
      assert.deepEqual(now, then, `${id}`);
    }
  }
});

test('the R1 mapping is unchanged wherever there is no wheelspin, Power included', () => {
  // Power's telemetry without its wheelspin value is exactly what R1 heard from it.
  const now = listen(audio, POWER, driftDriver, { seconds: 60, strip: true });
  const then = listen(before, POWER, driftDriver, { seconds: 60 });
  assert.deepEqual(now, then);
  for (let i = 0; i < 3000; i += 1) {
    const t = {
      speed: i % 45, forwardSpeed: (i % 45) * (i % 7 ? 1 : -0.2), throttle: (i % 11) / 10, brake: (i % 13) > 10 ? 1 : 0,
      slipAngle: 0, frontSlip: 0, rearSlip: ((i * 37) % 60) * DEG, rearGrip: 1, surface: 'road', reversing: false, wheelspin: 0,
    };
    for (const gear of [1, 2, 3, 4]) assert.equal(audio.engineTarget(t, A, gear), before.engineTarget(t, before.AUDIO_TUNING, gear));
    assert.equal(audio.tireTarget(t), before.tireTarget(t));
  }
});

test('wheelspin revs the engine above its in-gear note, more for more spin', () => {
  const t = (wheelspin, throttle = 1) => ({ speed: 16, forwardSpeed: 16, throttle, brake: 0, slipAngle: 0, frontSlip: 0, rearSlip: 2 * DEG, rearGrip: 1, surface: 'road', reversing: false, wheelspin });
  for (const gear of [1, 2, 3]) {
    const calm = audio.engineTarget(t(0), A, gear);
    let last = calm;
    for (const w of [0.3, 0.5, 0.7, 1]) {
      const rpm = audio.engineTarget(t(w), A, gear);
      assert.ok(rpm >= last, `gear ${gear}, wheelspin ${w}`);
      last = rpm;
    }
    assert.ok(Math.min(A.drivingMaxRpm, calm + A.wheelspinFlare) - last < 1e-9, `full spin adds the flare in gear ${gear}`);
  }
  assert.equal(audio.engineTarget(t(1, 0), A, 2), audio.engineTarget(t(0, 0), A, 2), 'no throttle, no flare');
  assert.ok(audio.engineTarget(t(1), A, 2) - audio.engineTarget(t(0), A, 2) >= 900, 'a clear change, not a hint');
});

test('a held power slide keeps the approved slide mapping', () => {
  const t = (wheelspin) => ({ speed: 20, forwardSpeed: 15, throttle: 1, brake: 0, slipAngle: 35 * DEG, frontSlip: 5 * DEG, rearSlip: 34 * DEG, rearGrip: 1, surface: 'road', reversing: false, wheelspin });
  for (const gear of [2, 3]) {
    for (const w of [0, 0.4, 0.8, 1]) assert.equal(audio.engineTarget(t(w), A, gear), before.engineTarget(t(0), before.AUDIO_TUNING, gear), `gear ${gear}, wheelspin ${w}`);
  }
});

test('a flickering wheelspin holds the note instead of wobbling it', () => {
  // Square-wave wheelspin at 5 Hz, at steady speed and full throttle: the worst case the physics
  // produces in scripted driving (5 to 6 reversals a second).
  const state = audio.createAudioState();
  const rpms = [];
  for (let i = 0; i < 60 * 6; i += 1) {
    const wheelspin = Math.floor(i / 6) % 2 ? 0.8 : 0;
    audio.stepAudioState(state, { speed: 16, forwardSpeed: 16, throttle: 1, brake: 0, slipAngle: 0, frontSlip: 0, rearSlip: 3 * DEG, rearGrip: 1, surface: 'road', reversing: false, wheelspin }, FRAME);
    if (i >= 120) rpms.push(state.rpm);
  }
  const ripple = Math.max(...rpms) - Math.min(...rpms);
  assert.ok(ripple < 0.3 * A.wheelspinFlare, `ripple ${ripple.toFixed(0)} RPM`);
  assert.ok(Math.min(...rpms) > audio.engineTarget({ speed: 16, forwardSpeed: 16, throttle: 1, rearSlip: 3 * DEG, wheelspin: 0 }, A, state.gear) + 300, 'and the flare is heard');
  assert.equal(state.shifts, 1, 'only the shift out of first that speed asks for');
});

test('Power driving: no RPM jump, no extra shifts, no gear hunting, and every value finite', () => {
  for (const id of ['original', 'switchback', 'dockyard']) {
    for (const make of [gripDriver, driftDriver, recklessDriver]) {
      const now = listen(audio, POWER, make, { track: trackById(id), seconds: 100 });
      const then = listen(before, POWER, make, { track: trackById(id), seconds: 100 });
      assert.equal(now.at(-1).shifts, then.at(-1).shifts, `${id}: wheelspin changes no shift`);
      let previous = A.idleRpm;
      for (const f of now) {
        for (const v of [f.rpm, f.load, f.tire, f.engine.rpm, f.engine.throttle, f.tires.tireIntensity, f.tires.tireCutoff, f.tires.tireRate]) assert.ok(Number.isFinite(v));
        assert.ok(f.rpm >= A.idleRpm && f.rpm <= A.maxRpm);
        assert.ok(f.rpm - previous <= A.rpmRiseLimit * FRAME + 1e-9, `${previous} up to ${f.rpm}`);
        assert.ok(previous - f.rpm <= A.gears.shiftFallLimit * FRAME + 1e-9, `${previous} down to ${f.rpm}`);
        previous = f.rpm;
      }
      // Tires and load are untouched: wheelspin reaches only the engine's pitch.
      assert.deepEqual(now.map((f) => [f.tire, f.load, f.slide, f.tires]), then.map((f) => [f.tire, f.load, f.slide, f.tires]));
    }
  }
});

test('the heard wheelspin starts at zero, resets with the run, and falls to zero when a run stops', () => {
  const state = audio.createAudioState();
  assert.equal(state.spin, 0);
  const spinning = { speed: 16, forwardSpeed: 16, throttle: 1, rearSlip: 3 * DEG, wheelspin: 1, surface: 'road' };
  for (let i = 0; i < 60; i += 1) audio.stepAudioState(state, spinning, FRAME);
  assert.ok(state.spin > 0.95);
  for (let i = 0; i < 30; i += 1) audio.stepAudioState(state, spinning, FRAME, false);
  assert.ok(state.spin < A.wheelspinOnset, 'within half a second a finished car is below the flare onset');
  for (let i = 0; i < 210; i += 1) audio.stepAudioState(state, spinning, FRAME, false);
  assert.equal(state.spin, 0, 'and then settles to exactly zero');
  assert.equal(state.rpm, A.idleRpm);
  for (let i = 0; i < 60; i += 1) audio.stepAudioState(state, spinning, FRAME);
  audio.resetAudioState(state);
  assert.equal(state.spin, 0, 'a new run starts quiet');
  const frozen = structuredClone(state);
  audio.stepAudioState(state, spinning, 0);
  assert.deepEqual(state, frozen, 'no time passing (a paused game) changes nothing');
  for (const bad of [NaN, Infinity, -1, 7]) {
    audio.stepAudioState(state, { ...spinning, wheelspin: bad }, FRAME);
    assert.ok(Number.isFinite(state.spin) && state.spin >= 0 && state.spin <= 1);
    assert.ok(Number.isFinite(audio.engineTarget({ ...spinning, wheelspin: bad })));
  }
  assert.equal(audio.readTelemetry({}).wheelspin, 0, 'a car without wheelspin reads 0');
});

test('a throttle circle on the practice pad spins the wheels and smokes, through the same paths', () => {
  const pad = padTrack();
  const state = createTyreEffectState();
  const game = createGame(pad, { handling: POWER });
  startRun(game, { track: pad, mode: 'practice', handling: POWER, ghost: false });
  let peak = 0; let smoked = 0;
  // A tight throttle circle: the textbook power-oversteer exercise on the pad.
  for (let i = 0; i < 120 * 8; i += 1) {
    tick(game, { up: true, down: false, left: true, right: false, handbrake: false });
    peak = Math.max(peak, game.car.wheelspin ?? 0);
    if (i % 2 && tyreEmission(game.car, state).smokeRate > 0) smoked += 1;
  }
  assert.ok(peak > 0.5, `peak wheelspin ${peak}`);
  assert.ok(smoked > 0);
});
