// Scripted drivers used by the tests. They press the same on/off keys a person
// does, and decide only a limited number of times per second, so they cannot
// beat the handling with reflexes no player has.
import { TUNING } from '../../src/tuning.js';
import { projectOnTrack } from '../../src/track.js';

const DECISION_INTERVAL = 1 / 15;
const DEG = Math.PI / 180;

function pointAhead(track, s, distance) {
  const i = Math.round(((s + distance) % track.length) / track.step) % track.points.length;
  return track.points[i];
}

function angleTo(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

// The fastest speed from which every corner in braking range can still be made.
function safeSpeed(track, s, speed, lateral, braking) {
  let limit = TUNING.topSpeed;
  const horizon = Math.max(30, speed * speed / (2 * braking) + 25);
  for (let d = 0; d < horizon; d += 4) {
    const k = Math.abs(pointAhead(track, s, d).curvature);
    if (k < 1e-4) continue;
    const here = lateral / k;
    limit = Math.min(limit, Math.sqrt(here + 2 * braking * d));
  }
  return limit;
}

// Steers to a look-ahead point and brakes for the corners. Never uses the handbrake.
export function gripDriver() {
  let next = 0;
  let keys = { up: true, down: false, left: false, right: false, handbrake: false };
  return (game) => {
    const t = game.ticks * TUNING.simStep;
    if (t < next) return keys;
    next = t + DECISION_INTERVAL;
    const { car, track } = game;
    const at = projectOnTrack(track, car.x, car.y);
    const target = pointAhead(track, at.s, 12 + car.speed * 0.55);
    const err = angleTo(car.heading, Math.atan2(target.y - car.y, target.x - car.x));
    const limit = safeSpeed(track, at.s, car.speed, 10, 12);
    keys = {
      up: car.speed < limit,
      down: car.speed > limit + 2,
      left: err < -2.5 * DEG,
      right: err > 2.5 * DEG,
      handbrake: false,
    };
    return keys;
  };
}

// Enters corners with a handbrake tap, then balances the slide with throttle and
// countersteer. It reads only what a player can see: the car's angle and the road.
export function driftDriver({ targetSlip = 32 * DEG, catchSlip = 40 * DEG, tapTime = 0.3, lateral = 8.5, cooldown = 1.4, minCorner = 1 / 80 } = {}) {
  let next = 0;
  let tapUntil = 0;
  let cooldownUntil = 0;
  let keys = { up: true, down: false, left: false, right: false, handbrake: false };
  return (game) => {
    const t = game.ticks * TUNING.simStep;
    if (t < next) return keys;
    next = t + DECISION_INTERVAL;
    const { car, track } = game;
    const at = projectOnTrack(track, car.x, car.y);
    const target = pointAhead(track, at.s, 14 + car.speed * 0.6);
    const toTarget = Math.atan2(target.y - car.y, target.x - car.x);
    const travel = Math.atan2(car.vy, car.vx);
    const pathErr = angleTo(travel, toTarget);
    const headingErr = angleTo(car.heading, toTarget);
    const corner = pointAhead(track, at.s, car.speed * 0.7).curvature;
    const tight = Math.abs(corner) > minCorner;
    const slip = car.slipAngle;
    const sliding = Math.abs(slip) > 8 * DEG;

    keys = { up: true, down: false, left: false, right: false, handbrake: t < tapUntil };

    const limit = safeSpeed(track, at.s, car.speed, lateral, 11);
    if (car.speed > limit) {
      keys.up = false;
      keys.down = !sliding && car.speed > limit + 1.5;
    }

    // Commit: a short handbrake tap with steering into the corner.
    if (tight && !sliding && car.speed > 14 && t > cooldownUntil) {
      tapUntil = t + tapTime;
      cooldownUntil = t + cooldown;
      keys.handbrake = true;
    }

    let steer;
    if (sliding) {
      // The nose should point into the corner by the slip the path needs.
      const wanted = -Math.sign(pathErr || -slip) * Math.min(targetSlip, Math.abs(pathErr) * 2.5 + 10 * DEG);
      const slipErr = wanted - slip;
      steer = Math.abs(slipErr) < 4 * DEG ? 0 : slipErr < 0 ? 1 : -1;
      if (Math.abs(slip) > catchSlip) {
        steer = Math.sign(slip);
        keys.up = false;
      }
    } else {
      steer = headingErr > 2.5 * DEG ? 1 : headingErr < -2.5 * DEG ? -1 : 0;
      if (tight && t < tapUntil) steer = Math.sign(corner);
    }
    keys.right = steer > 0;
    keys.left = steer < 0;
    return keys;
  };
}

// The driver who hauls on the handbrake through every corner and never countersteers.
export function recklessDriver() {
  let next = 0;
  let keys = { up: true, down: false, left: false, right: false, handbrake: false };
  return (game) => {
    const t = game.ticks * TUNING.simStep;
    if (t < next) return keys;
    next = t + DECISION_INTERVAL;
    const { car, track } = game;
    const at = projectOnTrack(track, car.x, car.y);
    const target = pointAhead(track, at.s, 12 + car.speed * 0.5);
    const err = angleTo(car.heading, Math.atan2(target.y - car.y, target.x - car.x));
    const corner = pointAhead(track, at.s, car.speed * 0.5).curvature;
    keys = {
      up: true,
      down: false,
      left: err < -2.5 * DEG,
      right: err > 2.5 * DEG,
      handbrake: Math.abs(corner) > 1 / 110 && car.speed > 12,
    };
    return keys;
  };
}
