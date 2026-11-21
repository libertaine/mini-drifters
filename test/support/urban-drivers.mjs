// Scripted drivers for Getaway Drift in town (R4B research). Ports of getaway-drivers.mjs's R4
// drivers, which follow a course line, onto a planned route through the streets: the same route
// the HUD's guidance arrow shows, chained through every camera to the escape gate, with its corners
// rounded into arcs a driver could take. Like the R4 drivers they press the same on/off keys a
// person does, decide 15 times a second, and never move the car. They see the police car only as a
// person sees it on screen: where it is now. Off their plan (a wrong turn, a missed camera), they
// re-plan from the live guidance, as a person following the arrow would.
import { TUNING } from '../../src/tuning.js';
import { createGame, startRun, tick } from '../../src/game.js';
import { projectOnCourse } from '../../src/gymkhana.js';
import { locate, route, routeToGate, segmentHitsBox } from '../../src/getaway-city.js';

const DECISION_INTERVAL = 1 / 15;
export const DEG = Math.PI / 180;
const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const KEYS = () => ({ up: false, down: false, left: false, right: false, handbrake: false });

// --- Plans ---------------------------------------------------------------------------------------
// The route from `place` through `gates` in order, as one polyline.
export function planPolyline(city, place, gates, options = {}) {
  const pts = [];
  let at = place;
  for (const gate of gates) {
    const r = routeToGate(city, at, gate, options);
    if (!r) return null;
    for (const p of r.points) {
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.5) pts.push(p);
    }
    at = { edge: gate.edge, t: Math.max(0, Math.min(city.edges[gate.edge].len, gate.at + gate.sign * 6)) };
  }
  return pts;
}

// Like planPolyline, but an entry may also be { node }: drive to that junction first.
function planVia(city, place, entries, options) {
  const pts = [];
  let at = place;
  for (const entry of entries) {
    let r;
    if (entry.node) {
      const n = city.nodes[entry.node];
      const e = city.edges[n.edges[0]];
      const target = { edge: e.index, t: e.a === entry.node ? 0 : e.len };
      r = route(city, at, target, options);
      if (r) at = target;
    } else {
      r = routeToGate(city, at, entry, options);
      if (r) at = { edge: entry.edge, t: Math.max(0, Math.min(city.edges[entry.edge].len, entry.at + entry.sign * 6)) };
    }
    if (!r) return null;
    for (const p of r.points) {
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.5) pts.push(p);
    }
  }
  return pts;
}

