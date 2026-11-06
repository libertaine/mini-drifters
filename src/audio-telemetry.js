// Pure mapping from driving telemetry to sound parameters. No browser code, so the
// tests can run it directly. Reads copies of the car's values and never writes to
// the game. The RPM here is an audio-only approximation. The car has no gearbox, so
// the four gears below exist only in what the player hears.
const DEG = 180 / Math.PI;

// These numbers shape only what the player hears, so they live apart from
// tuning.js. Speeds are m/s, angles are degrees, times are seconds.
export const AUDIO_TUNING = Object.freeze({
  // --- RPM: the same 750-7000 range the Coyote lab uses ---------------------
  idleRpm: 750,
  maxRpm: 7000,
  // Starting estimates, not measurements. docs/GAMEPLAY-AUDIO.md compares them with the lab.
  referenceSpeed: 42,    // road speed where the speed curve tops out
  coastRpmAtReference: 5000,
  speedCurve: 0.85,      // below 1, RPM climbs quickly at first and then eases
  launchFlare: 2000,     // extra RPM under full throttle at a standstill...
  topSpeedFlare: 900,    // ...shrinking to this at the reference speed
  spinFlare: 1400,       // extra RPM from wheelspin in a power slide
  spinSlipOnset: 7,      // rear slip where wheelspin starts to show
  spinSlipFull: 28,
  spinMinSpeed: 1.5,     // below this a parked car has no slide to rev through
  spinFullSpeed: 7,
  drivingMaxRpm: 6800,   // leaves the top of the range unused while driving
  reverseSpeed: 9,
  reverseEngage: 0.8,    // rolling backward faster than this counts as reverse
  reverseSpeedRpm: 1400,
  reverseThrottleRpm: 700,
  rpmRiseTime: 0.11,
  rpmFallTime: 0.34,
  rpmRiseLimit: 5500,    // RPM per second, so nothing ever jumps
  rpmFallLimit: 3000,
  loadRiseTime: 0.06,    // smoothed throttle, which sets the engine's character
  loadFallTime: 0.22,

  // --- Virtual gearbox: changes the sound only, never the car -----------------
  gears: Object.freeze({
    topSpeeds: Object.freeze([12, 20, 29, 42]), // road speed where each gear runs out
    roadRpmAtTop: 5650,  // RPM from road speed alone at a gear's top speed
    throttleRpm: 550,    // full throttle adds this on top, in any gear
    downshiftShare: 0.68, // back down below this share of the lower gear's top speed
    minShiftInterval: 0.7, // never two shifts closer together than this
    stoppedSpeed: 1,     // a car this slow is simply in first
    shiftTime: 0.22,     // how long a change is under way
    shiftFallTime: 0.06, // RPM falling through an upshift
    shiftFallLimit: 14000, // RPM per second during an upshift
    shiftRiseTime: 0.16, // RPM recovering through a downshift
    shiftLoadDip: 0.25,  // share of engine load briefly lost in an upshift
    shiftGlide: 0.05,    // the voice follows RPM this quickly during a shift, in seconds
    // In a power slide the rear wheels are spinning, so the engine isn't tied to road
    // speed. RPM follows the slide mapping instead, and the gear holds.
    slideBlendOnset: 0.05, // wheelspin amount where the slide mapping starts to take over
    slideBlendFull: 0.4,
    slideHoldSlip: 12,   // rear slip, in degrees, that holds the gear
    slideHoldTime: 0.35, // how long the hold lasts after the slip falls away
  }),

  // --- Tires ----------------------------------------------------------------
  stillSpeed: 0.5,       // at or below this the tires are silent, whatever the slip reads
  fullSpeedGate: 8,
  loudSpeed: 30,         // the slide is at its loudest from this speed
  quietSpeedShare: 0.6,  // the share of that volume left at low speed
  scrubOnset: 3,         // slip where ordinary cornering starts to scrub
  scrubFull: 9,
  scrubLevel: 0.14,
  slideOnset: 6,         // rear slip where the tail starts to let go
  slideFull: 30,
  gripLossLevel: 0.15,   // a loosened rear adds a little, but only while it slips
  gripLossSlipOnset: 1,
  gripLossSlipFull: 8,
  grassLevel: 0.32,
  tireRiseTime: 0.07,
  tireFallTime: 0.22,

  // --- Mix: the lab's engine and tire balance -------------------------------
  engineLevel: 0.65,
  tireLevel: 0.55,
  // About 5 dB over the lab's bench level, which measured a quiet -30 dBFS RMS
  // while driving. Set this one by ear: the game has no volume control of its own.
  masterLevel: 0.4,
});

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const clamp01 = (value) => clamp(finite(value), 0, 1);

function smoothstep(lo, hi, value) {
  const x = clamp01((value - lo) / (hi - lo));
  return x * x * (3 - 2 * x);
}

