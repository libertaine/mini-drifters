// Getaway Drift in town: Downtown and Industrial. EXPERIMENTAL (v0.7.0 R4B research), not a
// shipped challenge.
//
// R4's chase (getaway.js) moved onto city streets: buildings, hard corners, a dead end, a police
// blockade, two kinds of flimsy scenery to smash through, and a police car that knows the streets.
// It is a gymkhana challenge object, so game.js runs it unchanged:
//   - the car, the handling modes and the drift scoring are the game's own. The scoring is fed as
//     Linked Drift feeds it, with the city in place of a course line: each metre of each street
//     pays once ("new ground"), so circling, or driving a street a second time, pays nothing;
//   - the buildings, props and blockades are ordinary solid scenery (obstacles.js) the session
//     already collides the car with: the track carries them as `colliders`;
//   - the one place this module touches the car is a smash: hitting a fruit stand or a wooden
//     barricade breaks it and takes a share of the car's speed, instead of stopping it as a wall
//     would. R4C keeps this speed loss separate from solid-collision combo penalties;
//   - the police car is plain run data (run.pursuer) and never touches the player's car: capture
//     is judged by R4's bust meter;
//   - nothing here reads or writes storage. It is not in GYMKHANA_CHALLENGES, so the records never
//     see it, and its medals are its own table, not medals.js's.
import { TUNING } from './tuning.js';
import { gateCrossing } from './track.js';
import { padTrack } from './practice-pad.js';
import { updateDerived } from './physics.js';
import { resolveObstacles } from './obstacles.js';
import { updateScoring, bankCombo, loseCombo } from './scoring.js';
import { PURSUER, CAPTURE_MODELS, captureRate, createPursuer } from './getaway.js';
import { CITY_LAYOUTS, buildCity, locate, lineOfSight, route, segmentHitsBox, roundCorners } from './getaway-city.js';
import { NAV, planGuide, shortcutFor } from './getaway-nav.js';

const DEG = Math.PI / 180;
const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// --- The police car in town ----------------------------------------------------------------------
// R4's car model (getaway.js PURSUER: top speed, acceleration, braking, a cornering grip that caps
// its yaw rate, a smallest turning circle), unchanged, with what a city adds:
//   - it collides with the buildings and props exactly as the player's car does (obstacles.js),
//     so it can run wide into a wall, slide along it and lose speed;
//   - it only "closes" (aims straight at the car, R4's closing state) when it can see the car:
//     never through a building;
//   - its way round the streets is one of three navigation modes, the research comparison:
//       trail      A: R4's trail following. It drives the player's own trail, nothing more.
//       network    B0: street routing. It knows the street graph (blocked streets closed) and drives
//                  the shortest way to where it last knew the car was. It knows where the car is
//                  when it can see it (within `sight`, nothing tall between) or is close, and
//                  otherwise only from a dispatch update every `ping` seconds.
//       intercept  B: street routing, plus an occasional short-horizon cut-off: when the car is
//                  heading for a junction it will reach within `interceptHorizon` seconds, and the
//                  police car can get there first by road, it goes for the junction instead.
//   - it brakes for the corners on its route (a street corner of width w is taken on a circle of
//     about `cornerFactor` x w), planning with the same slightly optimistic grip as R4, so it can
//     overshoot a junction and have to come back;
//   - pinned against a wall, it backs off and tries again (counted).
// R4's numbers in town produced no pressure at all: a clean driver was never closer than the 25 m
// start gap (R4B sweep, artifacts/results/r4b-sweep.json), because a city corner every 75-95 m gives
// the police no straight to close on. So in town it corners and accelerates harder: grip 10.5 m/s^2
// (R4: 7.2; the player's tyres peak at about 15) and 8 m/s^2 (R4: 7; the car launches at 11). At
// 9 m/s^2 a careful driver (cornering at 8 m/s^2) was caught at Industrial's first corner 9 times in
// 10 (artifacts/results/r4b-fairness.txt). Its top speed (35 m/s; the car's is 42), braking, start
// gap and start delay are R4's.
export const URBAN_PURSUER = Object.freeze({
  ...PURSUER,
  grip: 10.5,
  gripPlan: 11.8,
  accel: 8,
  cornerFactor: 1.2,
  cornerMax: 22,           // metres: its line through a junction is never wider than this, whatever
                           // the street's width (a police car keeps roughly to a lane; the full width
                           // of a wide street is the drifting player's)
  replan: 0.25,            // seconds between route plans
  sight: 80,               // metres it can see the car along a clear line
  ping: 1.5,               // seconds between dispatch updates when it can't see the car
  interceptHorizon: 3.5,   // seconds: how far ahead a cut-off is considered
  interceptMargin: 0.5,    // seconds it must expect to arrive before the car
  interceptCooldown: 3,
  unstickTime: 0.6,        // seconds pinned against a wall before backing off
  closingCorner: false,    // research option: cap the closing speed by the curve onto the car. It
                           // made the chase harsher, not fairer (it removes the overshoots that give
                           // the player room), so it is off
  reckon: 1.5,             // seconds of dead reckoning from the last news of the car
});
export const PURSUIT_MODES = Object.freeze(['trail', 'network', 'intercept']);
// 'standard' is the R4B police car above; 'r4' is R4's own numbers, kept for the comparison.
export const URBAN_TIERS = Object.freeze({
  standard: Object.freeze({}),
  r4: Object.freeze({ grip: PURSUER.grip, gripPlan: PURSUER.gripPlan, accel: PURSUER.accel, cornerFactor: 0.9, cornerMax: Infinity }),
});

