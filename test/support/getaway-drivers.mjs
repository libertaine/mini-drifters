// Scripted drivers for Getaway Drift (R4 research). Ports of gymkhana-drivers.mjs's course
// drivers that read any Getaway layout's course instead of Linked Drift's. Like those, they
// press the same on/off keys a person does, decide 15 times a second, and never move the car.
// They see the police car only as a person sees it on screen: where it is now.
import { TUNING } from '../../src/tuning.js';
import { createGame, startRun, tick } from '../../src/game.js';
import { projectOnCourse } from '../../src/gymkhana.js';

const DECISION_INTERVAL = 1 / 15;
export const DEG = Math.PI / 180;
const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const KEYS = () => ({ up: false, down: false, left: false, right: false, handbrake: false });

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

const courseOf = (game) => game.challengeDef.geometry.course;
const ahead = (game, s, d) => { const pts = courseOf(game).points; return pts[Math.max(0, Math.min(pts.length - 1, Math.round(s + d)))]; };
const place = (game) => projectOnCourse(courseOf(game), game.car.x, game.car.y, game.challenge.index);

function safeSpeed(game, s, speed, lateral, braking) {
  let limit = TUNING.topSpeed;
  const horizon = Math.max(30, speed * speed / (2 * braking) + 25);
  for (let d = 0; d < horizon; d += 4) {
    const k = Math.abs(ahead(game, s, d).bend);
    if (k < 1e-4) continue;
    limit = Math.min(limit, Math.sqrt(lateral / k + 2 * braking * d));
  }
  return limit;
}

// Grip only, never the handbrake. `lateral` is how hard it corners (m/s^2).
export function getawayGrip({ lateral = 10, cap = Infinity, line = 0 } = {}) {
  return paced((game) => {
    const { car } = game;
    const at = place(game);
    const p = ahead(game, at.s, 12 + car.speed * 0.55);
    const tx = p.x - p.ty * line;
    const ty = p.y + p.tx * line;
    const err = angleTo(car.heading, Math.atan2(ty - car.y, tx - car.x));
    const limit = Math.min(cap, safeSpeed(game, at.s, car.speed, lateral, 12));
    return { up: car.speed < limit, down: car.speed > limit + 2, left: err < -2.5 * DEG, right: err > 2.5 * DEG, handbrake: false };
  });
}

// Handbrake-tap entry, then throttle and countersteer: gymkhana-drivers.mjs's courseDrift.
// `minCorner` is the tightest-bend curvature it bothers to drift (1/radius).
export function getawayDrift({ targetSlip = 32 * DEG, catchSlip = 40 * DEG, tapTime = 0.3, lateral = 8.5, cooldown = 1.4, minCorner = 1 / 80, cap = Infinity } = {}) {
  let tapUntil = 0;
  let cooldownUntil = 0;
  return paced((game, t) => {
    const { car } = game;
    const at = place(game);
    const target = ahead(game, at.s, 14 + car.speed * 0.6);
    const toTarget = Math.atan2(target.y - car.y, target.x - car.x);
    const pathErr = angleTo(Math.atan2(car.vy, car.vx), toTarget);
    const headingErr = angleTo(car.heading, toTarget);
    const corner = ahead(game, at.s, car.speed * 0.7).bend;
    const tight = Math.abs(corner) > minCorner;
    const slip = car.slipAngle;
    const sliding = Math.abs(slip) > 8 * DEG;
    const keys = { up: true, down: false, left: false, right: false, handbrake: t < tapUntil };
    const limit = Math.min(cap, safeSpeed(game, at.s, car.speed, lateral, 11));
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
      if (Math.abs(slip) > catchSlip) { steer = Math.sign(slip); keys.up = false; }
    } else {
      steer = headingErr > 2.5 * DEG ? 1 : headingErr < -2.5 * DEG ? -1 : 0;
      if (tight && t < tapUntil) steer = Math.sign(corner);
    }
    keys.right = steer > 0;
    keys.left = steer < 0;
    return keys;
  });
}

// Flicks left and right on the straights to earn straight-line fishtail points (an accepted
// behaviour), and hands the bends to `base`.
export function getawayWeave(base, { period = 1.1, minSpeed = 15 } = {}) {
  return (game) => {
    const t = game.ticks * TUNING.simStep;
    const at = place(game);
    const straight = Math.abs(ahead(game, at.s, 10).bend) < 1e-4 && Math.abs(ahead(game, at.s, 30).bend) < 1e-4 && Math.abs(at.offset) < 6;
    if (!straight || game.car.speed < minSpeed) return base(game);
    const phase = (t % period) / period;
    const right = phase < 0.5;
    return { up: true, down: false, left: !right, right, handbrake: (phase % 0.5) < 0.18 };
  };
}

