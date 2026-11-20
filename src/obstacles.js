// Solid scenery: static collision boxes the car can hit. No browser code, so the tests run it.
//
// The boxes come from the scenery layout itself (dockyard-scenery.js), the same world-space data
// the picture is drawn from, so nothing here repeats a coordinate. Which kinds are solid is the
// only thing decided here. Everything is axis-aligned, as every prop is drawn.
//
// The car is the circle the perimeter wall already uses (TUNING.carRadius). Contact pushes it out
// to the box's surface, takes away the speed it had into the box (giving a little back as bounce),
// and rubs off some of the speed along it in proportion to how hard it hit: a glancing touch slides,
// a square hit stops. The response is the same on every frame rate because it runs inside the
// fixed simulation step.
import { TUNING } from './tuning.js';
import { buildDockyardScenery } from './dockyard-scenery.js';
import { sceneryFor } from './scenery.js';

// Contact numbers. Kept beside, not inside, TUNING: TUNING is also Classic's complete physics
// configuration (handling.js), and nothing here changes how the car drives on open ground.
export const CONTACT = Object.freeze({
  restitution: TUNING.barrierRestitution, // bounce, as the perimeter wall
  friction: 0.3,          // speed along the surface lost per unit of speed into it (Coulomb-like)
  yawLoss: 0.4,           // share of the spin taken out by a significant hit, as the wall's 0.6 keeps
  sealGap: 7,             // gaps narrower than this between solid props are filled, so the car
                          // (4.4 m across) can never wedge between two of them
  sweepStep: 0.5,         // the longest move checked in one piece; the car covers 0.35 m a step at top speed
  passes: 3,              // contact passes per step, for corners where two boxes meet
});

// Which kinds of prop stop the car. Loading bays and slab joints are paint; corner boards are
// decorative for now.
export const SOLID_KINDS = Object.freeze(['warehouse', 'container', 'barrier']);

const box = (minX, minY, maxX, maxY, kind, source, filled = false) => ({ minX, minY, maxX, maxY, kind, source, filled });

// Two boxes side by side with a gap the car can't pass through get a filler over the gap, along
// the stretch where they face each other. The filler adds no ground the car could have driven, and
// is the same kind of thing as the pair it joins (a gap between two containers is hit as a container).
const fillerKind = (a, b) => (a.kind === b.kind ? a.kind : 'barrier');
function sealBetween(a, b, gap) {
  const fillers = [];
  const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  if (overlapY > 0) {
    const [l, r] = a.maxX <= b.minX ? [a, b] : [b, a];
    const width = r.minX - l.maxX;
    if (width > 0 && width < gap) fillers.push(box(l.maxX, Math.max(a.minY, b.minY), r.minX, Math.min(a.maxY, b.maxY), fillerKind(a, b), [a.source, b.source], true));
  }
  if (overlapX > 0) {
    const [t, u] = a.maxY <= b.minY ? [a, b] : [b, a];
    const height = u.minY - t.maxY;
    if (height > 0 && height < gap) fillers.push(box(Math.max(a.minX, b.minX), t.maxY, Math.min(a.maxX, b.maxX), u.minY, fillerKind(a, b), [a.source, b.source], true));
  }
  return fillers;
}

// The solid boxes for one set of props (as dockyard-scenery.js lays them out).
export function collidersFromProps(props, C = CONTACT) {
  const solids = [];
  props.forEach((p, i) => {
    if (!SOLID_KINDS.includes(p.kind)) return;
    solids.push(box(p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2, p.kind, i));
  });
  const seals = [];
  for (let i = 0; i < solids.length; i += 1) {
    for (let j = i + 1; j < solids.length; j += 1) seals.push(...sealBetween(solids[i], solids[j], C.sealGap));
  }
  return Object.freeze([...solids, ...seals].map(Object.freeze));
}