function createUrbanPursuer(start, P) {
  return {
    ...createPursuer(start, P),
    path: null, pathNodes: null, pathIdx: 0, replanIn: 0, edge: -1,
    known: null, knownAt: -Infinity, fresh: false, sees: false,
    goal: 'car', interceptUntil: -Infinity, interceptCooldown: 0, intercepts: 0,
    contactAge: Infinity, wallHits: 0, pinned: 0, unsticks: 0, smashes: 0, backOff: 0,
  };
}

// Is the straight line from (ax, ay) to (bx, by) clear of every solid for a car's body? A driver
// steers for a point it can actually drive straight to: not one round a building's corner.
function clearLine(colliders, ax, ay, bx, by, pad) {
  for (const c of colliders) if (segmentHitsBox(ax, ay, bx, by, c, pad)) return false;
  return true;
}

// The trail point `look` metres on from the pursuer's place on the trail (R4's following), brought
// nearer while the way to it is blocked.
function trailTarget(p, trail, look, spacing, colliders) {
  const end = trail.length - 1;
  let best = p.crumb;
  let bestD = Infinity;
  for (let i = Math.max(0, p.crumb - 5); i <= Math.min(end, p.crumb + 80); i += 1) {
    const d = (trail[i].x - p.x) ** 2 + (trail[i].y - p.y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  p.crumb = best;
  let steps = Math.max(1, Math.round(look / spacing));
  let target = trail[Math.min(end, best + steps)];
  while (steps > 1 && !clearLine(colliders, p.x, p.y, target.x, target.y, 1.6)) {
    steps -= 1;
    target = trail[Math.min(end, best + steps)];
  }
  return target;
}

function trailSpeed(p, trail, P) {
  let limit = P.vMax;
  const end = trail.length - 1;
  const horizon = Math.max(30, (p.speed * p.speed) / (2 * P.brake) + 20);
  const n = Math.min(end - p.crumb, Math.ceil(horizon / P.crumbSpacing));
  for (let k = 2; k < n - 2; k += 1) {
    const a = trail[p.crumb + k - 2];
    const b = trail[p.crumb + k];
    const c = trail[p.crumb + k + 2];
    const turn = Math.abs(angleTo(Math.atan2(b.y - a.y, b.x - a.x), Math.atan2(c.y - b.y, c.x - b.x)));
    if (turn < 1e-3) continue;
    const radius = Math.hypot(c.x - a.x, c.y - a.y) / 2 / turn;
    limit = Math.min(limit, Math.sqrt(P.gripPlan * radius + 2 * P.brake * k * P.crumbSpacing));
  }
  return limit;
}

// A node as a place on the network (one of its streets, at that end).
function nodePlace(city, id) {
  const e = city.edges[city.nodes[id].edges[0]];
  return { edge: e.index, t: e.a === id ? 0 : e.len };
}

// Plan a route for the police car: to the car's last known place, or, in intercept mode, to the
// junction ahead of it when it can get there first.
function planPursuit(p, env, P) {
  const { city, broken, time } = env;
  const from = locate(city, p.x, p.y, p.edge);
  p.edge = from.edge;
  // Dead reckoning: where the car would be now had it carried on as it was when last known (up to
  // `reckon` seconds on). A car that turned off since then is looked for in the wrong place.
  const age = Math.min(P.reckon, Math.max(0, time - p.knownAt));
  const k = { ...p.known, x: p.known.x + p.known.vx * age, y: p.known.y + p.known.vy * age };
  p.reckoned = [k.x, k.y];
  const goalPlace = locate(city, k.x, k.y);
  let goal = goalPlace;
  p.goal = 'car';
  if (env.mode === 'intercept' && time >= p.interceptCooldown) {
    const e = city.edges[goalPlace.edge];
    const along = k.vx * e.dx + k.vy * e.dy;
    if (Math.abs(along) > 8) {
      const node = along > 0 ? e.b : e.a;
      const dCar = along > 0 ? e.len - goalPlace.t : goalPlace.t;
      const tCar = dCar / Math.abs(along);
      // Not when it is already behind the car on the same street, heading the same way.
      const behindOnStreet = from.edge === goalPlace.edge && (goalPlace.t - from.t) * Math.sign(along) > 0;
      if (tCar < P.interceptHorizon && tCar > 0.6 && !behindOnStreet) {
        const r = route(city, from, nodePlace(city, node), { broken });
        if (r) {
          const tUs = r.length / Math.max(12, 0.8 * P.vMax);
          if (tUs + P.interceptMargin < tCar) {
            goal = nodePlace(city, node);
            p.goal = 'junction';
            p.interceptUntil = time + tCar + 1;
            if (p.state !== 'intercepting') p.intercepts += 1;
          }
        }
      }
    }
    if (p.goal !== 'junction' && time < p.interceptUntil) p.interceptCooldown = time + P.interceptCooldown;
  }
  const r = route(city, from, goal, { broken });
  if (!r) { p.path = null; return; }
  const raw = [[p.x, p.y], ...r.points.slice(1)];
  // Aim at the car's place on its street: where it is across the street (dead reckoning can carry
  // the estimate into a wall), kept off the walls.
  if (p.goal === 'car') {
    const e = city.edges[goalPlace.edge];
    const off = clamp(goalPlace.offset, -(e.half - 3), e.half - 3);
    raw[raw.length - 1] = [e.ax + e.dx * goalPlace.t - e.dy * off, e.ay + e.dy * goalPlace.t + e.dx * off];
  }
  // Its line through the junctions: rounded corners, each with the speed it can take it at.
  const rounded = roundCorners(city, raw, { factor: P.cornerFactor, max: P.cornerMax });
  p.path = rounded.points;
  p.pathLimits = rounded.radii.map((R) => (Number.isFinite(R) ? Math.sqrt(P.gripPlan * R) : Infinity));
  p.pathIdx = 0;
}

// Pure pursuit along the planned route: the point `look` metres on (nearer while the way to it is
// blocked), and the fastest it may go for the corners ahead.
function followPath(p, P, look, colliders) {
  const pts = p.path;
  // Its place: the nearest point on the next couple of legs.
  let bestD = Infinity;
  let best = p.pathIdx;
  let bestT = 0;
  for (let i = p.pathIdx; i < Math.min(pts.length - 1, p.pathIdx + 12); i += 1) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const ex = bx - ax;
    const ey = by - ay;
    const l2 = ex * ex + ey * ey || 1;
    const t = clamp(((p.x - ax) * ex + (p.y - ay) * ey) / l2, 0, 1);
    const d = Math.hypot(p.x - (ax + ex * t), p.y - (ay + ey * t));
    if (d < bestD - 0.5) { bestD = d; best = i; bestT = t; }
  }
  p.pathIdx = best;
  // Walk `look` metres on from there.
  const walk = (distance) => {
    let i = best;
    let [cx, cy] = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * bestT, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * bestT];
    let left = distance;
    while (i < pts.length - 1) {
      const [bx, by] = pts[i + 1];
      const seg = Math.hypot(bx - cx, by - cy);
      if (seg >= left) return [cx + (bx - cx) * (left / seg), cy + (by - cy) * (left / seg)];
      left -= seg;
      cx = bx;
      cy = by;
      i += 1;
    }
    return pts[pts.length - 1];
  };
  let target = walk(look);
  for (let d = look * 0.7; d > 2.5 && !clearLine(colliders, p.x, p.y, target[0], target[1], 1.6); d *= 0.7) target = walk(d);
  // The corners ahead: the arc points on its line, each with the speed it can take it at.
  let limit = P.vMax;
  let along = Math.hypot(pts[best + 1][0] - p.x, pts[best + 1][1] - p.y);
  const horizon = (p.speed * p.speed) / (2 * P.brake) + 30;
  for (let v = best + 1; v < pts.length - 1 && along < horizon; v += 1) {
    const corner = p.pathLimits?.[v] ?? Infinity;
    if (Number.isFinite(corner)) limit = Math.min(limit, Math.sqrt(corner * corner + 2 * P.brake * along));
    along += Math.hypot(pts[v + 1][0] - pts[v][0], pts[v + 1][1] - pts[v][1]);
  }
  return { tx: target[0], ty: target[1], limit };
}

