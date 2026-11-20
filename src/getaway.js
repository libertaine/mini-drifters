// Getaway Drift: No footage, no glory. EXPERIMENTAL (v0.7.0 R4 research), not a shipped challenge.
//
// You are escaping one police car, and you set up cameras round the course to film it. Take
// every camera's shot in order, then cross the escape gate before the bust meter fills.
// Escaping is the completion; the drift score you bank on the way decides the medal.
//
// It is a gymkhana challenge object (gymkhana.js's interface), so game.js runs it unchanged:
//   - the car, the handling modes and the drift scoring are the game's own, read and never
//     changed. The scoring is fed exactly as Linked Drift feeds it: progress along the course
//     line in place of a circuit, so each metre pays once and circling pays nothing;
//   - the police car is plain run data (run.pursuer). It never touches the player's car:
//     capture is judged by the bust meter, not by contact;
//   - nothing here reads or writes storage. It is not in GYMKHANA_CHALLENGES, so the gymkhana
//     records never see it, and its medals are its own table below, not medals.js's.
import { TUNING } from './tuning.js';
import { gateCrossing } from './track.js';
import { padTrack } from './practice-pad.js';
import { projectOnCourse } from './gymkhana.js';
import { updateScoring, bankCombo, loseCombo } from './scoring.js';