// A polyline with its corners rounded, as a course: one point a metre, each with its direction and
// curvature, the shape gymkhana.js's courses have (so projectOnCourse works on it).
export function filletCourse(city, poly, { factor = 1.2 } = {}) {
  // Drop collinear points.
  const P = [poly[0]];
  for (let i = 1; i < poly.length - 1; i += 1) {
    const a = P[P.length - 1];
    const b = poly[i];
    const c = poly[i + 1];
    const t = Math.abs(angleTo(Math.atan2(b[1] - a[1], b[0] - a[0]), Math.atan2(c[1] - b[1], c[0] - b[0])));
    if (t > 2 * DEG && Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.5) P.push(b);
  }
  P.push(poly[poly.length - 1]);
  const widthNear = (x, y) => city.edges[locate(city, x, y).edge].width;
  // Build segments: straights and arcs.
  const pieces = [];
  let cur = P[0];
  for (let i = 1; i < P.length; i += 1) {
    const b = P[i];
    if (i === P.length - 1) { pieces.push({ type: 'line', from: cur, to: b }); break; }
    const a = P[i - 1];
    const c = P[i + 1];
    const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    const turn = angleTo(h1, h2);
    const abs = Math.min(Math.abs(turn), 170 * DEG);
    const l1 = Math.hypot(b[0] - cur[0], b[1] - cur[1]);
    const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const w = Math.min(widthNear((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), widthNear((b[0] + c[0]) / 2, (b[1] + c[1]) / 2));
    // As wide a line as the corner allows: the arc's middle must clear the inside building corner
    // (half the narrower street out along each centre line) by the car's radius and a margin.
    let R = Math.min(factor * w, (Math.SQRT2 * (w / 2) - 2.7) / (Math.SQRT2 - 1));
    R = Math.max(2.5, Math.min(R, (0.48 * Math.min(l1, l2)) / Math.tan(abs / 2)));
    if (R * Math.tan(abs / 2) > 0.48 * Math.min(l1, l2)) R = (0.48 * Math.min(l1, l2)) / Math.tan(abs / 2);
    const tan = R * Math.tan(abs / 2);
    const p1 = [b[0] - Math.cos(h1) * tan, b[1] - Math.sin(h1) * tan];
    pieces.push({ type: 'line', from: cur, to: p1 });
    pieces.push({ type: 'arc', from: p1, heading: h1, turn: Math.sign(turn) * abs, R });
    cur = [b[0] + Math.cos(h2) * tan, b[1] + Math.sin(h2) * tan];
  }
  const points = [];
  let s = 0;
  let next = 0;
  const fine = 0.1;
  for (const pc of pieces) {
    if (pc.type === 'line') {
      const len = Math.hypot(pc.to[0] - pc.from[0], pc.to[1] - pc.from[1]);
      const h = Math.atan2(pc.to[1] - pc.from[1], pc.to[0] - pc.from[0]);
      for (let d = 0; d < len; d += fine) {
        if (s >= next) { points.push({ x: pc.from[0] + Math.cos(h) * d, y: pc.from[1] + Math.sin(h) * d, tx: Math.cos(h), ty: Math.sin(h), s: next, bend: 0 }); next += 1; }
        s += fine;
      }
    } else {
      let h = pc.heading;
      let [x, y] = pc.from;
      const len = Math.abs(pc.turn) * pc.R;
      const k = Math.sign(pc.turn) / pc.R;
      for (let d = 0; d < len; d += fine) {
        if (s >= next) { points.push({ x, y, tx: Math.cos(h), ty: Math.sin(h), s: next, bend: k }); next += 1; }
        h += k * fine;
        x += Math.cos(h) * fine;
        y += Math.sin(h) * fine;
        s += fine;
      }
    }
  }
  // A run-on past the end, so look-aheads never run out.
  const last = points[points.length - 1];
  for (let d = 1; d <= 40; d += 1) points.push({ x: last.x + last.tx * d, y: last.y + last.ty * d, tx: last.tx, ty: last.ty, s: last.s + d, bend: 0 });
  return { points, length: points.length - 1 };
}

// The driver's own route and its place on it. `shape(city, run)` returns the gates to plan through
// (default: every camera still to film, then the exit) and planning options.
function createNavigator(game, { throughBarricades = false, narrowCost = 1.3, skip = null, via = null } = {}) {
  const nav = { course: null, index: 0, built: -1, missedSeen: 0, lockedSeen: 0 };
  const city = game.challengeDef.geometry.city;
  const plan = () => {
    const run = game.challenge;
    const place = locate(city, game.car.x, game.car.y, run.edge);
    const remaining = city.cameras.slice(run.nextCamera);
    // The deliberate skip: leave camera `skip` out of the first plan (recovery research).
    const gates = (skip !== null && run.nextCamera < skip && nav.missedSeen === 0 && nav.lockedSeen === 0)
      ? [...remaining.filter((c) => c.number !== skip), city.exit]
      : [...remaining, city.exit];
    // A detour through named junctions once camera `via.afterCamera` is filmed (the loop probe).
    let entries = gates;
    if (via && run.nextCamera >= via.afterCamera && !nav.viaDone) {
      nav.viaDone = true;
      entries = [...via.nodes.map((id) => ({ node: id })), ...gates];
    }
    const poly = planVia(city, place, entries, { broken: run.broken, throughBarricades, narrowCost });
    if (!poly || poly.length < 2) return;
    // Start the plan from the car itself.
    poly[0] = [game.car.x, game.car.y];
    nav.course = filletCourse(city, poly);
    nav.index = 0;
    nav.built = game.ticks;
  };
  nav.update = () => {
    const run = game.challenge;
    if (!nav.course) plan();
    if (!nav.course) return null;
    if (run.missedShots > nav.missedSeen) { nav.missedSeen = run.missedShots; plan(); }
    if (run.lockedTries > nav.lockedSeen) { nav.lockedSeen = run.lockedTries; plan(); }
    if (via && !nav.viaDone && run.nextCamera >= via.afterCamera) plan();
    const at = projectOnCourse(nav.course, game.car.x, game.car.y, nav.index);
    nav.index = at.index;
    // Lost (pushed off, spun, or past the end): plan again from here, at most twice a second.
    if ((Math.abs(at.offset) > 18 || at.index >= nav.course.points.length - 41) && game.ticks - nav.built > 60) { plan(); return nav.update2(); }
    return at;
  };
  nav.update2 = () => {
    const at = projectOnCourse(nav.course, game.car.x, game.car.y, 0);
    nav.index = at.index;
    return at;
  };
  nav.ahead = (s, d) => { const pts = nav.course.points; return pts[Math.max(0, Math.min(pts.length - 1, Math.round(s + d)))]; };
  // The plan's point `d` metres on that the car can drive straight to: brought nearer while a
  // building's corner is in the way, as a driver aims at the part of a corner's exit they can see.
  nav.aim = (s, d) => {
    let p = nav.ahead(s, d);
    const { car } = game;
    for (let k = d; k > 4; k *= 0.75) {
      p = nav.ahead(s, k);
      if (!game.obstacles.some((c) => segmentHitsBox(car.x, car.y, p.x, p.y, c, 2.0))) return p;
    }
    return p;
  };
  return nav;
}

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

function safeSpeed(nav, s, speed, lateral, braking) {
  let limit = TUNING.topSpeed;
  const horizon = Math.max(30, speed * speed / (2 * braking) + 25);
  for (let d = 0; d < horizon; d += 2) {
    const k = Math.abs(nav.ahead(s, d).bend);
    if (k < 1e-4) continue;
    limit = Math.min(limit, Math.sqrt(lateral / k + 2 * braking * d));
  }
  return limit;
}

// The navigator is made on the first decision (the game's run must exist).
function withNav(options, decide) {
  let nav = null;
  let runId = -1;
  let pressing = 0;
  let backUntil = -1;
  let backSteer = 0;
  return paced((game, t) => {
    if (!nav || runId !== game.runId) { nav = createNavigator(game, options); runId = game.runId; pressing = 0; backUntil = -1; }
    const at = nav.update();
    if (!at) return KEYS();
    // Nose against a wall and going nowhere: back off for a moment, steering the other way, as a
    // person would.
    if (t < backUntil) return { up: false, down: true, left: backSteer < 0, right: backSteer > 0, handbrake: false };
    // Facing the wrong way along the plan (a turnaround): brake, then full lock round.
    const p = nav.ahead(at.s, 8);
    const err = angleTo(game.car.heading, Math.atan2(p.y - game.car.y, p.x - game.car.x));
    if (Math.abs(err) > 110 * DEG && game.car.speed > 2) {
      return { up: false, down: game.car.forwardSpeed > 4, left: err < 0, right: err > 0, handbrake: game.car.speed > 6 };
    }
    const keys = Math.abs(err) > 110 * DEG ? { up: true, down: false, left: err < 0, right: err > 0, handbrake: false } : decide(game, t, nav, at);
    pressing = keys.up && game.car.speed < 0.6 ? pressing + DECISION_INTERVAL : 0;
    if (pressing > 0.8) { pressing = 0; backUntil = t + 0.9; backSteer = err > 0 ? -1 : 1; }
    return keys;
  });
}

// Grip only, never the handbrake.
export function urbanGrip({ lateral = 10, cap = Infinity, ...nav } = {}) {
  return withNav(nav, (game, t, N, at) => {
    const { car } = game;
    const p = N.aim(at.s, 10 + car.speed * 0.5);
    const err = angleTo(car.heading, Math.atan2(p.y - car.y, p.x - car.x));
    const limit = Math.min(cap, safeSpeed(N, at.s, car.speed, lateral, 12));
    return { up: car.speed < limit, down: car.speed > limit + 2, left: err < -2.5 * DEG, right: err > 2.5 * DEG, handbrake: false };
  });
}

// Handbrake-tap entry, then throttle and countersteer (R4's getawayDrift).
export function urbanDrift({ targetSlip = 32 * DEG, catchSlip = 40 * DEG, tapTime = 0.3, lateral = 11, cooldown = 1.4, minCorner = 1 / 40, tapSpeed = 11, cap = Infinity, ...nav } = {}) {
  let tapUntil = 0;
  let cooldownUntil = 0;
  return withNav(nav, (game, t, N, at) => {
    const { car } = game;
    const target = N.aim(at.s, 12 + car.speed * 0.55);
    const toTarget = Math.atan2(target.y - car.y, target.x - car.x);
    const pathErr = angleTo(Math.atan2(car.vy, car.vx), toTarget);
    const headingErr = angleTo(car.heading, toTarget);
    const corner = N.ahead(at.s, car.speed * 0.6).bend;
    const tight = Math.abs(corner) > minCorner;
    const slip = car.slipAngle;
    const sliding = Math.abs(slip) > 8 * DEG;
    const keys = { up: true, down: false, left: false, right: false, handbrake: t < tapUntil };
    const limit = Math.min(cap, safeSpeed(N, at.s, car.speed, lateral, 11));
    if (car.speed > limit) {
      keys.up = false;
      keys.down = !sliding && car.speed > limit + 1.5;
    }
    if (tight && !sliding && car.speed > tapSpeed && t > cooldownUntil) {
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

// Fishtails the straights (R4's getawayWeave), handing the corners to `base`. Needs its own view of
// the plan, so it peeks at the base driver's navigator through the game's car and run state.
export function urbanWeave(base, { period = 1.1, minSpeed = 15, maxSpeed = 22, ...nav } = {}) {
  let N = null;
  let runId = -1;
  return (game) => {
    if (!N || runId !== game.runId) { N = createNavigator(game, nav); runId = game.runId; }
    const at = N.update();
    const t = game.ticks * TUNING.simStep;
    if (!at) return base(game);
    const straight = [10, 25, 40].every((d) => Math.abs(N.ahead(at.s, d).bend) < 1e-4) && Math.abs(at.offset) < 4;
    if (!straight || game.car.speed < minSpeed) return base(game);
    const phase = (t % period) / period;
    const right = phase < 0.5;
    // Fishtailing is done at a pace the car can hold: off the throttle above `maxSpeed`.
    return { up: game.car.speed < maxSpeed, down: false, left: !right, right, handbrake: (phase % 0.5) < 0.18 };
  };
}

// Drifts, and banks each combo once it is worth `bankAt` (R4's getawayBank).
export function urbanBank(drift, grip, { bankAt = 250 } = {}) {
  let banking = false;
  return (game) => {
    const combo = game.scoring.combo;
    if (!banking && combo && combo.points * (TUNING.comboTiers[combo.tier] ?? 1) >= bankAt) banking = true;
    if (banking && !combo) banking = false;
    return banking ? grip(game) : drift(game);
  };
}

// With the police car close behind: brake and flick sideways (R4's getawayEvasive).
export function urbanEvasive(base, { trigger = 9, hold = 0.7, cooldown = 4 } = {}) {
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

// Stops dead for `seconds` once `after` metres of street are behind it.
export function urbanStall(base, { after = 150, seconds = 5 } = {}) {
  let until = null;
  return (game) => {
    const t = game.ticks * TUNING.simStep;
    if (until === null && game.challenge.ground >= after) until = t + seconds;
    if (until !== null && t < until) return { up: false, down: game.car.forwardSpeed > 0.2, left: false, right: false, handbrake: false };
    return base(game);
  };
}

// Circles on full lock and handbrake for `seconds` (the farming probe, and baiting the police).
export function urbanDonut(base, { after = 150, seconds = 8 } = {}) {
  let until = null;
  return (game) => {
    const t = game.ticks * TUNING.simStep;
    if (until === null && game.challenge.ground >= after) until = t + seconds;
    if (until !== null && t < until) return { up: true, down: false, left: false, right: true, handbrake: Math.floor(t * 2) % 2 === 0 };
    return base(game);
  };
}

// Runs an urban challenge through the real session loop until it is over or `limit` seconds pass.
export function driveUrban(def, handling, driver, { limit = 200, onTick = null } = {}) {
  const game = createGame(undefined, { handling });
  startRun(game, { mode: 'gymkhana', ghost: false, handling, challenge: def });
  const maxTicks = Math.round(limit / TUNING.simStep);
  for (let i = 0; i < maxTicks && game.state !== 'finished'; i += 1) {
    tick(game, driver(game));
    onTick?.(game);
  }
  return { run: game.challenge, result: game.challenge.result, game };
}