// One step of the police car in town. `car` is read, never written.
export function stepUrbanPursuer(p, car, env, dt, P) {
  const { city } = env;
  p.prevX = p.x;
  p.prevY = p.y;
  p.prevHeading = p.heading;
  const dx = car.x - p.x;
  const dy = car.y - p.y;
  const gap = Math.hypot(dx, dy);
  const toCar = Math.atan2(dy, dx);
  const facing = Math.cos(angleTo(p.heading, toCar));
  p.sees = gap < P.sight && lineOfSight(city, p.x, p.y, car.x, car.y);
  p.contactAge += dt;

  // What it knows of the car (the street modes; the trail is its own knowledge).
  if (env.mode !== 'trail') {
    if (p.sees || gap < 18 || env.time - p.knownAt >= P.ping) {
      p.known = { x: car.x, y: car.y, vx: car.vx, vy: car.vy };
      p.knownAt = env.time;
      p.fresh = true;
    }
  }

  const room = Math.max(0, gap - P.holdGap);
  const stopCap = Math.sqrt(car.speed * car.speed + 2 * P.brake * 0.7 * room);
  const look = Math.max(2 * P.turnRadius + 1, 6 + Math.abs(p.speed) * 0.4);
  let tx;
  let ty;
  let want;
  if (gap < P.interceptRange && p.sees) {
    // R4's closing: aim where the car will be if it carries on, match its speed, never ram it.
    const lead = Math.min(P.lead, gap / 30);
    tx = car.x + car.vx * lead;
    ty = car.y + car.vy * lead;
    want = Math.min(P.vMax, car.speed + P.closeRate * room, stopCap);
    // No faster than its grip lets it curve onto the car: the circle through the aim point that
    // leaves along its heading has radius d / (2 sin(error)).
    if (P.closingCorner) {
      const d = Math.hypot(tx - p.x, ty - p.y);
      const e = Math.abs(angleTo(p.heading, Math.atan2(ty - p.y, tx - p.x)));
      if (e > 0.05) want = Math.min(want, Math.sqrt(P.gripPlan * Math.max(P.turnRadius, d / (2 * Math.sin(Math.min(e, Math.PI / 2))))));
    }
    p.state = 'closing';
    p.path = null;
  } else if (env.mode === 'trail') {
    const target = trailTarget(p, env.trail, look, P.crumbSpacing, env.colliders);
    tx = target.x;
    ty = target.y;
    want = Math.min(trailSpeed(p, env.trail, P), stopCap);
    p.state = 'following';
  } else {
    p.replanIn -= dt;
    if (!p.path || p.replanIn <= 0) {
      p.replanIn = P.replan;
      planPursuit(p, env, P);
      p.fresh = false;
    }
    if (p.path) {
      const f = followPath(p, P, look, env.colliders);
      tx = f.tx;
      ty = f.ty;
      want = f.limit;
      // Arriving at a junction to cut the car off: slow to block it, not to fly through it.
      const end = p.path[p.path.length - 1];
      const toEnd = Math.hypot(end[0] - p.x, end[1] - p.y);
      if (p.goal === 'junction' && toEnd < 25) want = Math.min(want, Math.max(P.crawl, toEnd * 0.6));
      if (p.goal === 'car') want = Math.min(want, stopCap);
    } else {
      tx = car.x;
      ty = car.y;
      want = Math.min(P.crawl + 3, stopCap);
    }
    p.state = p.goal === 'junction' ? 'intercepting' : p.sees ? 'chasing' : 'searching';
  }

  const err = angleTo(p.heading, Math.atan2(ty - p.y, tx - p.x));
  const absErr = Math.abs(err);
  if (absErr > 20 * DEG) want = Math.min(want, Math.max(P.crawl + 3, P.vMax * Math.cos(Math.min(absErr, 80 * DEG))));
  if (absErr > 80 * DEG) want = Math.max(Math.min(want, P.crawl + 3), P.crawl);
  if (gap < P.interceptRange && p.sees && facing < -0.2 && p.speed > 2) {
    if (p.lastState !== 'overshot') p.overshoots += 1;
    p.state = 'overshot';
    p.overshotTime += dt;
  }
  // R4's simplified three-point turn when the target sits inside its turning circle.
  const side = err >= 0 ? 1 : -1;
  const ccx = p.x + Math.cos(p.heading + side * Math.PI / 2) * P.turnRadius;
  const ccy = p.y + Math.sin(p.heading + side * Math.PI / 2) * P.turnRadius;
  const insideCircle = Math.hypot(tx - ccx, ty - ccy) < P.turnRadius * 0.95;
  p.reverseBlock = Math.max(0, (p.reverseBlock ?? 0) - dt);
  if (!(p.reverseTime > 0) && p.reverseBlock <= 0 && insideCircle && absErr > 50 * DEG && p.speed < P.crawl + 3.5) {
    p.reverseTime = 1.4;
    p.reverses += 1;
  }
  // Pinned against a wall, nose in (a scrape along a wall is not pinned): back off, then try again.
  const noseIn = p.contactNormal ? Math.cos(p.heading) * p.contactNormal[0] + Math.sin(p.heading) * p.contactNormal[1] < -0.5 : false;
  if (p.contactAge < 0.3 && noseIn && Math.abs(p.speed) < 1.5 && want > 1 && !(p.reverseTime > 0)) p.pinned += dt;
  else if (p.contactAge >= 0.3) p.pinned = 0;
  if (p.pinned > P.unstickTime && p.reverseBlock <= 0) {
    p.backOff = 0.9;          // a committed back-off: not cut short because the target is ahead
    p.reverses += 1;
    p.unsticks += 1;
    p.pinned = 0;
  }
  if (p.backOff > 0) {
    p.backOff -= dt;
    p.reverseTime = Math.max(p.reverseTime ?? 0, dt);
  }
  if (p.reverseTime > 0) {
    p.reverseTime = absErr < 25 * DEG && !(p.backOff > 0) ? 0 : p.reverseTime - dt;
    want = -(P.crawl + 1);
    p.state = 'reversing';
  }

  if (p.speed < want) p.speed = Math.min(want, p.speed + P.accel * dt);
  else p.speed = Math.max(want, p.speed - P.brake * dt);
  const v = Math.max(Math.abs(p.speed), P.crawl);
  const maxYaw = Math.min(P.grip / v, v / P.turnRadius);
  p.heading += clamp(err, -maxYaw * dt, maxYaw * dt);

  // Move, then the same contact response as the player's car against the same solids.
  const ox = p.x;
  const oy = p.y;
  const body = { x: p.x + Math.cos(p.heading) * p.speed * dt, y: p.y + Math.sin(p.heading) * p.speed * dt,
    vx: Math.cos(p.heading) * p.speed, vy: Math.sin(p.heading) * p.speed, yawRate: 0 };
  const hit = resolveObstacles(body, env.colliders, ox, oy);
  if (hit) {
    if (hit.impact > 2 && p.contactAge > 0.5) p.wallHits += 1;
    p.contactAge = 0;
    p.contactNormal = [hit.nx, hit.ny];
    const forward = body.vx * Math.cos(p.heading) + body.vy * Math.sin(p.heading);
    const kept = Math.hypot(body.vx, body.vy);
    if (p.speed < 0 && forward >= -0.1) {
      // Backed into something: stop backing.
      p.reverseTime = 0;
      p.backOff = 0;
      p.reverseBlock = 1.5;
      p.speed = forward;
    } else if (kept > 0.5 && Math.abs(forward) > 0.3 * kept) {
      // Scraping along it: the wall turns the car to run along it, keeping the speed it slid with
      // (as the player's car keeps the speed along a wall), less the scrub obstacles.js took.
      const dir = Math.atan2(body.vy, body.vx) + (forward < 0 ? Math.PI : 0);
      p.heading += clamp(angleTo(p.heading, dir), -0.5, 0.5);
      p.speed = Math.sign(forward) * kept;
    } else p.speed = forward;   // square on: it stops (and bounces a little)
  }
  const b = env.bounds;
  body.x = clamp(body.x, b.minX + 2, b.maxX - 2);
  body.y = clamp(body.y, b.minY + 2, b.maxY - 2);
  p.distance += Math.hypot(body.x - ox, body.y - oy);
  p.x = body.x;
  p.y = body.y;

  if (Math.abs(p.speed) < 1 && gap > 12) {
    p.stalledTime = (p.stalledTime ?? 0) + dt;
    p.stuckTime += dt;
    p.longestStuck = Math.max(p.longestStuck, p.stuckTime);
    if (p.stuckTime > 1) { if (p.state !== 'recovering' && p.lastState !== 'recovering') p.recoveries += 1; p.state = 'recovering'; }
  } else p.stuckTime = 0;
  p.lastState = p.state;
  p.targetX = tx;
  p.targetY = ty;
  return gap;
}

