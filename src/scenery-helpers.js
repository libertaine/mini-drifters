// Geometry-safe scenery placement helpers for production themed circuits.
// Enforces SCENERY_RULES (24 m clearance from centreline, 7 m gap or touch between solids
// and to perimeter walls, clear checkpoint gates, single connected open ground).
import { projectOnTrack } from './track.js';
import { TUNING } from './tuning.js';

function shapeBounds(s) {
  if (s.shape === 'box') return s;
  if (s.shape === 'poly') {
    const xs = s.points.map((q) => q[0]);
    const ys = s.points.map((q) => q[1]);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }
  return {
    minX: Math.min(s.ax, s.bx) - s.radius,
    maxX: Math.max(s.ax, s.bx) + s.radius,
    minY: Math.min(s.ay, s.by) - s.radius,
    maxY: Math.max(s.ay, s.by) + s.radius,
  };
}

function reachesBounds(s, b) {
  const bb = shapeBounds(s);
  return bb.maxX > b.minX && bb.minX < b.maxX && bb.maxY > b.minY && bb.minY < b.maxY;
}

function ptSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function shapeSignedDist(s, px, py) {
  if (s.shape === 'box') {
    const dx = Math.max(s.minX - px, 0, px - s.maxX);
    const dy = Math.max(s.minY - py, 0, py - s.maxY);
    if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
    return -Math.min(px - s.minX, s.maxX - px, py - s.minY, s.maxY - py);
  }
  if (s.shape === 'capsule') {
    return ptSegDist(px, py, s.ax, s.ay, s.bx, s.by) - s.radius;
  }
  let best = -Infinity;
  let minEdge = Infinity;
  const pts = s.points;
  for (let i = 0; i < pts.length; i += 1) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.hypot(ex, ey) || 1;
    const nx = ey / len;
    const ny = -ex / len;
    best = Math.max(best, (px - ax) * nx + (py - ay) * ny);
    minEdge = Math.min(minEdge, ptSegDist(px, py, ax, ay, bx, by));
  }
  return best <= 0 ? best : minEdge;
}

function sampleShape(s, step = 1.2) {
  const out = [];
  const edge = (ax, ay, bx, by, r = 0) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let i = 0; i <= n; i += 1) out.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, r]);
  };
  if (s.shape === 'box') {
    edge(s.minX, s.minY, s.maxX, s.minY);
    edge(s.maxX, s.minY, s.maxX, s.maxY);
    edge(s.maxX, s.maxY, s.minX, s.maxY);
    edge(s.minX, s.maxY, s.minX, s.minY);
  } else if (s.shape === 'capsule') {
    edge(s.ax, s.ay, s.bx, s.by, s.radius);
  } else {
    s.points.forEach((p, i) => edge(...p, ...s.points[(i + 1) % s.points.length]));
  }
  return out;
}

function shapesGap(a, b, ruleGap) {
  const ba = shapeBounds(a);
  const bb = shapeBounds(b);
  const bx = Math.max(bb.minX - ba.maxX, ba.minX - bb.maxX, 0);
  const by = Math.max(bb.minY - ba.maxY, ba.minY - bb.maxY, 0);
  if (Math.hypot(bx, by) > ruleGap + 2) return ruleGap + 2;
  let best = Infinity;
  for (const [x, y, r] of sampleShape(a)) best = Math.min(best, shapeSignedDist(b, x, y) - r);
  for (const [x, y, r] of sampleShape(b)) best = Math.min(best, shapeSignedDist(a, x, y) - r);
  return Math.max(0, best);
}

function wallClearanceOk(s, bounds, minGap) {
  const bb = shapeBounds(s);
  const gaps = [bb.minX - bounds.minX, bounds.maxX - bb.maxX, bb.minY - bounds.minY, bounds.maxY - bb.maxY];
  return gaps.every((g) => g <= 1e-6 || g >= minGap);
}

function gatesClearOf(track, shapes) {
  const R = TUNING.carRadius + 0.4;
  for (const g of [track.finish, ...track.gates]) {
    const len = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
    for (let d = 0; d <= len; d += 1.0) {
      const x = g.x1 + ((g.x2 - g.x1) * d) / len;
      const y = g.y1 + ((g.y2 - g.y1) * d) / len;
      if (projectOnTrack(track, x, y).distance > 22) continue;
      if (shapes.some((s) => shapeSignedDist(s, x, y) < R)) return false;
    }
  }
  return true;
}

