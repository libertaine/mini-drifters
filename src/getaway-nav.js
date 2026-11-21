// Getaway Drift's guidance in town (EXPERIMENTAL, v0.7.0 R4C research). Pure: no browser code, so
// the tests read exactly what the HUD shows. It reuses R4B's street graph and routing
// (getaway-city.js); it is not a general navigation system.
//
//   planGuide    the way to the next objective along the streets, round blockades and intact
//                barricades, as in R4B;
//                  - the route already shown is kept unless another is clearly shorter, so two
//                    near-equal ways do not flicker at a junction.
//   shortcutFor  the way through an intact wooden barricade, when smashing it would save real
//                distance. It is offered on the minimap as an option, never made the route.
//   navCue       what the HUD needs from the route at this moment: the direction to steer for
//                (a point well ahead along the route that the car can actually see, never one
//                through a building), and the next turn and how far off it is.
import { locate, route, routeToGate, segmentHitsBox } from './getaway-city.js';

const DEG = Math.PI / 180;
const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Experimental values, chosen in R4C (artifacts/R4C-SHOWMANSHIP-REPORT.md, section D).
export const NAV = Object.freeze({
  refresh: 0.3,          // seconds between route plans (R4B's)
  stick: 0.85,           // the shown route's streets plan at this share of their length
  lookMin: 18,           // the arrow aims this far along the route at a standstill (m)...
  lookPerSpeed: 1.0,     // ...plus this many metres per m/s...
  lookMax: 50,           // ...up to this
  aimPad: 1.0,           // the aim point must be in clear sight of the car, by this margin (m)
  turnAngle: 35 * DEG,   // a junction that turns the route more than this is a turn
  noticeMin: 70,         // a turn is announced this far ahead (m)...
  noticeTime: 3.5,       // ...or this many seconds ahead at the current speed, if further
  shortcutGain: 25,      // a barricade shortcut is shown only if it saves at least this (m)
  arriveRange: 60,       // the objective is "ahead" when it is on this street within this (m)
});

// A camera is still ahead in its last two metres. R4B's routeToGate switches to its
// recovery loop there; that must not replace the last instant of a valid approach.
function guideRoute(city, at, gate, options) {
  if (at.edge === gate.edge && (gate.at - at.t) * gate.sign >= 0) {
    const r = route(city, at, { edge: gate.edge, t: gate.at }, options);
    if (r) return { ...r, points: [...r.points.slice(0, -1), [gate.cx + gate.tx * 6, gate.cy + gate.ty * 6]] };
  }
  return routeToGate(city, at, gate, options);
}

// Graph endpoints can coincide with the start or a gate. They are not corners. Keep
// real reversals, but remove zero legs and straight junctions before reading turns.
function compact(points) {
  const out = [];
  for (const p of points) {
    if (out.length && Math.hypot(p[0] - out.at(-1)[0], p[1] - out.at(-1)[1]) < 0.01) continue;
    while (out.length > 1) {
      const a = out.at(-2), b = out.at(-1);
      const ux = b[0] - a[0], uy = b[1] - a[1], vx = p[0] - b[0], vy = p[1] - b[1];
      if (Math.abs(ux * vy - uy * vx) > 0.001 || ux * vx + uy * vy <= 0) break;
      out.pop();
    }
    out.push(p);
  }
  return out;
}