// Drifts with `drift`, and once the live combo is worth `bankAt` points straightens up on grip
// until the combo banks (grace runs out), then drifts again.
export function getawayBank(drift, grip, { bankAt = 250 } = {}) {
  let banking = false;
  return (game) => {
    const combo = game.scoring.combo;
    if (!banking && combo && combo.points * (TUNING.comboTiers[combo.tier] ?? 1) >= bankAt) banking = true;
    if (banking && !combo) banking = false;
    return banking ? grip(game) : drift(game);
  };
}

// Watches the mirror: with the police car close behind, brakes and flicks the car sideways for a
// moment so a pursuer carrying speed overshoots, then carries on with `base`.
export function getawayEvasive(base, { trigger = 9, hold = 0.7, cooldown = 4 } = {}) {
  let until = -1;
  let next = 0;
  let side = 1;
  return (game) => {
    const t = game.ticks * TUNING.simStep;
    const p = game.challenge.pursuer;
    const { car } = game;
    const gap = Math.hypot(car.x - p.x, car.y - p.y);
    const behind = (p.x - car.x) * Math.cos(car.heading) + (p.y - car.y) * Math.sin(car.heading) < 0;
    if (t >= next && gap < trigger && behind && car.speed > 10) { until = t + hold; next = t + cooldown; side = -side; }
    if (t < until) return { up: false, down: true, left: side < 0, right: side > 0, handbrake: true };
    return base(game);
  };
}

// Stops dead for `seconds` at `fromS` metres, then carries on: the meter must catch a car that does nothing.
export function getawayStall(base, { fromS = 120, seconds = 5 } = {}) {
  let until = null;
  return (game) => {
    const t = game.ticks * TUNING.simStep;
    if (until === null && game.challenge.s >= fromS) until = t + seconds;
    if (until !== null && t < until) return { up: false, down: game.car.forwardSpeed > 0.2, left: false, right: false, handbrake: false };
    return base(game);
  };
}

// Circles on full lock and handbrake for `seconds` at `fromS` metres: baiting the pursuer, and
// the farming probe (no new ground, so no points).
export function getawayDonut(base, { fromS = 120, seconds = 8 } = {}) {
  let until = null;
  return (game) => {
    const t = game.ticks * TUNING.simStep;
    if (until === null && game.challenge.s >= fromS) until = t + seconds;
    if (until !== null && t < until) return { up: true, down: false, left: false, right: true, handbrake: Math.floor(t * 2) % 2 === 0 };
    return base(game);
  };
}

// Open layout only: from the grid, turn round and drive straight for the escape gate, which is
// in reach but shut. Then try the course. The early-exit probe.
export function getawayExitFirst(base) {
  let tried = false;
  return paced((game) => {
    const { car } = game;
    const { exit } = game.challengeDef.geometry;
    if (!tried) {
      if (game.challenge.lockedTries > 0) tried = true;
      // Aim a little before the gate, then through it in its direction.
      const before = { x: exit.cx - exit.tx * 25, y: exit.cy - exit.ty * 25 };
      const d = Math.hypot(before.x - car.x, before.y - car.y);
      const target = d > 8 ? before : { x: exit.cx + exit.tx * 20, y: exit.cy + exit.ty * 20 };
      const err = angleTo(car.heading, Math.atan2(target.y - car.y, target.x - car.x));
      return { up: car.speed < 14, down: car.speed > 17, left: err < -3 * DEG, right: err > 3 * DEG, handbrake: false };
    }
    return base(game);
  });
}

// Runs a Getaway challenge through the real session loop until it is over or `limit` seconds pass.
export function driveGetaway(def, handling, driver, { limit = 170, onTick = null } = {}) {
  const game = createGame(undefined, { handling });
  startRun(game, { mode: 'gymkhana', ghost: false, handling, challenge: def });
  const maxTicks = Math.round(limit / TUNING.simStep);
  for (let i = 0; i < maxTicks && game.state !== 'finished'; i += 1) {
    tick(game, driver(game));
    onTick?.(game);
  }
  return { run: game.challenge, result: game.challenge.result, game };
}