// Tracks placed props and their reachable solid colliders so every placement respects SCENERY_RULES.
export function createPlacer(track, { isSolidKind, solidShapes, clearanceOf, rules }) {
  const props = [];
  const reachable = [];
  const bounds = track.bounds;

  function canPlace(prop, { clearance = 25.0, minGap = 7.6, allowTouch = false, outsideOnly = false } = {}) {
    if (!isSolidKind(prop.kind)) return true;
    const shapes = solidShapes([prop]);
    const inReach = shapes.filter((s) => reachesBounds(s, bounds));
    if (outsideOnly && inReach.length > 0) return false;
    if (!inReach.length) return true;
    if (clearanceOf(track, prop) < clearance) return false;
    for (const s of inReach) {
      if (!wallClearanceOk(s, bounds, minGap)) return false;
      for (const ex of reachable) {
        const g = shapesGap(s, ex, rules.gap);
        if (allowTouch ? (g > 1e-6 && g < minGap) : g < minGap) return false;
      }
    }
    if (!gatesClearOf(track, inReach)) return false;
    return true;
  }

  function add(prop, opts = {}) {
    if (!canPlace(prop, opts)) return false;
    const idx = props.length;
    props.push(prop);
    if (isSolidKind(prop.kind)) {
      for (const s of solidShapes([prop])) {
        if (reachesBounds(s, bounds)) reachable.push({ ...s, source: idx });
      }
    }
    return true;
  }

  function addFlat(prop) {
    props.push(prop);
    return true;
  }

  // Safely trims a track-offset polyline to contiguous pieces that keep >= clearance & wall gaps.
  function addOffsetLine(kind, offset, fromS, toS, width, spacing = 5, extra = {}) {
    const n = track.points.length;
    const run = [];
    const flush = () => {
      if (run.length >= 2) {
        const prop = { kind, points: run.slice(), width, ...extra };
        add(prop, { clearance: 24.8, minGap: 7.5, allowTouch: false });
      }
      run.length = 0;
    };
    for (let s = fromS; s <= toS; s += spacing) {
      const p = track.points[Math.round((((s % track.length) + track.length) % track.length) / track.step) % n];
      const x = p.x - p.ty * offset;
      const y = p.y + p.tx * offset;
      const d = projectOnTrack(track, x, y).distance - width / 2;
      const inside = x - width / 2 > bounds.minX + 7.8 && x + width / 2 < bounds.maxX - 7.8
        && y - width / 2 > bounds.minY + 7.8 && y + width / 2 < bounds.maxY - 7.8;
      if (d >= 25.0 && inside) run.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
      else flush();
    }
    flush();
  }

  // Places 3-2-1 braking boards along a straight approach outside the road.
  function addBrakingBoards(apexS, side = -1, distances = [78, 56, 34]) {
    const labels = ['3', '2', '1'];
    const n = track.points.length;
    distances.forEach((back, idx) => {
      const s = ((apexS - back) % track.length + track.length) % track.length;
      const p = track.points[Math.round(s / track.step) % n];
      const off = side * 26.8;
      const x = Math.round((p.x - p.ty * off) * 10) / 10;
      const y = Math.round((p.y + p.tx * off) * 10) / 10;
      add({ kind: 'marker', x, y, w: 2.2, h: 3.2, label: labels[idx] }, { clearance: 25.0, minGap: 7.6 });
    });
  }

  // Places an outer-corner chevron board pointing in the turn direction.
  function addChevronAt(s, turnSign, offset = 31.2) {
    const n = track.points.length;
    const p = track.points[Math.round((((s % track.length) + track.length) % track.length) / track.step) % n];
    // Right turn (turnSign > 0): outside is left (-offset). Left turn (turnSign < 0): outside is right (+offset).
    const off = -turnSign * offset;
    const x = Math.round((p.x - p.ty * off) * 10) / 10;
    const y = Math.round((p.y + p.tx * off) * 10) / 10;
    const horiz = Math.abs(p.tx) >= Math.abs(p.ty);
    const point = horiz ? (p.tx >= 0 ? 'east' : 'west') : (p.ty >= 0 ? 'south' : 'north');
    const w = horiz ? 11 : 2.1;
    const h = horiz ? 2.1 : 11;
    return add({ kind: 'chevron', x, y, w, h, point }, { clearance: 25.0, minGap: 7.6 });
  }

  // Places a round landmark / boulder / lamp / tree outside or safely inside bounds.
  function scatterRounds(rand, count, makeProp, opts = {}) {
    let placed = 0;
    for (let i = 0; i < count; i += 1) {
      const prop = makeProp(rand);
      if (prop && add(prop, opts)) placed += 1;
    }
    return placed;
  }

  return { props, add, addFlat, addOffsetLine, addBrakingBoards, addChevronAt, scatterRounds, canPlace };
}

export function pointAtS(track, s, offset = 0) {
  const n = track.points.length;
  const p = track.points[Math.round((((s % track.length) + track.length) % track.length) / track.step) % n];
  return [Math.round((p.x - p.ty * offset) * 10) / 10, Math.round((p.y + p.tx * offset) * 10) / 10, p];
}

export function makeOutcropPoly(cx, cy, rx, ry, seed, sides = 8) {
  let s = seed >>> 0;
  const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const pts = [];
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * Math.PI * 2;
    const k = 0.78 + rand() * 0.34;
    pts.push([Math.round((cx + Math.cos(a) * rx * k) * 10) / 10, Math.round((cy + Math.sin(a) * ry * k) * 10) / 10]);
  }
  return pts;
}
