// Pure mapping from driving telemetry to sound parameters. No browser code, so the
// tests can run it directly. Reads copies of the car's values and never writes to
// the game. The RPM here is an audio-only approximation: the car has no gearbox.
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

// What the engine "wants" this instant, before any smoothing.
export function engineTarget(t, A = AUDIO_TUNING) {
  const speed = Math.max(0, finite(t.speed));
  const forward = finite(t.forwardSpeed);
  const throttle = clamp01(t.throttle);

  if (t.reversing || forward < -A.reverseEngage) {
    const share = clamp01(Math.abs(forward) / A.reverseSpeed);
    return A.idleRpm + share * A.reverseSpeedRpm + throttle * A.reverseThrottleRpm;
  }

  const ratio = clamp01(speed / A.referenceSpeed);
  const coast = A.idleRpm + (A.coastRpmAtReference - A.idleRpm) * ratio ** A.speedCurve;
  const flare = throttle * (A.launchFlare + (A.topSpeedFlare - A.launchFlare) * ratio);
  const rearSlip = Math.abs(finite(t.rearSlip)) * DEG;
  const spin = throttle
    * smoothstep(A.spinSlipOnset, A.spinSlipFull, rearSlip)
    * smoothstep(A.spinMinSpeed, A.spinFullSpeed, speed);
  return Math.min(A.drivingMaxRpm, coast + flare + spin * A.spinFlare);
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
  return { rpm: A.idleRpm, load: 0, tire: 0, slide: 0, grass: false, speed: 0 };
}

export function resetAudioState(state, A = AUDIO_TUNING) {
  Object.assign(state, createAudioState(A));
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

  const target = driving ? clamp(engineTarget(telemetry, A), A.idleRpm, A.maxRpm) : A.idleRpm;
  const rising = target > state.rpm;
  const eased = ease(state.rpm, target, rising ? A.rpmRiseTime : A.rpmFallTime, step);
  const limit = (rising ? A.rpmRiseLimit : A.rpmFallLimit) * step;
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