// --- Breakables -------------------------------------------------------------------------------------
// Two flimsy kinds. A smash breaks the thing once, for the rest of the run, and takes a share of
// the speed of whatever hit it (the player's car or the police car).
export const BREAKABLE = Object.freeze({
  fruit: Object.freeze({ keep: 0.8, name: 'fruit stand', pieces: 22 }),
  barricade: Object.freeze({ keep: 0.62, name: 'barricade', pieces: 9 }),
});

// --- Showmanship (R4C) ---------------------------------------------------------------------------------
// The one place the destruction bonus is set. EXPERIMENTAL candidate values, to be calibrated after
// the owner's playtest (R4C report, section C):
//   - the player's car smashing a designated breakable earns its kind's bonus, once per object per
//     attempt (each object has a stable index and is broken once; a broken one pays nothing again;
//     one the police car broke pays nothing);
//   - the bonus is its own sum, never multiplied by a drift combo, and kept apart from the banked
//     drift score;
//   - it counts only on an escape: Showmanship = banked drift + destruction bonus. A bust, a
//     cancelled upload or running out of time scores nothing, and a retry starts from zero;
//   - a smash never ends a live drift combo: its speed loss is not an impact to the scoring. A solid
//     thing hit in the same step still is (that impact comes from obstacles.js, which never holds a
//     breakable), so nothing else is exempt.
// Safeguard against a destruction-only medal: every layout's whole destruction bonus stays below its
// lowest Silver target (Downtown 550 against 600, Industrial 400 against 500: unit test), so
// smashing everything with no drifting is Bronze at most. No hidden drift requirement.
export const SHOWMANSHIP = Object.freeze({
  bonus: Object.freeze({ fruit: 150, barricade: 250 }),
});