// Every circuit's solid scenery, built once per track object. Circuits without any have none.
// Dockyard's comes from its own layout (R1, unchanged); Original's and Switchback's from scenery.js.
const cache = new WeakMap();
export function obstaclesFor(track) {
  if (!track) return Object.freeze([]);
  // Getaway cities supply their solid scenery with the layout.
  if (track.colliders) return track.colliders;
  if (!cache.has(track)) {
    const dockyard = buildDockyardScenery(track);
    const scenery = dockyard ? null : sceneryFor(track);
    cache.set(track, dockyard ? collidersFromProps(dockyard.props)
      : scenery ? collidersFromScenery(scenery, track.bounds) : Object.freeze([]));
  }
  return cache.get(track);
}

// --- Rounded shapes (v0.6.0 R2) ----------------------------------------------------------------
// Original's and Switchback's scenery adds two shapes beside the boxes above:
//   - a capsule: a segment with a radius. A tree or a rock is a capsule of no length; a guardrail,
//     a tyre wall or a retaining wall is one capsule per straight piece.
//   - a convex polygon: a stand of woodland, solid along its outline and inside it.
// Each carries its bounding box (minX..maxY) for the same quick rejection the boxes use.
// A prop's collider is derived from the very numbers it is drawn from (scenery.js solidShapes).

function capsule(ax, ay, bx, by, radius, kind, source) {
  return { shape: 'capsule', ax, ay, bx, by, radius, kind, source, filled: false,
    minX: Math.min(ax, bx) - radius, minY: Math.min(ay, by) - radius,
    maxX: Math.max(ax, bx) + radius, maxY: Math.max(ay, by) + radius };
}

function polygon(points, kind, source) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { shape: 'poly', points, kind, source, filled: false,
    minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

// The solids of an R2 layout. A shape the car can never reach (wholly beyond the perimeter wall,
// which stops the car first) gets no collider: it could never be touched.
export function collidersFromScenery(scenery, bounds) {
  const reachable = (c) => c.maxX > bounds.minX && c.minX < bounds.maxX && c.maxY > bounds.minY && c.minY < bounds.maxY;
  const out = [];
  scenery.solids.forEach((s) => {
    let c;
    if (s.shape === 'box') c = box(s.minX, s.minY, s.maxX, s.maxY, s.kind, s.source);
    else if (s.shape === 'capsule') c = { ...capsule(s.ax, s.ay, s.bx, s.by, s.radius, s.kind, s.source), piece: s.piece };
    else c = polygon(s.points, s.kind, s.source);
    if (reachable(c)) out.push(Object.freeze(c));
  });
  return Object.freeze(out);
}

function contactCapsule(c, x, y, r) {
  const ex = c.bx - c.ax;
  const ey = c.by - c.ay;
  const len2 = ex * ex + ey * ey;
  let t = len2 > 0 ? ((x - c.ax) * ex + (y - c.ay) * ey) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = c.ax + ex * t;
  const qy = c.ay + ey * t;
  const dx = x - qx;
  const dy = y - qy;
  const d = Math.hypot(dx, dy);
  if (d >= c.radius + r) return null;
  // A centre exactly on the spine leaves sideways from the segment (or east from a point).
  const [nx, ny] = d > 1e-9 ? [dx / d, dy / d] : len2 > 0 ? [-ey / Math.sqrt(len2), ex / Math.sqrt(len2)] : [1, 0];
  return { nx, ny, px: qx + nx * c.radius, py: qy + ny * c.radius, depth: c.radius + r - d };
}

function contactPolygon(c, x, y, r) {
  const pts = c.points;
  let inside = true;
  let best = Infinity;
  let hit = null;
  for (let i = 0; i < pts.length; i += 1) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.hypot(ex, ey);
    // Points run clockwise on screen (y down), so the outward normal of an edge is (ey, -ex).
    const ox = ey / len;
    const oy = -ex / len;
    const side = (x - ax) * ox + (y - ay) * oy;
    if (side > 0) inside = false;
    let t = ((x - ax) * ex + (y - ay) * ey) / (len * len);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + ex * t;
    const qy = ay + ey * t;
    const d = Math.hypot(x - qx, y - qy);
    if (d < best) { best = d; hit = { qx, qy, ox, oy }; }
  }
  if (inside) return { nx: hit.ox, ny: hit.oy, px: hit.qx, py: hit.qy, depth: r + best };
  if (best >= r) return null;
  return { nx: (x - hit.qx) / best, ny: (y - hit.qy) / best, px: hit.qx, py: hit.qy, depth: r - best };
}