// At a crossing, nearest centre line alone can briefly pick the cross street.
// Read the street the car is travelling along, retaining it through the junction.
// Scoring and police still use R4B's locate() unchanged.
export function guidePlace(city, car, prefer = -1) {
  const at = locate(city, car.x, car.y, prefer);
  const speed = Math.hypot(car.vx, car.vy);
  const h = speed > 3 ? Math.atan2(car.vy, car.vx) : car.heading;
  const aligned = (e) => Math.abs(e.dx * Math.cos(h) + e.dy * Math.sin(h));
  let best = aligned(city.edges[at.edge]);
  let chosen = at;
  if (best > 0.75) return at;
  for (const e of city.edges) {
    const t = (car.x - e.ax) * e.dx + (car.y - e.ay) * e.dy;
    const offset = -(car.x - e.ax) * e.dy + (car.y - e.ay) * e.dx;
    const a = aligned(e);
    if (t >= 0 && t <= e.len && Math.abs(offset) <= e.half && a > best + 0.2) {
      chosen = { edge: e.index, t, offset, outside: 0 }; best = a;
    }
  }
  return chosen;
}

// The streets a guide runs along, as a Set of street indices (for `favour`).
function streetsOf(city, guide, gateEdge) {
  const out = new Set([gateEdge]);
  const nodes = guide.nodes ?? [];
  for (let i = 1; i < nodes.length; i += 1) {
    const e = city.edgeBetween(nodes[i - 1], nodes[i]);
    if (e) out.add(e.index);
  }
  return out;
}

// The route to `gate` from `at` (a getaway-city locate() place). `previous` (the last plan for the same gate) is favoured. `next` (the
// objective after this one) adds `ahead`: the way on from just past `gate` to it, so a turn soon
// after a camera is called before the camera, not after. `points` is still the way to `gate` alone.
export function planGuide(city, at, gate, { broken = null, car = null, previous = null, next = null, N = NAV } = {}) {
  if (car) at = guidePlace(city, car, previous?.startEdge ?? at.edge);
  const options = { broken };

  if (previous && previous.gate === gate && previous.streets) {
    options.favour = previous.streets;
    options.favourFactor = N.stick;
  }
  const r = guideRoute(city, at, gate, options);
  if (!r) return null;
  let ahead = null;
  if (next) {
    const e = city.edges[gate.edge];
    const after = { edge: gate.edge, t: clamp(gate.at + gate.sign * 6, 0, e.len) };
    const r2 = guideRoute(city, after, next, { broken });
    if (r2) ahead = r2.points.slice(1);
  }
  return { ...r, startEdge: at.edge, points: compact(r.points), gate, ahead: ahead ? compact([r.points.at(-1), ...ahead]).slice(1) : null, streets: streetsOf(city, r, gate.edge) };
}

// The way through an intact barricade, if it is at least `shortcutGain` metres shorter than `guide`.
export function shortcutFor(city, at, gate, guide, { broken = null, N = NAV } = {}) {
  if (!guide || !city.breakables.some((b) => b.kind === 'barricade' && !broken?.[b.index])) return null;
  const r = routeToGate(city, at, gate, { broken, throughBarricades: true });
  if (!r || r.length + N.shortcutGain > guide.length) return null;
  return { ...r, saves: guide.length - r.length };
}

const clearSight = (colliders, ax, ay, bx, by, pad) => !colliders.some((c) => segmentHitsBox(ax, ay, bx, by, c, pad));