// A plain copy of what the audio may read. Audio code never holds the car itself.
export function readTelemetry(car) {
  return {
    speed: car.speed,
    forwardSpeed: car.forwardSpeed,
    throttle: car.throttle,
    brake: car.brake,
    slipAngle: car.slipAngle,
    frontSlip: car.frontSlip,
    rearSlip: car.rearSlip,
    rearGrip: car.rearGrip,
    surface: car.surface,
    reversing: car.reversing,
  };
}

const isReversing = (t, A) => !!t.reversing || finite(t.forwardSpeed) < -A.reverseEngage;
const isSliding = (t, A) => Math.abs(finite(t.rearSlip)) * DEG >= A.gears.slideHoldSlip;

// The gear a car at this speed belongs in, ignoring hysteresis and timing.
export function gearForSpeed(speed, A = AUDIO_TUNING) {
  const index = A.gears.topSpeeds.findIndex((top) => Math.max(0, finite(speed)) < top);
  return index < 0 ? A.gears.topSpeeds.length : index + 1;
}

// What the engine "wants" this instant, before any smoothing. Without a gear it
// assumes the car is in the gear that suits its speed.
export function engineTarget(t, A = AUDIO_TUNING, gear = gearForSpeed(t.speed, A)) {
  const speed = Math.max(0, finite(t.speed));
  const forward = finite(t.forwardSpeed);
  const throttle = clamp01(t.throttle);

  if (isReversing(t, A)) {
    const share = clamp01(Math.abs(forward) / A.reverseSpeed);
    return A.idleRpm + share * A.reverseSpeedRpm + throttle * A.reverseThrottleRpm;
  }

  // The mapping the owner approved for drifting, with the engine free of road speed.
  const ratio = clamp01(speed / A.referenceSpeed);
  const coast = A.idleRpm + (A.coastRpmAtReference - A.idleRpm) * ratio ** A.speedCurve;
  const flare = throttle * (A.launchFlare + (A.topSpeedFlare - A.launchFlare) * ratio);
  const rearSlip = Math.abs(finite(t.rearSlip)) * DEG;
  const spin = throttle
    * smoothstep(A.spinSlipOnset, A.spinSlipFull, rearSlip)
    * smoothstep(A.spinMinSpeed, A.spinFullSpeed, speed);
  const sliding = coast + flare + spin * A.spinFlare;

  // In gear, RPM follows road speed. A launch slips the clutch up to the same RPM
  // the old mapping gave at a standstill, so the first moment still sounds immediate.
  const G = A.gears;
  const top = G.topSpeeds[clamp(gear, 1, G.topSpeeds.length) - 1];
  const inGear = Math.max(A.idleRpm + throttle * A.launchFlare, speed * G.roadRpmAtTop / top + throttle * G.throttleRpm);
  const free = smoothstep(G.slideBlendOnset, G.slideBlendFull, spin);
  return Math.min(A.drivingMaxRpm, inGear + (sliding - inGear) * free);
}

// One step of the virtual gearbox. Time-based, so it behaves the same at any frame
// rate. A held power slide freezes it, and the minimum interval and the gap between
// the up and down speeds stop it hunting around a threshold.
export function stepGears(state, t, dt, driving = true, A = AUDIO_TUNING) {
  const G = A.gears;
  state.sinceShift += dt;
  state.shiftLeft = Math.max(0, state.shiftLeft - dt);
  state.slideHold = Math.max(0, state.slideHold - dt);
  if (!driving) return state;
  if (isReversing(t, A)) {
    state.gear = 0;
    return state;
  }
  const speed = Math.max(0, finite(t.speed));
  if (isSliding(t, A)) state.slideHold = G.slideHoldTime;
  if (state.gear === 0) state.gear = 1; // out of reverse, without a shift
  if (speed < G.stoppedSpeed && state.slideHold === 0) {
    state.gear = 1; // RPM is already near idle here, so this isn't a heard shift
    return state;
  }
  if (state.slideHold > 0 || state.sinceShift < G.minShiftInterval) return state;

  let next = state.gear;
  while (next < G.topSpeeds.length && speed >= G.topSpeeds[next - 1]) next += 1;
  while (next > 1 && speed < G.topSpeeds[next - 2] * G.downshiftShare) next -= 1;
  if (next !== state.gear) {
    state.shiftDirection = next > state.gear ? 1 : -1;
    state.gear = next;
    state.sinceShift = 0;
    state.shiftLeft = G.shiftTime;
    state.shifts += 1;
  }
  return state;
}

// How hard the tires should be working. Physical slip and speed only: never the
// handbrake key or the score, so an unscored slide still sounds like a slide.
export function tireTarget(t, A = AUDIO_TUNING) {
  const speed = Math.max(0, finite(t.speed));
  if (speed <= A.stillSpeed) return 0;
  const rear = Math.abs(finite(t.rearSlip)) * DEG;
  const front = Math.abs(finite(t.frontSlip)) * DEG;
  const scrub = A.scrubLevel * smoothstep(A.scrubOnset, A.scrubFull, Math.max(rear, front));
  const slide = smoothstep(A.slideOnset, A.slideFull, rear);
  const looseness = clamp01((1 - finite(t.rearGrip, 1)) / 0.74)
    * smoothstep(A.gripLossSlipOnset, A.gripLossSlipFull, rear);
  const working = clamp01(scrub + (1 - scrub) * slide + A.gripLossLevel * looseness);
  const speedShare = A.quietSpeedShare + (1 - A.quietSpeedShare) * clamp01(speed / A.loudSpeed);
  const level = working * speedShare * smoothstep(A.stillSpeed, A.fullSpeedGate, speed);
  return t.surface === 'grass' ? level * A.grassLevel : level;
}

