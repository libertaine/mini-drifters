import { mapCoyote } from './coyote-model.js';
// Lab units only: RPM, mph, degrees, and fractions. No simulation imports.
// Static RMS reference matching, not automatic loudness processing.
export const ENGINE_TRIMS = Object.freeze({ procedural: 1, samples: 1.15, coyote: 1 });
export const DEFAULTS = Object.freeze({
  rpm: 750, throttle: 0, speed: 0, slip: 0, grip: 1, surface: 'road',
  engineVolume: 0.65, tireVolume: 0.55, masterVolume: 0.35, mode: 'procedural', tireMode: 'follow',
});

export const PRESETS = Object.freeze([
  ['Idle', 750, 0, 0, 0, 1],
  ['Gentle acceleration', 2200, 0.3, 25, 1, 1],
  ['Hard acceleration', 5200, 1, 48, 5, 0.85],
  ['High-speed cruising', 3800, 0.25, 100, 1, 1],
  ['Drift initiation', 4300, 0.6, 50, 22, 0.5],
  ['Sustained power drift', 5600, 0.9, 65, 40, 0.4],
  ['Drift recovery', 2800, 0.15, 42, 6, 0.92],
  ['Spinout', 6200, 0.8, 35, 85, 0.2],
].map(([name, rpm, throttle, speed, slip, grip]) => Object.freeze({
  name, values: Object.freeze({ rpm, throttle, speed, slip, grip, surface: 'road' }),
})));

const bounded = (value, lo, hi, fallback) =>
  Number.isFinite(value) ? Math.max(lo, Math.min(hi, value)) : fallback;
export const clamp01 = (value) => bounded(value, 0, 1, 0);
export function smoothstep(lo, hi, value) {
  const x = clamp01((value - lo) / (hi - lo));
  return x * x * (3 - 2 * x);
}

export function normalize(values = {}) {
  const v = { ...DEFAULTS, ...values };
  return {
    rpm: bounded(v.rpm, 750, 7000, DEFAULTS.rpm),
    throttle: clamp01(v.throttle), speed: bounded(v.speed, 0, 120, 0),
    slip: bounded(v.slip, 0, 90, 0), grip: bounded(v.grip, 0.15, 1, 1),
    surface: v.surface === 'grass' ? 'grass' : 'road',
    engineVolume: clamp01(v.engineVolume), tireVolume: clamp01(v.tireVolume),
    masterVolume: clamp01(v.masterVolume),
    mode: ['samples', 'coyote'].includes(v.mode) ? v.mode : 'procedural',
    tireMode: ['procedural', 'samples'].includes(v.tireMode) ? v.tireMode : 'follow',
  };
}

export function mapAudio(values) {
  const v = normalize(values);
  const rpm = (v.rpm - 750) / 6250;
  const angle = smoothstep(2, 48, v.slip);
  const loss = (1 - v.grip) / 0.85;
  // No handbrake/scoring input. Grip loss adds scrub independently of angle.
  const friction = clamp01(0.8 * angle + 0.18 * loss + 0.25 * angle * loss);
  const grass = v.surface === 'grass';
  const tire = smoothstep(0, 14, v.speed) * friction;
  const highBlend = smoothstep(0.12, 0.85, rpm);
  return {
    ...v, ...mapCoyote(v), rpmFraction: rpm,
    firingHz: v.rpm / 60 * 4,
    engineGain: 0.23 + 0.12 * rpm + 0.15 * v.throttle,
    engineCutoff: 420 + 2600 * rpm + 2300 * v.throttle,
    roughness: 0.015 + 0.035 * v.throttle,
    tireIntensity: tire * (grass ? 0.32 : 1),
    tireCutoff: grass ? 950 : 1400 + 2100 * angle,
    squealHz: 700 + 850 * angle + 2 * v.speed,
    squealMix: grass ? 0.035 : 0.38 * angle,
    sampleLowGain: 1 - highBlend, sampleHighGain: highBlend,
    sampleLowRate: 0.72 + 1.15 * rpm,
    sampleHighRate: 0.65 + 0.8 * rpm,
    tireRate: 0.85 + 0.3 * smoothstep(0, 120, v.speed),
  };
}
