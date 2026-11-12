// The previous-lap ghost: an in-memory visual replay of the last valid lap.
//
// Nothing in the simulation reads from this module, and it only ever receives
// copies of numbers, so it cannot affect the car, the laps or the score. A pose
// replay shows where a car went. It is not an input replay and proves nothing
// about how the lap was driven.
//
// The clock is the simulation's own tick count, reset on exactly the events that
// reset the lap timer, so it stops whenever the simulation does.
import { TUNING } from './tuning.js';

export const GHOST_FORMAT = 1;

const TICK_RATE = Math.round(1 / TUNING.simStep);
export const SAMPLE_EVERY = Math.round(TICK_RATE / 30); // ticks between samples, about 30 per second
// A lap this long isn't worth racing, and the cap keeps an idle tab from growing forever.
export const MAX_RECORDED_TICKS = 15 * 60 * TICK_RATE;

const OPACITY = 0.62;
const FADE_IN_TICKS = 0.25 * TICK_RATE;
const FADE_OUT_TICKS = 0.5 * TICK_RATE; // after the recording ends, at the finish line
// The player's car always stays readable: the ghost thins out as they overlap.
const NEAR_FADE = { from: 3, to: 9, floor: 0.25 };

function fingerprint(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// Identifies the circuit by its geometry and the rules by the tuning values the lap was
// driven with: the handling mode's tuning (handling.js), which holds every rule as well as the
// car's physics. Both change on their own when those do, so a lap driven in one handling mode
// is never shown in another, and Classic's identity is v0.2.0's. Neither covers changes to the
// physics code.
const trackIds = new WeakMap();
function trackIdentity(track) {
  if (!trackIds.has(track)) {
    trackIds.set(track, fingerprint(track.points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';')));
  }
  return trackIds.get(track);
}
const rulesIds = new WeakMap();
function rulesIdentity(tuning) {
  if (!rulesIds.has(tuning)) rulesIds.set(tuning, fingerprint(JSON.stringify(tuning)));
  return rulesIds.get(tuning);
}

function newRecording(ghost, x, y, heading) {
  const recording = {
    format: GHOST_FORMAT,
    track: ghost.track,
    rules: ghost.rules,
    tickRate: TICK_RATE,
    sampleEvery: SAMPLE_EVERY,
    durationTicks: 0,
    ticks: [],
    x: [],
    y: [],
    heading: [],
  };
  addSample(recording, 0, x, y, heading);
  return recording;
}

function addSample(recording, tick, x, y, heading) {
  recording.ticks.push(tick);
  recording.x.push(x);
  recording.y.push(y);
  recording.heading.push(heading);
}

export function createGhost(track, tuning = TUNING) {
  return {
    track: trackIdentity(track),
    rules: rulesIdentity(tuning),
    recording: null,   // the lap being driven now
    replay: null,      // the last valid lap, shown as the ghost
    lapTick: 0,        // ticks since this lap's timer started
  };
}

// The run clock starts on the first pedal tick, from wherever the car is sitting.
export function beginGhostRecording(ghost, x, y, heading) {
  ghost.recording = newRecording(ghost, x, y, heading);
  ghost.lapTick = 0;
}

// Called after each racing tick with the car's new pose and what updateLaps returned.
export function recordGhostTick(ghost, x, y, heading, lapEvent) {
  const { recording } = ghost;
  if (!recording) return;
  ghost.lapTick += 1;
  const tick = ghost.lapTick;

  if (lapEvent) {
    // A line crossing ends this lap either way, but only a valid one becomes the ghost.
    if (lapEvent === 'lap' && tick <= MAX_RECORDED_TICKS) {
      addSample(recording, tick, x, y, heading);
      recording.durationTicks = tick;
      ghost.replay = recording;
    }
    beginGhostRecording(ghost, x, y, heading);
    return;
  }
  if (tick % SAMPLE_EVERY === 0 && tick <= MAX_RECORDED_TICKS) addSample(recording, tick, x, y, heading);
}

// Each recording must match the game showing it, or the ghost would drive across the grass.
export function ghostIsCompatible(ghost, recording) {
  return recording.format === GHOST_FORMAT
    && recording.track === ghost.track
    && recording.rules === ghost.rules
    && recording.tickRate === TICK_RATE;
}

// The shortest way round, so a heading crossing the +/-180 degree seam never spins backward.
function shortestTurn(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

// The recorded pose at a fractional tick, held at both ends of the recording.
export function ghostPoseAt(recording, tick) {
  const { ticks, x, y, heading, sampleEvery } = recording;
  const last = ticks.length - 1;
  if (last === 0 || tick <= 0) return { x: x[0], y: y[0], heading: heading[0] };
  if (tick >= ticks[last]) return { x: x[last], y: y[last], heading: heading[last] };
  // Samples sit on a regular grid, apart from a final one placed on the line crossing.
  const i = Math.min(Math.floor(tick / sampleEvery), last - 1);
  const u = (tick - ticks[i]) / (ticks[i + 1] - ticks[i]);
  return {
    x: x[i] + (x[i + 1] - x[i]) * u,
    y: y[i] + (y[i + 1] - y[i]) * u,
    heading: heading[i] + shortestTurn(heading[i], heading[i + 1]) * u,
  };
}

// What to draw at a fractional playback tick, or null when there is nothing to show.
export function ghostDisplay(ghost, tick, playerX, playerY) {
  const { replay } = ghost;
  if (!replay || !ghostIsCompatible(ghost, replay)) return null;
  const past = tick - replay.durationTicks;
  if (past >= FADE_OUT_TICKS) return null;
  const pose = ghostPoseAt(replay, tick);
  const fadeIn = Math.min(1, Math.max(0, tick) / FADE_IN_TICKS);
  const fadeOut = past > 0 ? 1 - past / FADE_OUT_TICKS : 1;
  const distance = Math.hypot(pose.x - playerX, pose.y - playerY);
  const near = Math.min(1, Math.max(0, (distance - NEAR_FADE.from) / (NEAR_FADE.to - NEAR_FADE.from)));
  const nearFade = NEAR_FADE.floor + (1 - NEAR_FADE.floor) * near;
  return { ...pose, opacity: OPACITY * fadeIn * fadeOut * nearFade };
}
