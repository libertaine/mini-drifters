// Scripted drivers for the gymkhana challenges. Like test/support/drivers.mjs they press the
// same on/off keys a person does and decide 15 times a second; they never move the car
// directly. The course drivers are ports of gripDriver, driftDriver and recklessDriver from
// that file, reading the Linked Drift course in place of a circuit. The browser check imports
// this file into the page, so it depends on nothing outside src/.
import { TUNING } from '../../src/tuning.js';
import { createGame, startRun, tick } from '../../src/game.js';
import { PRECISION_180, LINKED_DRIFT, SLALOM_SPRINT, projectOnCourse } from '../../src/gymkhana.js';

const DECISION_INTERVAL = 1 / 15;
export const DEG = Math.PI / 180;
const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const KEYS = () => ({ up: false, down: false, left: false, right: false, handbrake: false });

// Wraps a decision function so that it is asked only DECISION_INTERVAL apart.
function paced(decide) {
  let next = 0;
  let keys = KEYS();
  return (game) => {
    const t = game.ticks * TUNING.simStep;
    if (t < next) return keys;
    next = t + DECISION_INTERVAL;
    keys = decide(game, t) ?? keys;
    return keys;
  };
}

function steerAt(keys, car, x, y, deadband = 3 * DEG) {
  const err = angleTo(car.heading, Math.atan2(y - car.y, x - car.x));
  keys.right = err > deadband;
  keys.left = err < -deadband;
  return err;
}

// --- Precision 180 -----------------------------------------------------------------------------
const { gate, box, zoneFrom } = PRECISION_180.geometry;
const zoneX = box.minX + zoneFrom;
const exitTarget = (car) => ({ x: Math.min(car.x - 8, gate.cx - 3), y: gate.cy });

// Builds speed up to `vCap`, and at `triggerX` (plus `delay` seconds) turns to `side` on the
// handbrake until the nose has come round by `release`; then drives for the gate.
export function handbrake180({ vCap = Infinity, triggerX = 0, release = 110 * DEG, side = 1, throttleInTurn = false, delay = 0, lane = 0 } = {}) {
  let phase = 'approach';
  let triggerAt = null;
  return paced((game, t) => {
    const { car } = game;
    const k = KEYS();
    if (phase === 'approach') {
      k.up = car.speed < vCap;
      steerAt(k, car, car.x + 14, lane);
      if (car.x >= triggerX && triggerAt === null) triggerAt = t + delay;
      if (triggerAt === null || t < triggerAt) return k;
      phase = 'turn';
    }
    if (phase === 'turn') {
      if (Math.abs(angleTo(0, car.heading)) < release) {
        k.handbrake = true; k.up = throttleInTurn;
        k.right = side > 0; k.left = side < 0;
        return k;
      }
      phase = 'exit';
    }
    k.up = true;
    const target = exitTarget(car);
    steerAt(k, car, target.x, target.y, 4 * DEG);
    return k;
  });
}

// No handbrake: brakes to `vTurn` by the turn zone, moves to the far side of the box and drives
// round on full lock.
export function gripUturn({ vTurn = 5, side = 1, vCap = Infinity } = {}) {
  let phase = 'approach';
  const lane = -side * (box.maxY - 2.4);
  return paced((game) => {
    const { car } = game;
    const k = KEYS();
    if (phase === 'approach') {
      const toZone = Math.max(0, zoneX - 2 - car.x);
      const limit = Math.sqrt(vTurn * vTurn + 2 * 18 * toZone);
      k.up = car.speed < Math.min(limit, vCap) - 0.5;
      k.down = car.speed > limit + 0.5;
      steerAt(k, car, car.x + 9, car.x < gate.cx ? 0 : lane);
      if (car.x < zoneX + 0.5) return k;
      phase = 'turn';
    }
    if (phase === 'turn') {
      const err = angleTo(car.heading, Math.PI);
      if (Math.abs(err) > 30 * DEG) {
        k.right = side > 0; k.left = side < 0;
        k.up = car.speed < vTurn;
        return k;
      }
      phase = 'exit';
    }
    k.up = true;
    const target = exitTarget(car);
    steerAt(k, car, target.x, target.y, 4 * DEG);
    return k;
  });
}

// Stops in the turn zone, backs round on the other lock, and drives out.
export function threePoint({ vCap = 18, side = 1 } = {}) {
  let phase = 'approach';
  return paced((game) => {
    const { car } = game;
    const k = KEYS();
    const err = angleTo(car.heading, Math.PI);
    if (phase === 'approach') {
      const toStop = Math.max(0, zoneX + 8 - car.x);
      const limit = Math.sqrt(2 * 18 * toStop);
      k.up = car.speed < Math.min(limit, vCap) - 0.5;
      k.down = car.speed > limit + 0.5;
      if (car.x > zoneX) { k.right = side > 0; k.left = side < 0; }
      if (car.x < zoneX + 1 || car.speed > 1) return k;
      phase = 'reverse';
    }
    if (phase === 'reverse') {
      if (Math.abs(err) > 70 * DEG && car.x > zoneX - 6) {
        k.down = true; k.left = side > 0; k.right = side < 0;
        return k;
      }
      phase = 'exit';
    }
    k.up = true;
    const target = exitTarget(car);
    steerAt(k, car, target.x, target.y, 4 * DEG);
    return k;
  });
}