// The HUD's reading of a guide for a car at (x, y) moving at (vx, vy) facing `heading`:
//   dir       the bearing to steer for (radians, screen: 0 east, +90 degrees south)
//   aim       the point it aims at, `look` metres along the route (nearer when a corner hides it)
//   turn      the next turn on the route: side 'left' | 'right' | 'around', `in` metres, at [x, y]
//   announce  that turn, if it is within notice distance (else null)
//   around    the car is moving away along the route: turn round first
//   arriving  the objective is on this stretch, within `arriveRange`, with no turn before it
//   remaining metres along the route to the objective
// The route read is the guide's way to the objective and on beyond it (`ahead`), so the aim and the
// next turn carry on past a camera without a break.
export function navCue(city, guide, car, { colliders = city.colliders, N = NAV, previous = null } = {}) {
  if (!guide?.points || guide.points.length < 2) return null;
  const pts = guide.ahead?.length ? [...guide.points, ...guide.ahead] : guide.points;
  const goalIndex = guide.points.length - 1;
  // Cumulative lengths, and the car's place on the route: the nearest point on it (the first, on
  // a tie, so a route that doubles back is read from its start).
  const cum = [0];
  for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  let best = { d: Infinity, i: 0, t: 0 };
  for (let i = 0; i < goalIndex; i += 1) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const ex = bx - ax;
    const ey = by - ay;
    const l2 = ex * ex + ey * ey;
    const t = l2 > 0 ? clamp(((car.x - ax) * ex + (car.y - ay) * ey) / l2, 0, 1) : 0;
    const d = Math.hypot(car.x - (ax + ex * t), car.y - (ay + ey * t));
    if (d < best.d - 0.01) best = { d, i, t };
  }
  const s0 = cum[best.i] + (cum[best.i + 1] - cum[best.i]) * best.t;
  const total = cum[cum.length - 1];
  const pointAt = (s) => {
    const target = clamp(s, 0, total);
    let i = 0;
    while (i < pts.length - 2 && cum[i + 1] < target) i += 1;
    const seg = cum[i + 1] - cum[i] || 1;
    const f = (target - cum[i]) / seg;
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
  };
  const speed = Math.hypot(car.vx, car.vy);
  // The aim: well ahead along the route, brought nearer only while a building's corner hides it.
  let look = clamp(N.lookMin + N.lookPerSpeed * speed, N.lookMin, N.lookMax);
  let aim = pointAt(s0 + look);
  while (look > 0.1 && !clearSight(colliders, car.x, car.y, aim[0], aim[1], N.aimPad)) {
    look *= 0.8;
    aim = pointAt(s0 + look);
  }
  if (!clearSight(colliders, car.x, car.y, aim[0], aim[1], N.aimPad)) {
    // Off the centre line beside a solid prop: find a visible place on this local
    // road, including behind us. This changes only the steering aim, not the route.
    let nearest = Infinity;
    for (let d = -50; d <= 50; d += 2) {
      const p = pointAt(s0 + d);
      const gap = Math.hypot(p[0] - car.x, p[1] - car.y);
      if (gap > 1 && gap < nearest && clearSight(colliders, car.x, car.y, p[0], p[1], N.aimPad)) {
        aim = p; nearest = gap;
      }
    }
    if (!Number.isFinite(nearest)) {
      // A parked truck may hide the entire local centre line. Its clear outer
      // corners provide a bounded way back, without aiming through that truck.
      const target = pointAt(s0 + N.lookMin);
      for (const b of colliders) {
        if (Math.hypot(car.x - b.cx, car.y - b.cy) > 60) continue;
        for (const x of [b.minX - 2.5, b.maxX + 2.5]) for (const y of [b.minY - 2.5, b.maxY + 2.5]) {
          const cost = Math.hypot(x - car.x, y - car.y) + Math.hypot(target[0] - x, target[1] - y);
          if (cost < nearest && clearSight(colliders, car.x, car.y, x, y, N.aimPad)
            && clearSight(colliders, x, y, target[0], target[1], N.aimPad)) { aim = [x, y]; nearest = cost; }
        }
      }
      if (!Number.isFinite(nearest)) aim = [car.x, car.y];
    }
  }
  const dir = Math.atan2(aim[1] - car.y, aim[0] - car.x);
  // The next turn: the first route corner past the car that turns more than `turnAngle`.
  const headingOf = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  let turn = null;
  for (let i = best.i + 1; i < pts.length - 1; i += 1) {
    const inLen = cum[i] - cum[i - 1];
    if (inLen < 0.01 || cum[i + 1] - cum[i] < 0.01) continue;
    const h1 = headingOf(pts[i - 1], pts[i]);
    const h2 = headingOf(pts[i], pts[i + 1]);
    const a = angleTo(h1, h2);
    if (Math.abs(a) < N.turnAngle) continue;
    turn = { side: Math.abs(a) > 150 * DEG ? 'around' : a > 0 ? 'right' : 'left', in: Math.max(0, cum[i] - s0), x: pts[i][0], y: pts[i][1], from: h1, to: h2 };
    break;
  }
  const notice = Math.max(N.noticeMin, N.noticeTime * speed);
  // Braking can shrink the speed-based warning range faster than the car closes
  // on its turn. Once called, keep that same real turn until it is passed or
  // the route changes. No route or instruction is delayed to mask replanning.
  const called = turn && previous?.announce && turn.side === previous.announce.side
    && Math.hypot(turn.x - previous.announce.x, turn.y - previous.announce.y) < 0.1;
  // Moving the wrong way along the route's current leg.
  const leg = headingOf(pts[best.i], pts[best.i + 1]);
  const moving = car.heading;
  const around = cum[best.i + 1] - cum[best.i] > 0.01 && Math.cos(angleTo(moving, leg)) < -0.3;
  const remaining = Math.max(0, cum[goalIndex] - s0);
  return {
    dir, aim, look, turn, around, remaining,
    announce: turn && (turn.in <= notice || called) ? turn : null,
    arriving: !around && remaining <= N.arriveRange + 6 && (!turn || turn.in > remaining),
  };
}