export function createAudioState(A = AUDIO_TUNING) {
  return {
    rpm: A.idleRpm, load: 0, tire: 0, slide: 0, grass: false, speed: 0,
    gear: 1, sinceShift: Infinity, shiftLeft: 0, shiftDirection: 0, slideHold: 0, shifts: 0,
  };
}

export function resetAudioState(state, A = AUDIO_TUNING) {
  Object.assign(state, createAudioState(A));
}

// 0 to 1 and back over an upshift, as a driver's foot would lift and return. Zero at
// any other time, including through a downshift.
function upshiftLift(state, A) {
  if (state.shiftLeft <= 0 || state.shiftDirection <= 0) return 0;
  return Math.sin(Math.PI * (1 - state.shiftLeft / A.gears.shiftTime));
}

const ease = (current, target, time, dt) => current + (target - current) * (1 - Math.exp(-dt / time));

// Advance the audio state by one rendered frame. `driving` is false once the run
// is over, so a finished car settles instead of squealing on its last reading.
export function stepAudioState(state, telemetry, dt, driving = true, A = AUDIO_TUNING) {
  const step = clamp(finite(dt), 0, 0.25);
  if (step === 0) return state;

  const throttle = driving ? clamp01(telemetry.throttle) : 0;
  const braking = driving ? clamp01(telemetry.brake) : 0;
  const loadTarget = throttle * (1 - braking);
  state.load = ease(state.load, loadTarget, loadTarget > state.load ? A.loadRiseTime : A.loadFallTime, step);

  stepGears(state, telemetry, step, driving, A);
  // The throttle's share of the RPM goes with the lift. A slide is free of the gears, so its target stays put.
  const lifted = isSliding(telemetry, A) ? 0 : upshiftLift(state, A) * A.gears.throttleRpm * clamp01(telemetry.throttle);
  const target = driving ? clamp(engineTarget(telemetry, A, state.gear) - lifted, A.idleRpm, A.maxRpm) : A.idleRpm;
  const rising = target > state.rpm;
  const shifting = driving && state.shiftLeft > 0;
  const riseTime = shifting && state.shiftDirection < 0 ? A.gears.shiftRiseTime : A.rpmRiseTime;
  const fallTime = shifting && state.shiftDirection > 0 ? A.gears.shiftFallTime : A.rpmFallTime;
  const fallLimit = shifting && state.shiftDirection > 0 ? A.gears.shiftFallLimit : A.rpmFallLimit;
  const eased = ease(state.rpm, target, rising ? riseTime : fallTime, step);
  const limit = (rising ? A.rpmRiseLimit : fallLimit) * step;
  state.rpm = clamp(clamp(eased, state.rpm - limit, state.rpm + limit), A.idleRpm, A.maxRpm);
  if (Math.abs(state.rpm - target) < 0.5) state.rpm = target; // settle, rather than approach forever

  const tire = driving ? tireTarget(telemetry, A) : 0;
  state.tire = ease(state.tire, tire, tire > state.tire ? A.tireRiseTime : A.tireFallTime, step);
  if (state.tire < 1e-4 && tire === 0) state.tire = 0;

  // The slide only colours the sound, so it follows the slip without a speed gate.
  const rear = Math.abs(finite(telemetry.rearSlip)) * DEG;
  state.slide = ease(state.slide, driving ? smoothstep(A.slideOnset, A.slideFull, rear) : 0, A.tireFallTime, step);
  state.grass = telemetry.surface === 'grass';
  state.speed = Math.max(0, finite(telemetry.speed));
  return state;
}

// What the engine voices should play. An upshift briefly eases the load, as a driver
// lifting for the change would, and lets the voice follow the RPM drop more closely.
export function engineParams(state, A = AUDIO_TUNING) {
  const G = A.gears;
  return {
    rpm: state.rpm,
    throttle: state.load * (1 - G.shiftLoadDip * upshiftLift(state, A)),
    glide: state.shiftLeft > 0 ? G.shiftGlide : undefined,
  };
}

// Parameters for the sampled tire voice, in the ranges the lab uses.
export function tireParams(state) {
  const mph = state.speed * 2.23694;
  const rate = 0.85 + 0.3 * smoothstep(0, 120, mph);
  return {
    tireIntensity: clamp01(state.tire),
    tireRate: state.grass ? rate * 0.88 : rate,
    tireCutoff: state.grass ? 950 : 1400 + 2100 * clamp01(state.slide),
  };
}