// Did a circle of radius r moving from (ax, ay) to (bx, by) touch the box?
const sweptTouches = (ax, ay, bx, by, box, r) => segmentHitsBox(ax, ay, bx, by, box, r);

// --- Medals ----------------------------------------------------------------------------------------
// R4's provisional numbers, carried over unchanged as starting references (R4B brief, section 11):
// Downtown takes R4's Route targets and Industrial its Open targets. NOT calibrated for these
// layouts: the R4B report measures the new distributions and the owner's playtest decides.
const TARGETS = Object.freeze({
  downtown: Object.freeze({
    classic: Object.freeze({ gold: 1600, silver: 600, bronze: 0 }),
    revised: Object.freeze({ gold: 2600, silver: 900, bronze: 0 }),
  }),
  industrial: Object.freeze({
    classic: Object.freeze({ gold: 1300, silver: 500, bronze: 0 }),
    revised: Object.freeze({ gold: 2300, silver: 700, bronze: 0 }),
  }),
});

// --- The challenge -----------------------------------------------------------------------------------
function note(run, event) {
  run.event = event;
  run.eventSerial += 1;
}

const cities = new Map();
export function cityFor(variant) {
  if (!cities.has(variant)) cities.set(variant, buildCity(CITY_LAYOUTS[variant]));
  return cities.get(variant);
}