// --- Linked Drift ------------------------------------------------------------------------------
const { course } = LINKED_DRIFT.geometry;
const last = course.points.length - 1;
const ahead = (s, d) => course.points[Math.max(0, Math.min(last, Math.round(s + d)))];
const place = (game) => projectOnCourse(course, game.car.x, game.car.y, game.challenge.index);

function safeSpeed(s, speed, lateral, braking) {
  let limit = TUNING.topSpeed;
  const horizon = Math.max(30, speed * speed / (2 * braking) + 25);
  for (let d = 0; d < horizon; d += 4) {
    const k = Math.abs(ahead(s, d).bend);
    if (k < 1e-4) continue;
    limit = Math.min(limit, Math.sqrt(lateral / k + 2 * braking * d));
  }
  return limit;
}

// Follows the course on grip. Never uses the handbrake. `lateral` sets how hard it corners.
export function courseGrip({ lateral = 10, cap = Infinity } = {}) {
  return paced((game) => {
    const { car } = game;
    const at = place(game);
    const target = ahead(at.s, 12 + car.speed * 0.55);
    const err = angleTo(car.heading, Math.atan2(target.y - car.y, target.x - car.x));
    const limit = Math.min(cap, safeSpeed(at.s, car.speed, lateral, 12));
    return { up: car.speed < limit, down: car.speed > limit + 2, left: err < -2.5 * DEG, right: err > 2.5 * DEG, handbrake: false };
  });
}

// Enters each bend with a handbrake tap, then balances the slide with throttle and countersteer.
export function courseDrift({ targetSlip = 32 * DEG, catchSlip = 40 * DEG, tapTime = 0.3, lateral = 8.5, cooldown = 1.4, minCorner = 1 / 80, cap = Infinity } = {}) {
  let tapUntil = 0;
  let cooldownUntil = 0;
  return paced((game, t) => {
    const { car } = game;
    const at = place(game);
    const target = ahead(at.s, 14 + car.speed * 0.6);
    const toTarget = Math.atan2(target.y - car.y, target.x - car.x);
    const pathErr = angleTo(Math.atan2(car.vy, car.vx), toTarget);
    const headingErr = angleTo(car.heading, toTarget);
    const corner = ahead(at.s, car.speed * 0.7).bend;
    const tight = Math.abs(corner) > minCorner;
    const slip = car.slipAngle;
    const sliding = Math.abs(slip) > 8 * DEG;
    const keys = { up: true, down: false, left: false, right: false, handbrake: t < tapUntil };
    const limit = Math.min(cap, safeSpeed(at.s, car.speed, lateral, 11));
    if (car.speed > limit) {
      keys.up = false;
      keys.down = !sliding && car.speed > limit + 1.5;
    }
    if (tight && !sliding && car.speed > 14 && t > cooldownUntil) {
      tapUntil = t + tapTime;
      cooldownUntil = t + cooldown;
      keys.handbrake = true;
    }
    let steer;
    if (sliding) {
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
  });
}

// Starts a real combo, then either slows and straightens to bank it or holds a spin.
// Uses controls only, so the browser can require both One Drift outcomes regardless of
// small differences between the unit driver's tick cadence and browser frame cadence.
export function courseFirstCombo({ lose = false } = {}) {
  const drift = courseDrift({ targetSlip: 32 * DEG, catchSlip: 40 * DEG, tapTime: 0.3, lateral: 9.5, cooldown: 1.4 });
  const grip = courseGrip({ lateral: 10, cap: 12 });
  let ending = false;
  return (game) => {
    if (game.scoring.combo?.points > 50) ending = true;
    if (!ending) return drift(game);
    return lose ? { up: true, down: false, left: false, right: true, handbrake: true } : grip(game);
  };
}

// Hauls on the handbrake through every bend and never countersteers.
export function courseReckless() {
  return paced((game) => {
    const { car } = game;
    const at = place(game);
    const target = ahead(at.s, 12 + car.speed * 0.5);
    const err = angleTo(car.heading, Math.atan2(target.y - car.y, target.x - car.x));
    const corner = ahead(at.s, car.speed * 0.5).bend;
    return { up: true, down: false, left: err < -2.5 * DEG, right: err > 2.5 * DEG, handbrake: Math.abs(corner) > 1 / 110 && car.speed > 12 };
  });
}

// Drives `base` until the car reaches `fromS`, then circles on full lock and handbrake for
// `seconds`, then carries on with `base`. The donut covers no new course.
export function courseDonut(base, { fromS = 60, seconds = 10 } = {}) {
  let until = null;
  return (game) => {
    const t = game.ticks * TUNING.simStep;
    if (until === null && game.challenge.s >= fromS) until = t + seconds;
    if (until !== null && t < until) return { up: true, down: false, left: false, right: true, handbrake: Math.floor(t * 2) % 2 === 0 };
    return base(game);
  };
}

// Flicks left and right down the run-up, to see what the straight alone can be made to pay.
export function courseWeave(base, { untilS = 45, period = 1.1 } = {}) {
  return (game) => {
    const t = game.ticks * TUNING.simStep;
    if (game.challenge.s >= untilS || game.car.speed < 15) return base(game);
    const phase = (t % period) / period;
    const right = phase < 0.5;
    return { up: true, down: false, left: !right, right, handbrake: (phase % 0.5) < 0.18 };
  };
}

// --- Slalom Sprint ---------------------------------------------------------------------------
// A weaver that reads the challenge's own geometry, as the v0.5.0 research harness's did.
const SL = SLALOM_SPRINT.geometry;
const ease = (u) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, u)))) / 2;