const DEG = Math.PI / 180;
const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// --- Course -----------------------------------------------------------------------------------
// The same construction as gymkhana.js's Linked Drift course: one point per metre, so a point's
// index is its distance along the course. Positive turns are to the right on screen.
const COURSE_STEP = 1;
export function buildCourse(segments) {
  const points = [];
  let x = 0;
  let y = 0;
  let heading = 0;
  let s = 0;
  let nextS = 0;
  const fine = 0.05;
  for (const seg of segments) {
    const length = seg.straight ?? Math.abs(seg.turn * DEG) * seg.radius;
    const bend = seg.straight ? 0 : Math.sign(seg.turn) / seg.radius;
    for (let d = 0; d < length - 1e-9; d += fine) {
      if (s >= nextS - 1e-9) {
        points.push({ x, y, tx: Math.cos(heading), ty: Math.sin(heading), s: nextS, bend });
        nextS += COURSE_STEP;
      }
      heading += bend * fine;
      x += Math.cos(heading) * fine;
      y += Math.sin(heading) * fine;
      s += fine;
    }
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const ox = (Math.min(...xs) + Math.max(...xs)) / 2;
  const oy = (Math.min(...ys) + Math.max(...ys)) / 2;
  for (const p of points) { p.x -= ox; p.y -= oy; Object.freeze(p); }
  return Object.freeze({
    points: Object.freeze(points),
    length: points.length - 1,
    extent: Object.freeze({ minX: Math.min(...xs) - ox, maxX: Math.max(...xs) - ox, minY: Math.min(...ys) - oy, maxY: Math.max(...ys) - oy }),
  });
}

function makeGate(cx, cy, heading, half) {
  const tx = Math.cos(heading);
  const ty = Math.sin(heading);
  return Object.freeze({ cx, cy, tx, ty, half, x1: cx - ty * half, y1: cy + tx * half, x2: cx + ty * half, y2: cy - tx * half });
}

// Two layouts, the only two this research builds (R4 brief, section 5).
//   route  Variant B, a structured pursuit route: a painted road, the cameras along it in
//          order, the escape gate at the far end.
//   open   Variant A, an open escape: a loop that comes back past the start, so the escape
//          gate is in reach from the grid, but it only counts once every camera has its shot.
//          The suggested line is painted faintly and the scoring corridor is wider.
// Camera positions are distances along the course (metres). Each camera films a band of road
// across the whole corridor: driving through it on the road is enough, drifting is optional.
export const GETAWAY_LAYOUTS = Object.freeze({
  route: Object.freeze({
    id: 'route',
    name: 'Route',
    segments: Object.freeze([
      { straight: 70 },                 // the grid, with the police car parked behind
      { turn: 90, radius: 45 },         // a fast right
      { straight: 40 },
      { turn: -110, radius: 30 },       // left, camera 1 at its apex
      { straight: 60 },
      { turn: 160, radius: 22 },        // the tight right hairpin, where a pursuer runs wide
      { straight: 85 },                 // the long straight: separation for whoever is quicker
      { turn: -70, radius: 55 },        // a fast left sweep, camera 2
      { turn: 90, radius: 32 },         // straight into a right: a change of direction
      { straight: 45 },
      { turn: -150, radius: 28 },       // the long left, camera 3
      { straight: 55 },
      { turn: 80, radius: 38 },         // an S: right...
      { turn: -80, radius: 38 },        // ...then left, camera 4 where it changes direction
      { straight: 95 },                 // the run to the escape gate, then run-off
    ]),
    corridor: 10,
    cameraHalf: 14,                     // the filmed band reaches 4 m past each road edge
    exitHalf: 14,
    runoff: 35,
    painted: 'road',
  }),
  open: Object.freeze({
    id: 'open',
    name: 'Open',
    segments: Object.freeze([
      { straight: 55 },
      { turn: 90, radius: 40 },         // right
      { straight: 55 },
      { turn: 70, radius: 28 },         // an S...
      { turn: -70, radius: 28 },        // ...camera 1 where it changes direction
      { straight: 50 },
      { turn: 130, radius: 24 },        // the tight right, camera 2 on its exit
      { straight: 85 },
      { turn: -45, radius: 50 },        // a kink left
      { turn: 125, radius: 32 },        // the long right, camera 3
      { straight: 70 },
      { turn: 30, radius: 45 },         // a gentle right, camera 4
      { turn: -60, radius: 30 },        // and left, up past the grid...
      { straight: 60 },                 // ...to the escape gate, 60 m from where you started
    ]),
    corridor: 16,
    cameraHalf: 18,
    exitHalf: 16,
    runoff: 20,
    painted: 'line',
  }),
});

// Where each layout's cameras sit: [segment index, fraction of that segment].
const CAMERA_SPOTS = Object.freeze({
  route: [[3, 0.5], [7, 0.55], [10, 0.5], [13, 0.0]],
  open: [[4, 0.0], [6, 0.85], [9, 0.55], [11, 0.6]],
});
const segLength = (seg) => seg.straight ?? Math.abs(seg.turn * DEG) * seg.radius;

// --- The police car -----------------------------------------------------------------------------
// One pursuer, driven by its own simple car model: a top speed, an acceleration, a braking
// limit and a cornering grip that caps its yaw rate (yaw <= grip / speed), with a smallest
// turning circle at low speed. It can run wide, overshoot and have to come round again. It
// never moves sideways, never teleports and never knows the player's next input: it sees
// where the car is and how fast it is going now, and the trail the car has left.
//
// Navigation, cheapest first:
//   following  further than `interceptRange`: drives the player's own trail (a point every
//              2 m), looking ahead along it, slowing for the bends the trail shows ahead.
//   closing    within `interceptRange`: aims at where the player will be in a fraction of a
//              second if it carries on as it is (position + velocity x lead), and matches the
//              player's speed rather than ramming past a car that has stopped.
//   overshot   it has gone past the player and is pointing away: brakes and comes round on
//              its smallest circle, which takes a few seconds and is the player's chance.
//   recovering stopped against the pad's wall or creeping: pivots at a crawl until it points
//              somewhere useful. Counted, so a stuck pursuer shows up in the research.
//
// Numbers from the R4 tuning sweeps (artifacts/results/r4-pursuer-sweep*.json): cornering grip
// decides almost everything, top speed very little. So the police car is quicker than the car
// on a straight and weaker in a bend: it closes on the straights, and the player makes the gap
// in the corners. 'standard' is the default; 'firm' is the stronger tier also measured.
export const PURSUER = Object.freeze({
  vMax: 35,              // m/s; the car's top speed is 42
  accel: 7,              // m/s^2, flat to vMax
  brake: 13,
  grip: 7.2,             // cornering acceleration, m/s^2 (the car's tyres peak at about 15)
  gripPlan: 8.1,         // what it brakes for: a little optimistic, so it sometimes runs wide
  turnRadius: 6.5,       // smallest turning circle (radius), metres
  crawl: 3,              // m/s: its speed while turning round
  startGap: 25,          // parked this far behind the grid
  delay: 1.0,            // seconds after the player first moves before it sets off
  interceptRange: 26,
  lead: 0.45,            // seconds of lead at most when aiming at the player
  holdGap: 3.5,          // the bumper distance it closes to when matching speed
  closeRate: 1.4,        // closing speed per metre of gap beyond holdGap
  crumbSpacing: 2,
});
export const PURSUER_TIERS = Object.freeze({
  standard: Object.freeze({}),
  firm: Object.freeze({ vMax: 36, accel: 8, grip: 7.8, gripPlan: 8.8 }),
});

// Two capture models (R4 brief, section 6), both non-contact.
//   proximity  R0's B1: the meter fills in `fillTime` while the police car is within `radius`,
//              and drains at `drain` per second outside it. Speed does not matter, so a fast
//              car with the police on its bumper is not immune.
//   pressure   the same meter, but it fills up to twice as fast the closer the police car is,
//              and half as fast while the two are passing at very different speeds (a police
//              car flying past after an overshoot is not an arrest). It never stops filling.
export const CAPTURE_MODELS = Object.freeze({
  proximity: Object.freeze({ id: 'proximity', radius: 9, fillTime: 2.0, drain: 0.35 }),
  pressure: Object.freeze({ id: 'pressure', radius: 10, fillTime: 2.6, inner: 4, drain: 0.35, passing: 12, passingFactor: 0.5 }),
});

export function captureRate(model, gap, relSpeed) {
  if (gap >= model.radius) return -model.drain;
  const base = 1 / model.fillTime;
  if (model.id !== 'pressure') return base;
  const closeness = clamp((model.radius - gap) / (model.radius - model.inner), 0, 1);
  return base * (1 + closeness) * (relSpeed > model.passing ? model.passingFactor : 1);
}

export function createPursuer(start, P = PURSUER) {
  const x = start.x - Math.cos(start.heading) * P.startGap;
  const y = start.y - Math.sin(start.heading) * P.startGap;
  return {
    x, y, heading: start.heading, speed: 0, prevX: x, prevY: y, prevHeading: start.heading,
    state: 'parked', crumb: 0, targetX: x, targetY: y,
    overshoots: 0, overshotTime: 0, recoveries: 0, reverses: 0, reverseTime: 0, stuckTime: 0, longestStuck: 0, distance: 0,
  };
}

// The look-ahead: the trail point `look` metres on from the pursuer's place on the trail.
function trailTarget(p, trail, look) {
  // Re-find its place: the nearest point from where it was, a window ahead.
  const end = trail.length - 1;
  let best = p.crumb;
  let bestD = Infinity;
  for (let i = Math.max(0, p.crumb - 5); i <= Math.min(end, p.crumb + 80); i += 1) {
    const d = (trail[i].x - p.x) ** 2 + (trail[i].y - p.y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  p.crumb = best;
  const steps = Math.max(1, Math.round(look / PURSUER.crumbSpacing));
  return trail[Math.min(end, best + steps)];
}

// The fastest it may go now, for the bends the trail shows ahead (a driver reading the road).
function trailSpeed(p, trail, P) {
  let limit = P.vMax;
  const end = trail.length - 1;
  const horizon = Math.max(30, (p.speed * p.speed) / (2 * P.brake) + 20);
  const n = Math.min(end - p.crumb, Math.ceil(horizon / P.crumbSpacing));
  for (let k = 2; k < n - 2; k += 1) {
    const a = trail[p.crumb + k - 2];
    const b = trail[p.crumb + k];
    const c = trail[p.crumb + k + 2];
    const h1 = Math.atan2(b.y - a.y, b.x - a.x);
    const h2 = Math.atan2(c.y - b.y, c.x - b.x);
    const turn = Math.abs(angleTo(h1, h2));
    if (turn < 1e-3) continue;
    const radius = Math.hypot(c.x - a.x, c.y - a.y) / 2 / turn;
    const corner = Math.sqrt(P.gripPlan * radius);
    limit = Math.min(limit, Math.sqrt(corner * corner + 2 * P.brake * k * P.crumbSpacing));
  }
  return limit;
}

// One step of the police car. `car` is read, never written.
export function stepPursuer(p, car, trail, dt, P, bounds) {
  p.prevX = p.x;
  p.prevY = p.y;
  p.prevHeading = p.heading;
  const dx = car.x - p.x;
  const dy = car.y - p.y;
  const gap = Math.hypot(dx, dy);
  const toCar = Math.atan2(dy, dx);
  const facing = Math.cos(angleTo(p.heading, toCar));   // 1: the car is dead ahead; -1: behind

  // Never faster than it could still stop at its bumper gap if the car stopped dead now, with
  // some braking in hand: a stopped car is boxed in, not driven past. Only a car that brakes
  // harder than this, or turns away sharply, makes it overshoot.
  const room = Math.max(0, gap - P.holdGap);
  const stopCap = Math.sqrt(car.speed * car.speed + 2 * P.brake * 0.7 * room);
  let tx;
  let ty;
  let want;
  if (gap < P.interceptRange) {
    // Where the car will be if it carries on as it is: its velocity now, nothing more.
    const lead = Math.min(P.lead, gap / 30);
    tx = car.x + car.vx * lead;
    ty = car.y + car.vy * lead;
    want = Math.min(P.vMax, car.speed + P.closeRate * room, stopCap);
    p.state = 'closing';
  } else {
    // At least the turning circle's diameter ahead, so the point it steers for can never sit
    // inside that circle (where it could only be orbited).
    const target = trailTarget(p, trail, Math.max(2 * P.turnRadius + 1, 6 + p.speed * 0.4));
    tx = target.x;
    ty = target.y;
    want = Math.min(trailSpeed(p, trail, P), stopCap);
    p.state = 'following';
  }
  const err = angleTo(p.heading, Math.atan2(ty - p.y, tx - p.x));
  const absErr = Math.abs(err);
  // Pointing well away from where it wants to go: slow for the turn, as a driver would, and
  // creep round at a crawl if it is a long way round.
  if (absErr > 20 * DEG) want = Math.min(want, Math.max(P.crawl + 3, P.vMax * Math.cos(Math.min(absErr, 80 * DEG))));
  if (absErr > 80 * DEG) want = Math.max(Math.min(want, P.crawl + 3), P.crawl);
  // Overshot: it was closing on the car and has gone past it (following the trail round a
  // hairpin, with the car across the bend, is not an overshoot).
  if (gap < P.interceptRange && facing < -0.2 && p.speed > 2) {
    if (p.lastState !== 'overshot') p.overshoots += 1;
    p.state = 'overshot';
    p.overshotTime += dt;
  }
  // The target inside its own turning circle can never be reached by turning forwards (it would
  // orbit it): back up for a moment, the nose swinging toward the target, then go again. A
  // three-point turn, simplified.
  const side = err >= 0 ? 1 : -1;
  const ccx = p.x + Math.cos(p.heading + side * Math.PI / 2) * P.turnRadius;
  const ccy = p.y + Math.sin(p.heading + side * Math.PI / 2) * P.turnRadius;
  const insideCircle = Math.hypot(tx - ccx, ty - ccy) < P.turnRadius * 0.95;
  p.reverseBlock = Math.max(0, (p.reverseBlock ?? 0) - dt);
  if (!(p.reverseTime > 0) && p.reverseBlock <= 0 && gap < P.interceptRange && insideCircle && absErr > 50 * DEG && p.speed < P.crawl + 3.5) {
    p.reverseTime = 1.4;
    p.reverses = (p.reverses ?? 0) + 1;
  }
  if (p.reverseTime > 0) {
    p.reverseTime = absErr < 25 * DEG ? 0 : p.reverseTime - dt;
    want = -(P.crawl + 1);
    p.state = 'reversing';
  }

  if (p.speed < want) p.speed = Math.min(want, p.speed + P.accel * dt);
  else p.speed = Math.max(want, p.speed - P.brake * dt);

  // Steering: grip limits the yaw rate at speed, the turning circle at low speed. Below a crawl
  // it pivots as if shuffling round. Backing up, the nose still swings toward the target.
  const v = Math.max(Math.abs(p.speed), P.crawl);
  const maxYaw = Math.min(P.grip / v, v / P.turnRadius);
  p.heading += clamp(err, -maxYaw * dt, maxYaw * dt);
  const nx = p.x + Math.cos(p.heading) * p.speed * dt;
  const ny = p.y + Math.sin(p.heading) * p.speed * dt;
  // The pad's wall: it slides along it as the car does, keeping the speed it had along the wall
  // and losing the part it had into it, and turns to run along it.
  const m = 2;
  const cx = clamp(nx, bounds.minX + m, bounds.maxX - m);
  const cy = clamp(ny, bounds.minY + m, bounds.maxY - m);
  if ((cx !== nx || cy !== ny) && p.speed < 0) {
    // Backed into the wall: stop backing up, and drive forwards for a while instead.
    p.speed = 0;
    p.reverseTime = 0;
    p.reverseBlock = 2;
  } else if (cx !== nx) {
    const along = Math.sin(p.heading);
    p.speed *= Math.max(0.25, Math.abs(along)) * 0.9;
    p.heading = along >= 0 ? Math.PI / 2 : -Math.PI / 2;
  } else if (cy !== ny) {
    const along = Math.cos(p.heading);
    p.speed *= Math.max(0.25, Math.abs(along)) * 0.9;
    p.heading = along >= 0 ? 0 : Math.PI;
  }
  p.distance += Math.hypot(cx - p.x, cy - p.y);
  p.x = cx;
  p.y = cy;

  // Stuck: barely moving while the car is not alongside. Measured, and named in the debug view.
  if (Math.abs(p.speed) < 1 && gap > 12) {
    p.stuckTime += dt;
    p.longestStuck = Math.max(p.longestStuck, p.stuckTime);
    if (p.stuckTime > 1) { if (p.state !== 'recovering' && p.lastState !== 'recovering') p.recoveries += 1; p.state = 'recovering'; }
  } else p.stuckTime = 0;
  p.lastState = p.state;
  p.targetX = tx;
  p.targetY = ty;
  return gap;
}

// --- Medals ------------------------------------------------------------------------------------
// Bronze is any escape, with no drift points at all. Silver and Gold are banked points on an
// escape, per layout and handling mode. PROVISIONAL research numbers (R4 report, section E),
// calibrated for the default rules only (standard pursuer, proximity capture); other research
// configurations show them for comparison. Never stored: worked out from a result, like medals.js.
// Silver sits between the pooled 25th and 50th percentile of the scripted drifting runs that
// escaped, and Gold near their 75th to 90th (artifacts/results/r4-medal-pools.json), the method R0
// used for the other challenges. Grip never reached Silver; light drifting rarely does.
const ROUTE_TARGETS = Object.freeze({
  classic: Object.freeze({ gold: 1600, silver: 600, bronze: 0 }),
  revised: Object.freeze({ gold: 2600, silver: 900, bronze: 0 }),
});
const OPEN_TARGETS = Object.freeze({
  classic: Object.freeze({ gold: 1300, silver: 500, bronze: 0 }),
  revised: Object.freeze({ gold: 2300, silver: 700, bronze: 0 }),
});
export const GETAWAY_MEDALS = Object.freeze(['gold', 'silver', 'bronze']);
export function getawayTargets(def, handlingId) {
  if (!def || def.layout !== 'getaway') return null;
  return (def.variant === 'open' ? OPEN_TARGETS : ROUTE_TARGETS)[handlingId] ?? null;
}
// `value` is an escaped run's banked score; null (busted, or no run) earns nothing.
export function getawayMedal(def, handlingId, value) {
  const targets = getawayTargets(def, handlingId);
  if (!targets || value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
  return GETAWAY_MEDALS.find((m) => Math.round(value) >= targets[m]) ?? null;
}

// --- The challenge ------------------------------------------------------------------------------
function note(run, event) {
  run.event = event;
  run.eventSerial += 1;
}

function end(run, phase, reason, result) {
  run.phase = phase;
  run.reason = reason;
  run.result = result;
  run.stage = phase === 'complete' ? 'Escaped' : 'Failed';
}

// `variant`  'route' (B) or 'open' (A); `capture` a CAPTURE_MODELS key; `missPolicy`:
//   'recover'  a missed camera stays the next one: go back for the shot, the exit stays shut;
//   'strict'   a missed camera fails the run on the spot.
// `tier` a PURSUER_TIERS key; `pursuer` overrides single numbers (the research harness's jitter).
export function createGetawayChallenge({ variant = 'route', capture = 'proximity', missPolicy = 'recover', tier = 'standard', pursuer = {}, timeLimit = 150 } = {}) {
  const L = GETAWAY_LAYOUTS[variant];
  const C = CAPTURE_MODELS[capture];
  const P = Object.freeze({ ...PURSUER, ...PURSUER_TIERS[tier], ...pursuer });
  const course = buildCourse(L.segments);
  const starts = L.segments.map((_, i) => L.segments.slice(0, i).reduce((a, seg) => a + segLength(seg), 0));
  const exitS = Math.round(course.length - L.runoff);
  const at = (s) => course.points[clamp(Math.round(s), 0, course.points.length - 1)];
  const gateAt = (s, half) => { const p = at(s); return Object.freeze({ ...makeGate(p.x, p.y, Math.atan2(p.ty, p.tx), half), s: p.s }); };
  const cameras = Object.freeze(CAMERA_SPOTS[variant].map(([seg, f], i) => {
    const s = Math.round(starts[seg] + segLength(L.segments[seg]) * f);
    const p = at(s);
    // The camera stands just off the outside of the road, on the driver's left or right
    // whichever is the outside of the bend there (left on a straight).
    const side = p.bend < 0 ? 1 : -1;   // +1: right of the road
    const off = L.corridor + 5;
    const x = p.x - p.ty * off * side;
    const y = p.y + p.tx * off * side;
    return Object.freeze({ number: i + 1, s, gate: gateAt(s, L.cameraHalf), x, y, side, aim: Math.atan2(p.y - y, p.x - x) });
  }));
  const exit = gateAt(exitS, L.exitHalf);
  const first = course.points[0];
  const start = { x: first.x, y: first.y, heading: Math.atan2(first.ty, first.tx) };
  const wall = 45;
  const { extent } = course;
  const bounds = { minX: extent.minX - wall, maxX: extent.maxX + wall, minY: extent.minY - wall, maxY: extent.maxY + wall };
  const track = Object.freeze({ ...padTrack(), id: `gymkhana-getaway-${variant}`, name: `Getaway Drift (${L.name})`,
    start: Object.freeze(start), bounds: Object.freeze(bounds), markers: Object.freeze([]), gymkhana: true });
  const missMargin = 14;
  const rules = `getaway-r4-${variant}-${tier}-${C.id}-${missPolicy}`;

  function createRun() {
    return {
      phase: 'running', time: 0, stage: 'Camera 1', reason: '', result: null,
      event: null, eventSerial: 0,
      cones: [], conesHit: 0,
      index: 0, s: 0, furthest: 0, progressRate: 0, offCourse: false,
      cameras: cameras.map(() => null),      // per camera: null, or { time, drifting, speed }
      nextCamera: 0, missed: cameras.map(() => false), missedShots: 0, lockedTries: 0,
      exitOpen: false,
      pursuer: createPursuer(start, P),
      trail: [{ x: start.x, y: start.y }],
      meter: 0, peakMeter: 0, minGap: Infinity, nearTime: 0, gap: P.startGap,
      rollingFor: -1,
    };
  }

  function result(run, scoring, ended) {
    const escaped = ended === 'escaped';
    const p = run.pursuer;
    return {
      value: escaped ? scoring.score : null,
      score: scoring.score, bestCombo: scoring.bestCombo, bestMultiplier: scoring.bestMultiplier, spinouts: scoring.spinouts,
      footage: run.cameras.filter(Boolean).length, cameras: cameras.length,
      shotsDrifted: run.cameras.filter((c) => c?.drifting).length,
      missedShots: run.missedShots, lockedTries: run.lockedTries,
      time: run.time, distance: run.furthest, ended,
      minGap: Number.isFinite(run.minGap) ? run.minGap : null, finalGap: run.gap,
      peakMeter: run.peakMeter, nearTime: run.nearTime,
      overshoots: p.overshoots, overshotTime: p.overshotTime, recoveries: p.recoveries, reverses: p.reverses, longestStuck: p.longestStuck,
    };
  }

  function fail(run, scoring, reason, ended) {
    if (scoring.combo) loseCombo(scoring, ended === 'busted' ? 'busted' : reason);
    end(run, 'failed', reason, result(run, scoring, ended));
  }

  function step(run, game, ax, ay, impact) {
    if (run.phase !== 'running') return;
    const T = TUNING;
    const dt = T.simStep;
    const { car, scoring } = game;
    run.time += dt;

    // Progress along the course line and the drift scoring: Linked Drift's own pathway.
    const atCar = projectOnCourse(course, car.x, car.y, run.index);
    const ds = atCar.s - run.s;
    const moved = Math.abs(ds) <= car.speed * dt * 2 + 0.5 ? ds : 0;
    run.index = atCar.index;
    run.s = atCar.s;
    const newGround = Math.max(0, atCar.s - run.furthest);
    if (newGround > 0) run.furthest = atCar.s;
    run.progressRate += (moved / dt - run.progressRate) * Math.min(1, T.progressRateSmoothing * dt);
    run.offCourse = Math.abs(atCar.offset) > L.corridor;
    updateScoring(scoring, {
      speed: car.speed, forwardSpeed: car.forwardSpeed, slipAngle: car.slipAngle,
      surface: run.offCourse ? 'grass' : 'road', progressRate: run.progressRate, newGround,
      handbrake: car.handbrake, impact,
    }, dt, T);

    // The trail the police car follows: a point every couple of metres of the car's path.
    const lastCrumb = run.trail[run.trail.length - 1];
    if (Math.hypot(car.x - lastCrumb.x, car.y - lastCrumb.y) >= P.crumbSpacing) run.trail.push({ x: car.x, y: car.y });

    // The police car, once it has set off.
    const p = run.pursuer;
    let gap;
    if (run.time < P.delay) {
      p.prevX = p.x; p.prevY = p.y; p.prevHeading = p.heading;
      gap = Math.hypot(car.x - p.x, car.y - p.y);
    } else gap = stepPursuer(p, car, run.trail, dt, P, bounds);
    run.gap = gap;
    run.minGap = Math.min(run.minGap, gap);
    const relSpeed = Math.hypot(car.vx - Math.cos(p.heading) * p.speed, car.vy - Math.sin(p.heading) * p.speed);
    if (run.time >= P.delay) {
      if (gap < C.radius) run.nearTime += dt;
      run.meter = clamp(run.meter + captureRate(C, gap, relSpeed) * dt, 0, 1);
      run.peakMeter = Math.max(run.peakMeter, run.meter);
    }
    if (run.meter >= 1) { note(run, { type: 'busted' }); fail(run, scoring, 'busted', 'busted'); return; }

    // Cameras: the next one films a crossing of its band in the direction of the course.
    const n = run.nextCamera;
    if (n < cameras.length) {
      const cam = cameras[n];
      if (run.rollingFor !== n && atCar.s > cam.s - 45 && atCar.s < cam.s) { run.rollingFor = n; note(run, { type: 'rolling', camera: cam.number }); }
      if (gateCrossing(cam.gate, ax, ay, car.x, car.y) === 1) {
        run.cameras[n] = { time: run.time, drifting: scoring.drifting, speed: car.speed };
        run.nextCamera += 1;
        run.exitOpen = run.nextCamera === cameras.length;
        note(run, { type: 'shot', camera: cam.number, drifting: scoring.drifting, all: run.exitOpen });
        run.stage = run.exitOpen ? 'The escape gate' : `Camera ${cameras[run.nextCamera].number}`;
      } else if (atCar.s > cam.s + missMargin && !run.missed[n]) {
        run.missed[n] = true;
        run.missedShots += 1;
        if (missPolicy === 'strict') {
          note(run, { type: 'cancelled', camera: cam.number });
          fail(run, scoring, `missed camera ${cam.number}`, 'missed');
          return;
        }
        note(run, { type: 'missed', camera: cam.number });
        run.stage = `Back for camera ${cam.number}`;
      } else if (run.missed[n] && atCar.s < cam.s - 2) {
        // Back behind the camera: it can be filmed again on the way through.
        run.missed[n] = false;
        run.stage = `Camera ${cam.number}`;
      }
    }

    // The escape gate: open only once every camera has its shot.
    const crossedExit = gateCrossing(exit, ax, ay, car.x, car.y);
    if (crossedExit === 1) {
      if (run.exitOpen) {
        bankCombo(scoring, 'escaped');
        note(run, { type: 'escaped' });
        end(run, 'complete', '', result(run, scoring, 'escaped'));
        return;
      }
      run.lockedTries += 1;
      note(run, { type: 'locked', footage: run.nextCamera, cameras: cameras.length });
    }

    if (run.time >= timeLimit) fail(run, scoring, 'out of time', 'out of time');
  }

  const name = variant === 'open' ? 'Getaway Drift (Open)' : 'Getaway Drift';
  return Object.freeze({
    id: `getaway-drift-${variant}`,
    name,
    shortName: variant === 'open' ? 'Getaway · Open' : 'Getaway · Route',
    experimental: true,
    kind: 'score',
    rules,
    layout: 'getaway',
    variant,
    missPolicy,
    tier,
    captureModel: C,
    pursuerTuning: P,
    tagline: 'NO FOOTAGE, NO GLORY.',
    brief: variant === 'open'
      ? 'The internet needs proof. Get the shot at all four cameras, in order, then lose the cop through the escape gate. The gate is right there, but no footage, no glory.'
      : 'The internet needs proof. Drive past all four cameras in order, throw down some drifts, and reach the escape gate before the cop boxes you in.',
    points: Object.freeze([
      'Take every camera\'s shot in order: just drive through its band. Drifting is optional, but drift points decide the medal.',
      'The bust meter fills while the police car is close, at any speed, and drains once you pull away. Full meter: busted.',
      missPolicy === 'strict' ? 'Miss a camera and the upload is cancelled: the run fails.'
        : 'Miss a camera and the escape gate stays shut until you go back for the shot.',
      'Escape with all the footage for Bronze. Banked drift points earn Silver and Gold. A busted run keeps nothing.',
    ]),
    track,
    geometry: Object.freeze({ course, corridor: L.corridor, painted: L.painted, cameras, exit, exitS, finishS: exitS, start, bounds, segments: L.segments }),
    focus: Object.freeze({ x: at(60).x, y: at(60).y }),
    createRun,
    step,
  });
}

export const GETAWAY_ROUTE = createGetawayChallenge({ variant: 'route' });
export const GETAWAY_OPEN = createGetawayChallenge({ variant: 'open' });