// `variant` 'downtown' or 'industrial'; `pursuit` a PURSUIT_MODES entry; `missPolicy` 'recover'
// (a skipped camera stays the next one) or 'strict' (crossing a later camera first fails the run);
// `capture` a getaway.js CAPTURE_MODELS key; `tier` a URBAN_TIERS key; `pursuer` overrides single
// numbers (the research harness's jitter); `timeLimit` seconds.
// `showmanship` true (R4C, the default): smashes keep the combo and earn the destruction bonus;
// false: R4B's rules exactly (a smash is an impact to the scoring, and scores nothing), kept for the
// research comparison.
export function createUrbanChallenge({ variant = 'downtown', pursuit = 'network', missPolicy = 'recover', capture = 'proximity', tier = 'standard', pursuer = {}, timeLimit = 120, sightRule = true, showmanship = true } = {}) {
  const city = cityFor(variant);
  const C = CAPTURE_MODELS[capture];
  const P = Object.freeze({ ...URBAN_PURSUER, ...URBAN_TIERS[tier], ...pursuer });
  const { cameras, exit, start, bounds } = city;
  const track = Object.freeze({ ...padTrack(), id: `gymkhana-getaway-${variant}`, name: `Getaway Drift (${city.name})`,
    start, bounds, markers: Object.freeze([]), gymkhana: true, colliders: city.colliders });
  const rules = `getaway-${showmanship ? 'r4c' : 'r4b'}-${variant}-${pursuit}-${tier}-${C.id}-${missPolicy}-${timeLimit}`;
  const r = TUNING.carRadius;

  function createRun() {
    return {
      phase: 'running', time: 0, stage: 'Camera 1', reason: '', result: null,
      event: null, eventSerial: 0, cones: [], conesHit: 0,
      // Where the car is on the streets, and which metres of them it has scored on.
      edge: -1, t: 0, progressRate: 0, offCourse: false,
      cover: city.edges.map((e) => new Uint8Array(Math.ceil(e.len) + 2)),
      ground: 0, streetsUsed: new Set(),
      cameras: cameras.map(() => null), nextCamera: 0, missed: cameras.map(() => false), missedShots: 0,
      outOfOrder: 0, wrongWay: 0, lockedTries: 0, exitOpen: false, rollingFor: -1, lastCross: null,
      broken: city.breakables.map(() => null), smashes: 0,
      // Showmanship (R4C): the destruction bonus so far (provisional until an escape), and one entry
      // per object the player's car broke, in order (the HUD's sound and pop-ups read it).
      smashBonus: 0, smashLog: [],
      pursuer: createUrbanPursuer(start, P),
      trail: [{ x: start.x, y: start.y }],
      meter: 0, peakMeter: 0, minGap: Infinity, nearTime: 0, gap: P.startGap, sees: false, within25: 0, within15: 0, closeCalls: 0, wasClose: false,
      level: 'clear', wallHits: 0, lastImpactAt: -Infinity,
      guide: null, guideIn: 0, shortcut: null, objectiveAt: 0,
    };
  }

  function result(run, scoring, ended) {
    const escaped = ended === 'escaped';
    const p = run.pursuer;
    // `score` is the banked drift, as in R4B; `smashBonus` the destruction bonus earned on the way;
    // `showmanship` their sum. Only an escape has a value: the medal is judged on it.
    const total = scoring.score + (showmanship ? run.smashBonus : 0);
    return {
      value: escaped ? total : null,
      showmanship: total, smashBonus: showmanship ? run.smashBonus : 0,
      smashLog: run.smashLog.map((s) => ({ ...s })),
      score: scoring.score, bestCombo: scoring.bestCombo, bestMultiplier: scoring.bestMultiplier, spinouts: scoring.spinouts,
      footage: run.cameras.filter(Boolean).length, cameras: cameras.length,
      shotsDrifted: run.cameras.filter((c) => c?.drifting).length,
      missedShots: run.missedShots, outOfOrder: run.outOfOrder, wrongWay: run.wrongWay, lockedTries: run.lockedTries,
      time: run.time, distance: run.ground, ended,
      minGap: Number.isFinite(run.minGap) ? run.minGap : null, finalGap: run.gap,
      peakMeter: run.peakMeter, nearTime: run.nearTime, within25: run.within25, within15: run.within15, closeCalls: run.closeCalls,
      smashes: run.smashes, smashed: run.broken.map((b) => b?.by ?? null), wallHits: run.wallHits,
      streets: [...run.streetsUsed].sort((a, b) => a - b),
      overshoots: p.overshoots, overshotTime: p.overshotTime, recoveries: p.recoveries, reverses: p.reverses,
      longestStuck: p.longestStuck, stalledTime: p.stalledTime ?? 0, intercepts: p.intercepts, unsticks: p.unsticks, policeWallHits: p.wallHits, policeSmashes: p.smashes,
    };
  }

  function end(run, phase, reason, res) {
    run.phase = phase;
    run.reason = reason;
    run.result = res;
    run.stage = phase === 'complete' ? 'Escaped' : 'Failed';
  }

  function fail(run, scoring, reason, ended) {
    if (scoring.combo) loseCombo(scoring, ended === 'busted' ? 'busted' : reason);
    end(run, 'failed', reason, result(run, scoring, ended));
  }

  // Smash a breakable: the hitter loses its share of speed; the thing is broken for the run. Only
  // the player's car earns its bonus, and only here, the one moment it goes from intact to broken.
  function smash(run, scoring, i, by, x, y, vx, vy, speed) {
    const br = city.breakables[i];
    if (run.broken[i]) return;
    const bonus = by === 'car' && showmanship ? SHOWMANSHIP.bonus[br.kind] : 0;
    run.broken[i] = { by, time: run.time, x, y, vx, vy, speed, bonus };
    if (by === 'car') {
      run.smashes += 1;
      run.smashBonus += bonus;
      run.smashLog.push({ index: i, kind: br.kind, bonus, time: run.time, x: br.cx, y: br.cy });
    }
    note(run, { type: 'smash', kind: br.kind, by, bonus, total: run.smashBonus, combo: !!scoring.combo });
  }

  function step(run, game, ax, ay, impact) {
    if (run.phase !== 'running') return;
    const T = TUNING;
    const dt = T.simStep;
    const { car, scoring } = game;
    run.time += dt;

    // Smashes by the car: through, slower. Only the R4B comparison scores this as an impact.
    let smashImpact = 0;
    for (const br of city.breakables) {
      if (run.broken[br.index]) continue;
      if (!sweptTouches(ax, ay, car.x, car.y, br, r)) continue;
      const before = car.speed;
      const keep = BREAKABLE[br.kind].keep;
      smash(run, scoring, br.index, 'car', car.x, car.y, car.vx, car.vy, before);
      car.vx *= keep;
      car.vy *= keep;
      updateDerived(car);
      smashImpact = Math.max(smashImpact, before * (1 - keep));
    }
    if (impact > 2 && run.time - run.lastImpactAt > 0.5) run.wallHits += 1;
    if (impact > 2) run.lastImpactAt = run.time;

    // Where the car is on the streets, and the new metres it has covered (each pays once).
    const at = locate(city, car.x, car.y, run.edge);
    const cover = run.cover[at.edge];
    let moved = 0;
    let newGround = 0;
    const mark = (lo, hi) => {
      for (let i = Math.max(0, Math.floor(lo)); i <= Math.min(cover.length - 1, Math.floor(hi)); i += 1) {
        if (!cover[i]) { cover[i] = 1; newGround += 1; }
      }
    };
    if (at.edge === run.edge) {
      const ds = at.t - run.t;
      moved = Math.abs(ds) <= car.speed * dt * 2 + 0.5 ? ds : 0;
      mark(Math.min(run.t, at.t), Math.max(run.t, at.t));
    } else mark(at.t, at.t);
    run.edge = at.edge;
    run.t = at.t;
    run.ground += newGround;
    run.streetsUsed.add(at.edge);
    run.progressRate += (Math.abs(moved) / dt - run.progressRate) * Math.min(1, T.progressRateSmoothing * dt);
    run.offCourse = false;   // all pavement is the course; everything else is a wall
    updateScoring(scoring, {
      speed: car.speed, forwardSpeed: car.forwardSpeed, slipAngle: car.slipAngle,
      surface: 'road', offCourse: false, progressRate: run.progressRate, newGround,
      // R4C: a smash's lost speed is not an impact (the combo survives it); `impact` is the solid
      // things only. R4B's rule, for the comparison, counted it as one.
      handbrake: car.handbrake, impact: showmanship ? impact : Math.max(impact, smashImpact),
    }, dt, T);

    // The trail (mode A follows it; the others keep it for the debug view).
    const lastCrumb = run.trail[run.trail.length - 1];
    if (Math.hypot(car.x - lastCrumb.x, car.y - lastCrumb.y) >= P.crumbSpacing) run.trail.push({ x: car.x, y: car.y });

    // The police car.
    const p = run.pursuer;
    let gap;
    if (run.time < P.delay) {
      p.prevX = p.x; p.prevY = p.y; p.prevHeading = p.heading;
      gap = Math.hypot(car.x - p.x, car.y - p.y);
      p.known = { x: car.x, y: car.y, vx: car.vx, vy: car.vy };
      p.knownAt = run.time;
    } else {
      gap = stepUrbanPursuer(p, car, { city, colliders: city.colliders, trail: run.trail, mode: pursuit, broken: run.broken, time: run.time, bounds }, dt, P);
      // Smashes by the police car.
      for (const br of city.breakables) {
        if (run.broken[br.index] || !sweptTouches(p.prevX, p.prevY, p.x, p.y, br, r)) continue;
        smash(run, scoring, br.index, 'police', p.x, p.y, Math.cos(p.heading) * p.speed, Math.sin(p.heading) * p.speed, Math.abs(p.speed));
        p.speed *= BREAKABLE[br.kind].keep;
        p.smashes += 1;
      }
    }
    run.gap = gap;
    run.minGap = Math.min(run.minGap, gap);
    // The bust meter: R4's rule (within the radius, any speed), but never through a building.
    run.sees = !sightRule || gap >= C.radius || lineOfSight(city, p.x, p.y, car.x, car.y);
    const effective = run.sees ? gap : Infinity;
    const relSpeed = Math.hypot(car.vx - Math.cos(p.heading) * p.speed, car.vy - Math.sin(p.heading) * p.speed);
    if (run.time >= P.delay) {
      if (gap < 25) run.within25 += dt;
      if (gap < 15) run.within15 += dt;
      // A close call: the meter rose past a quarter and the car got away again.
      if (run.meter >= 0.25) run.wasClose = true;
      else if (run.wasClose && run.meter === 0) { run.wasClose = false; run.closeCalls += 1; }
      if (effective < C.radius) run.nearTime += dt;
      run.meter = clamp(run.meter + captureRate(C, effective, relSpeed) * dt, 0, 1);
      run.peakMeter = Math.max(run.peakMeter, run.meter);
    }
    run.level = run.meter >= 0.6 ? 'critical' : run.meter > 0 || (gap < 25 && run.time >= P.delay) ? 'close' : 'clear';
    if (run.meter >= 1) { run.level = 'busted'; note(run, { type: 'busted' }); fail(run, scoring, 'busted', 'busted'); return; }

    // Cameras: the next one films a forward crossing of its band. A later one crossed first is
    // out of order: no shot, and under the strict policy the run fails.
    const n = run.nextCamera;
    for (let k = 0; k < cameras.length; k += 1) {
      const cam = cameras[k];
      const crossing = gateCrossing(cam, ax, ay, car.x, car.y);
      if (!crossing) continue;
      // A position exactly on the line is counted by the steps either side of it: once is enough.
      const last = run.lastCross;
      run.lastCross = { k, crossing, time: run.time };
      if (last && last.k === k && last.crossing === crossing && run.time - last.time < 0.05) continue;
      if (k === n && crossing === 1) {
        run.cameras[k] = { time: run.time, drifting: scoring.drifting, speed: car.speed };
        run.nextCamera += 1;
        run.exitOpen = run.nextCamera === cameras.length;
        note(run, { type: 'shot', camera: cam.number, drifting: scoring.drifting, all: run.exitOpen });
        run.stage = run.exitOpen ? 'The escape gate' : `Camera ${cameras[run.nextCamera].number}`;
        run.guideIn = 0;
        run.objectiveAt = run.time;
        break;
      }
      if (k === n && crossing === -1) { run.wrongWay += 1; note(run, { type: 'wrongway', camera: cam.number }); break; }
      if (k > n && crossing === 1) {
        run.outOfOrder += 1;
        if (!run.missed[n]) { run.missed[n] = true; run.missedShots += 1; }
        if (missPolicy === 'strict') {
          note(run, { type: 'cancelled', camera: cameras[n].number });
          fail(run, scoring, `missed camera ${cameras[n].number}`, 'missed');
          return;
        }
        note(run, { type: 'missed', camera: cameras[n].number, crossed: cam.number });
        run.stage = `Back for camera ${cameras[n].number}`;
        run.guideIn = 0;
        run.objectiveAt = run.time;
        break;
      }
    }
    if (n < cameras.length && run.nextCamera === n) {
      const cam = cameras[n];
      const d = Math.hypot(car.x - cam.cx, car.y - cam.cy);
      const before = (car.x - cam.cx) * cam.tx + (car.y - cam.cy) * cam.ty < 0;
      if (run.rollingFor !== n && d < 45 && before) { run.rollingFor = n; note(run, { type: 'rolling', camera: cam.number }); }
    }

    // The escape gate: open only once every camera has its shot.
    if (gateCrossing(exit, ax, ay, car.x, car.y) === 1) {
      if (run.exitOpen) {
        bankCombo(scoring, 'escaped');
        note(run, { type: 'escaped' });
        end(run, 'complete', '', result(run, scoring, 'escaped'));
        return;
      }
      // Counted once per pass, as the cameras are.
      if (!(run.time - (run.lastLocked ?? -1) < 0.05)) {
        run.lockedTries += 1;
        note(run, { type: 'locked', footage: run.nextCamera, cameras: cameras.length });
      }
      run.lastLocked = run.time;
    }

    // The way to the next objective, for the HUD's arrow, its turn call and the minimap
    // (getaway-nav.js; the scripted drivers plan their own). A barricade the player could smash
    // through is offered as a shortcut on the minimap, never made the route.
    run.guideIn -= dt;
    if (run.guideIn <= 0) {
      run.guideIn = NAV.refresh;
      const gate = run.exitOpen ? exit : cameras[run.nextCamera];
      const next = run.exitOpen ? null : run.nextCamera + 1 < cameras.length ? cameras[run.nextCamera + 1] : exit;
      run.guide = planGuide(city, at, gate, { broken: run.broken, car, previous: run.guide, next });
      run.shortcut = shortcutFor(city, at, gate, run.guide, { broken: run.broken });
    }

    if (run.time >= timeLimit) fail(run, scoring, 'out of time', 'out of time');
  }

  const name = `Getaway Drift (${city.name})`;
  return Object.freeze({
    id: `getaway-urban-${variant}`,
    name,
    shortName: `Getaway · ${city.name}`,
    experimental: true,
    kind: 'score',
    rules,
    layout: 'urban',
    variant,
    pursuit,
    missPolicy,
    tier,
    timeLimit,
    captureModel: C,
    pursuerTuning: P,
    medalTargets: TARGETS[variant],
    showmanship,
    smashBonus: showmanship ? SHOWMANSHIP.bonus : null,
    tagline: 'NO FOOTAGE, NO GLORY.',
    brief: variant === 'industrial'
      ? 'The internet needs proof. Wide streets, a container yard and a police roadblock. Film all four cameras in order, then lose the cop through the escape gate by the start.'
      : 'The internet needs proof. Tight downtown blocks, hard corners and one cop who knows the streets. Film all four cameras in order, then get out through the escape gate.',
    points: Object.freeze([
      showmanship ? 'Film every camera in order, in its marked direction, then escape. Showmanship = banked drift + destruction bonus.'
        : 'Drive through each camera\'s band in order, the way it faces. Drifting is optional, but banked drift points decide the medal.',
      'BUST RISK fills while the police car is close and can see you. Pull away or break the line of sight to drain it.',
      missPolicy === 'strict' ? 'Skip a camera and the upload is cancelled: the run fails.'
        : 'Skip a camera and the escape gate stays shut until you go back for it. Follow the arrow.',
      showmanship
        ? `Smash fruit stands (+${SHOWMANSHIP.bonus.fruit}) and wooden barricades (+${SHOWMANSHIP.bonus.barricade}) for Showmanship. They cost speed, never your combo, and count only if you escape. Buildings, concrete and parked police cars are solid.`
        : 'Buildings, concrete and parked police cars are solid. Fruit stands and wooden barricades are not, but they cost you speed.',
    ]),
    track,
    geometry: Object.freeze({ city, cameras, exit, start, bounds }),
    focus: Object.freeze({ x: start.x + Math.cos(start.heading) * 60, y: start.y + Math.sin(start.heading) * 60 }),
    createRun,
    step,
  });
}

export function urbanTargets(def, handlingId) {
  return def?.medalTargets?.[handlingId] ?? null;
}
