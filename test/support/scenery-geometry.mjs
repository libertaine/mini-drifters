// Exact-enough geometry on the colliders obstacles.js builds (boxes, capsules, convex polygons),
// for the R2 scenery tests: signed distance, clearance from the centreline, gaps between solids
// and to the perimeter wall. Sampled at 0.25 m along outlines and spines.
import { projectOnTrack } from '../../src/track.js';

const STEP = 0.25;

function along(ax, ay, bx, by, out, pad) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / STEP));
  for (let i = 0; i <= n; i += 1) out.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, pad]);
}

// Points on the collider's outline (box, polygon) or spine (capsule), with the distance its
// surface lies beyond them.
export function colliderSamples(c) {
  const out = [];
  if (c.shape === 'capsule') along(c.ax, c.ay, c.bx, c.by, out, c.radius);
  else if (c.shape === 'poly') c.points.forEach((p, i) => along(...p, ...c.points[(i + 1) % c.points.length], out, 0));
  else {
    along(c.minX, c.minY, c.maxX, c.minY, out, 0); along(c.maxX, c.minY, c.maxX, c.maxY, out, 0);
    along(c.maxX, c.maxY, c.minX, c.maxY, out, 0); along(c.minX, c.maxY, c.minX, c.minY, out, 0);
  }
  return out;
}

// Signed distance from a point to the collider's surface: negative inside.
export function signedDistance(c, x, y) {
  if (c.shape === 'capsule') {
    const ex = c.bx - c.ax;
    const ey = c.by - c.ay;
    const len2 = ex * ex + ey * ey;
    const t = len2 ? Math.max(0, Math.min(1, ((x - c.ax) * ex + (y - c.ay) * ey) / len2)) : 0;
    return Math.hypot(x - (c.ax + ex * t), y - (c.ay + ey * t)) - c.radius;
  }
  if (c.shape === 'poly') {
    let inside = true;
    let best = Infinity;
    c.points.forEach(([ax, ay], i) => {
      const [bx, by] = c.points[(i + 1) % c.points.length];
      const ex = bx - ax;
      const ey = by - ay;
      if ((x - ax) * ey - (y - ay) * ex > 0) inside = false;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
      best = Math.min(best, Math.hypot(x - (ax + ex * t), y - (ay + ey * t)));
    });
    return inside ? -best : best;
  }
  const dx = Math.max(c.minX - x, 0, x - c.maxX);
  const dy = Math.max(c.minY - y, 0, y - c.maxY);
  if (dx || dy) return Math.hypot(dx, dy);
  return -Math.min(x - c.minX, c.maxX - x, y - c.minY, c.maxY - y);
}

export function colliderClearance(track, c) {
  let best = Infinity;
  for (const [x, y, pad] of colliderSamples(c)) best = Math.min(best, projectOnTrack(track, x, y).distance - pad);
  return best;
}

// Gap between two colliders' surfaces; zero or less when they touch or overlap.
export function colliderGap(a, b) {
  if (a.maxX + 8 < b.minX || b.maxX + 8 < a.minX || a.maxY + 8 < b.minY || b.maxY + 8 < a.minY) return Infinity;
  let best = Infinity;
  for (const [x, y, pad] of colliderSamples(a)) best = Math.min(best, signedDistance(b, x, y) - pad);
  for (const [x, y, pad] of colliderSamples(b)) best = Math.min(best, signedDistance(a, x, y) - pad);
  return best;
}

// How far the collider stands off each side of the perimeter wall (negative: it crosses it).
export function wallGaps(c, bounds) {
  return [c.minX - bounds.minX, bounds.maxX - c.maxX, c.minY - bounds.minY, bounds.maxY - c.maxY];
}