// The cue for a running session, worked out once per simulation step and shared by the arrow, the
// road chevrons and the HUD chip.
const cueCache = new WeakMap();
export function cueForGame(game) {
  const run = game.challenge;
  const def = game.challengeDef;
  if (!run?.guide || def?.layout !== 'urban') return null;
  const hit = cueCache.get(run);
  if (hit && hit.tick === game.ticks && hit.guide === run.guide) return hit.cue;
  const cue = navCue(def.geometry.city, run.guide, game.car, { previous: hit?.cue });
  cueCache.set(run, { tick: game.ticks, guide: run.guide, cue });
  return cue;
}

// The HUD chip's words: what to do next (`call`, with `glyph` 'left' | 'right' | 'around' |
// 'straight' | 'arrive') and where it leads (`goal`). Distances are rounded to 10 m.
const tens = (m) => Math.max(10, Math.round(m / 10) * 10);
export function cueText(run, cue, cameras) {
  const n = run.nextCamera;
  const goal = run.exitOpen ? 'ESCAPE GATE'
    : run.missed[n] ? `BACK FOR CAM ${cameras[n].number}` : `CAM ${cameras[n].number}`;
  if (!cue) return { glyph: 'straight', call: 'FIND THE ROUTE', goal, distance: null };
  const distance = `${tens(cue.remaining)} m`;
  if (cue.around) return { glyph: 'around', call: 'TURN AROUND', goal, distance };
  if (cue.announce) {
    const side = cue.announce.side;
    if (side === 'around') return { glyph: 'around', call: `U-TURN ${tens(cue.announce.in)} m`, goal, distance };
    return { glyph: side, call: `${side === 'left' ? 'LEFT' : 'RIGHT'} ${tens(cue.announce.in)} m`, goal, distance };
  }
  if (cue.arriving) return { glyph: 'arrive', call: `${run.exitOpen ? 'GATE' : 'CAMERA'} AHEAD`, goal, distance };
  return { glyph: 'straight', call: 'STRAIGHT ON', goal, distance };
}

// Eases a displayed bearing toward a new one: no snapping, and the short way round.
export function easeAngle(shown, target, dt, tau = 0.12) {
  if (shown === null || shown === undefined || !Number.isFinite(shown)) return target;
  return shown + angleTo(shown, target) * (1 - Math.exp(-dt / tau));
}

// Turn symbols describe a change from the approach heading. A U's arrowhead
// already points back, so rotating it toward the return bearing reverses it twice.
export function turnBearing(cue, car) {
  return cue.around ? car.heading : cue.announce?.from ?? cue.dir;
}