// The line a weaver aims along: `amp` metres to the required side of each cone, eased from one
// to the next, and `exitY` metres off the centre of the finish gate at the end.
function slalomLine(amp, exitY) {
  const { slalom, runUp, runOut, spacing } = SL;
  const lead = Math.min(22, runUp * 0.6);
  const last = slalom.length - 1;
  return (x) => {
    if (x <= slalom[0].x) return amp * slalom[0].side * ease((x - (slalom[0].x - lead)) / lead);
    for (let i = 0; i < last; i += 1) {
      if (x <= slalom[i + 1].x) return amp * (slalom[i].side + (slalom[i + 1].side - slalom[i].side) * ease((x - slalom[i].x) / spacing));
    }
    const out = ease((x - slalom[last].x) / (runOut * 0.6));
    return amp * slalom[last].side * (1 - out) + exitY * out;
  };
}

// Weaves at `speed` m/s, `amp` metres to the required side of each cone. A negative `amp` takes
// every cone on the wrong side. `tap` > 0 adds a handbrake flick of that many seconds at each
// cone, `flat` never lifts, and `exitY` aims that far off the centre of the finish gate.
export function slalomWeave({ speed = 19.25, amp = 2.8, lookV = 0.4, tap = 0, flat = false, exitY = 0 } = {}) {
  const line = slalomLine(amp, exitY);
  const xs = SL.slalom.map((c) => c.x);
  const lastX = xs[xs.length - 1];
  let next = 0;
  let tapUntil = -1;
  let tapped = -1;
  let keys = KEYS();
  keys.up = true;
  return (game) => {
    const t = game.ticks * TUNING.simStep;
    if (t < next) { keys.handbrake = t < tapUntil; return keys; }
    next = t + DECISION_INTERVAL;
    const { car } = game;
    const tx = car.x + 6 + lookV * car.speed;
    const err = angleTo(car.heading, Math.atan2(line(tx) - car.y, tx - car.x));
    keys = { up: true, down: false, left: err < -2 * DEG, right: err > 2 * DEG, handbrake: false };
    if (!flat && car.x < lastX - 2) {
      // The fastest speed from which the first cone can still be reached at the weaving speed.
      const limit = Math.sqrt(speed * speed + 2 * 16 * Math.max(0, xs[0] - 4 - car.x));
      keys.up = car.speed < limit;
      keys.down = car.speed > limit + 1.5;
    }
    if (tap > 0) {
      const i = xs.findIndex((x) => car.x >= x - 1 && car.x < x + 4);
      if (i >= 0 && i !== tapped && i < xs.length - 1) { tapped = i; tapUntil = t + tap; }
      keys.handbrake = t < tapUntil;
    }
    return keys;
  };
}

// Flat out along the line of cones, touching nothing but the throttle.
export function slalomStraight() {
  return () => ({ up: true, down: false, left: false, right: false, handbrake: false });
}

// Runs one challenge through the session loop (game.js tick) with a driver, exactly as the
// page does, until the session is over or `limit` seconds have passed.
export function drive(def, handling, driver, { limit = 90, onRunEvent = null } = {}) {
  const game = createGame(undefined, { handling, onRunEvent });
  startRun(game, { mode: 'gymkhana', ghost: false, handling, challenge: def });
  const maxTicks = Math.round(limit / TUNING.simStep);
  for (let i = 0; i < maxTicks && game.state !== 'finished'; i += 1) tick(game, driver(game));
  return { run: game.challenge, result: game.challenge.result, game };
}