// Nearest point of a box to (x, y), and the outward direction from it. A centre inside the box
// (which a swept step never leaves it in) is pushed out through the nearest side.
function contactWith(b, x, y, r) {
  if (b.shape === 'capsule') return contactCapsule(b, x, y, r);
  if (b.shape === 'poly') return contactPolygon(b, x, y, r);
  const cx = x < b.minX ? b.minX : x > b.maxX ? b.maxX : x;
  const cy = y < b.minY ? b.minY : y > b.maxY ? b.maxY : y;
  const dx = x - cx;
  const dy = y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 > 0) {
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, px: cx, py: cy, depth: r - d };
  }
  const sides = [
    [x - b.minX, -1, 0, b.minX, y], [b.maxX - x, 1, 0, b.maxX, y],
    [y - b.minY, 0, -1, x, b.minY], [b.maxY - y, 0, 1, x, b.maxY],
  ];
  sides.sort((p, q) => p[0] - q[0]);
  const [inside, nx, ny, px, py] = sides[0];
  return { nx, ny, px, py, depth: r + inside };
}

function touching(boxes, x, y, r) {
  for (const b of boxes) {
    if (x + r <= b.minX || x - r >= b.maxX || y + r <= b.minY || y - r >= b.maxY) continue;
    if (contactWith(b, x, y, r)) return true;
  }
  return false;
}

// Resolve the car against the boxes after a physics step that started at (ax, ay). Returns the
// hardest hit's speed into the surface (0 for none) and, for the debug view, where it happened.
export function resolveObstacles(car, boxes, ax, ay, T = TUNING, C = CONTACT) {
  if (!boxes.length) return null;
  const r = T.carRadius;
  // Sweep: if the step moved further than one safe piece, stop the car at the first piece of the
  // move that touches anything, so no speed can carry it through a thin barrier.
  const mx = car.x - ax;
  const my = car.y - ay;
  const pieces = Math.ceil(Math.hypot(mx, my) / C.sweepStep);
  if (pieces > 1) {
    for (let k = 1; k < pieces; k += 1) {
      const x = ax + (mx * k) / pieces;
      const y = ay + (my * k) / pieces;
      if (touching(boxes, x, y, r)) {
        car.x = x;
        car.y = y;
        break;
      }
    }
  }
  let hit = null;
  for (let pass = 0; pass < C.passes; pass += 1) {
    let moved = false;
    for (const b of boxes) {
      if (car.x + r <= b.minX || car.x - r >= b.maxX || car.y + r <= b.minY || car.y - r >= b.maxY) continue;
      const c = contactWith(b, car.x, car.y, r);
      if (!c) continue;
      moved = true;
      car.x = c.px + c.nx * (r + 1e-6);
      car.y = c.py + c.ny * (r + 1e-6);
      const vn = car.vx * c.nx + car.vy * c.ny;
      if (vn >= 0) continue; // already leaving: only the overlap needed fixing
      const into = -vn;
      const tx = -c.ny;
      const ty = c.nx;
      const vt = car.vx * tx + car.vy * ty;
      const rub = Math.min(Math.abs(vt), C.friction * (1 + C.restitution) * into);
      const keptT = vt - Math.sign(vt) * rub;
      const outN = into * C.restitution;
      car.vx = c.nx * outN + tx * keptT;
      car.vy = c.ny * outN + ty * keptT;
      car.yawRate *= 1 - C.yawLoss * Math.min(1, into / T.barrierSignificantImpact);
      if (!hit || into > hit.impact) hit = { impact: into, kind: b.kind, x: c.px, y: c.py, nx: c.nx, ny: c.ny };
    }
    if (!moved) break;
  }
  return hit;
}
