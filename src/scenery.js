// Original's and Switchback's scenery (v0.6.0 R2): the layout, in world metres, and the rules that
// decide what is solid. No browser code, so the tests read exactly what is drawn and collided with.
//
// A layout is a list of props. Each prop has a kind and one of four shapes:
//   box   { x, y, w, h }          centre and size, axis-aligned, as Dockyard's props are
//   round { x, y, r }             a tree, a rock, a stack of tyres
//   line  { points, width }       an open polyline: a guardrail, a tyre wall, a retaining wall
//   poly  { points }              a closed convex outline: a stand of woodland, a patch of ground
// Whether a prop is solid follows from its kind alone (KINDS below): raised things are solid and
// flat things are driven over. The collision shape is derived from the same numbers the prop is
// drawn from (solidShapes), and obstacles.js keeps only the shapes the car can reach.
//
// Layouts are built once per circuit, deterministically: hand-placed structures, plus seeded
// scatter for trees and texture, filtered by the same clearance rules the tests check.
import { projectOnTrack } from './track.js';
import { buildOriginalScenery } from './scenery-original.js';
import { buildSwitchbackScenery } from './scenery-switchback.js';
import { buildRunwayScenery } from './scenery-runway.js';
import { buildMesaScenery } from './scenery-mesa.js';
import { buildHeadlandScenery } from './scenery-headland.js';
import { buildNightshiftScenery } from './scenery-nightshift.js';

// The placement rules, checked by test/scenery-r2.test.mjs.
export const SCENERY_RULES = Object.freeze({
  solidClearance: 24,  // metres from the centreline to any reachable solid: 12 m of grass past the curb
  gap: 7,              // two solids, or a solid and the perimeter wall, either touch or leave this much
                       // room (as obstacles.js CONTACT.sealGap): the 4.4 m car can't wedge between them
});

// raised: solid wherever the car can reach it. hit: a round prop's collision radius as a share of
// its drawn radius (a canopy is soft at the edge; a rock or a tyre stack is not).
export const KINDS = Object.freeze({
  // Structures and vehicles.
  building: { raised: true }, garage: { raised: true }, tower: { raised: true },
  grandstand: { raised: true }, shed: { raised: true }, gazebo: { raised: true },
  van: { raised: true }, trailer: { raised: true }, truck: { raised: true }, tractor: { raised: true },
  car: { raised: true }, cabin: { raised: true }, bench: { raised: true }, marshal: { raised: true },
  // Trackside equipment and signs.
  tyres: { raised: true, hit: 1 }, tyrewall: { raised: true }, hoarding: { raised: true },
  marker: { raised: true }, sign: { raised: true }, chevron: { raised: true },
  guardrail: { raised: true }, retaining: { raised: true }, fence: { raised: true },
  // Nature.
  tree: { raised: true, hit: 0.55 }, pine: { raised: true, hit: 0.5 }, rock: { raised: true, hit: 0.85 },
  stand: { raised: true }, outcrop: { raised: true },
  // Venue-specific structures and landmarks (v0.9.0 circuits).
  hangar: { raised: true }, bunker: { raised: true }, lighthouse: { raised: true, hit: 0.95 },
  tank: { raised: true, hit: 0.95 }, pylon: { raised: true }, lamppost: { raised: true, hit: 0.9 },
  cactus: { raised: true, hit: 0.72 }, windsock: { raised: true, hit: 0.8 }, aircraft: { raised: true, hit: 0.85 },
  // Flat: drawn on the ground, never solid.
  paved: { raised: false }, road: { raised: false }, parking: { raised: false }, gravel: { raised: false },
  wear: { raised: false }, earth: { raised: false }, meadow: { raised: false }, path: { raised: false },
  wash: { raised: false }, water: { raised: false }, mound: { raised: false }, paint: { raised: false },
  pier: { raised: false }, boat: { raised: false }, runway: { raised: false }, rail: { raised: false },
  sand: { raised: false }, decal: { raised: false },
});

export const isSolidKind = (kind) => KINDS[kind]?.raised === true;

// --- Deterministic helpers ------------------------------------------------------------------------

// mulberry32: the same sequence in every engine, from integer arithmetic only.
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Convex hull, clockwise on screen (positive shoelace area with y down), as obstacles.js expects.
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return signedArea(hull) > 0 ? hull : hull.reverse();
}

export function signedArea(points) {
  let a = 0;
  points.forEach(([x, y], i) => {
    const [u, v] = points[(i + 1) % points.length];
    a += x * v - u * y;
  });
  return a / 2;
}

export function insidePolygon(points, x, y) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Rounds a closed convex outline by cutting its corners (Chaikin), which keeps it convex.
export function roundOutline(points, passes = 2) {
  let pts = points;
  for (let k = 0; k < passes; k += 1) {
    pts = pts.flatMap(([ax, ay], i) => {
      const [bx, by] = pts[(i + 1) % pts.length];
      return [[ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]];
    });
  }
  return pts.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
}

// Points on a prop's outline, each with how far the solid reaches beyond it (its pad).
export function outlineSamples(prop, spacing = 1) {
  const out = [];
  const along = (ax, ay, bx, by, pad) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / spacing));
    for (let i = 0; i <= n; i += 1) out.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, pad]);
  };
  if (prop.w !== undefined) {
    const x0 = prop.x - prop.w / 2;
    const y0 = prop.y - prop.h / 2;
    const x1 = prop.x + prop.w / 2;
    const y1 = prop.y + prop.h / 2;
    along(x0, y0, x1, y0, 0); along(x1, y0, x1, y1, 0); along(x1, y1, x0, y1, 0); along(x0, y1, x0, y0, 0);
  } else if (prop.r !== undefined) {
    out.push([prop.x, prop.y, prop.r]);
  } else if (prop.width !== undefined) {
    for (let i = 1; i < prop.points.length; i += 1) along(...prop.points[i - 1], ...prop.points[i], prop.width / 2);
  } else {
    prop.points.forEach((p, i) => along(...p, ...prop.points[(i + 1) % prop.points.length], 0));
  }
  return out;
}

// Smallest distance from the circuit's centreline to any part of the prop.
export function clearanceOf(track, prop) {
  let best = Infinity;
  for (const [x, y, pad] of outlineSamples(prop)) best = Math.min(best, projectOnTrack(track, x, y).distance - pad);
  return best;
}

// A copy of the centreline, moved `offset` metres to the right of travel (negative: left).
export function offsetLine(track, offset, from = 0, to = track.length, spacing = 4) {
  const out = [];
  const n = track.points.length;
  for (let s = from; s <= to; s += spacing) {
    const p = track.points[Math.round((((s % track.length) + track.length) % track.length) / track.step) % n];
    out.push([p.x - p.ty * offset, p.y + p.tx * offset]);
  }
  return out;
}

// Trees filling a stand's outline: a jittered grid, with the edge row pulled in so the canopy
// covers the outline (the collider) by about two metres and no more.
export function fillStand(points, rand, { spacing = 8, rMin = 4, rMax = 6.5, tones = 3 } = {}) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const trees = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += spacing) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += spacing * 0.87) {
      const jx = x + (rand() - 0.5) * spacing * 0.7 + ((Math.round(y / spacing) % 2) * spacing) / 2;
      const jy = y + (rand() - 0.5) * spacing * 0.6;
      const r = rMin + rand() * (rMax - rMin);
      const tone = Math.floor(rand() * tones);
      if (insidePolygon(points, jx, jy)) trees.push({ x: jx, y: jy, r, tone });
    }
  }
  // The outline itself: canopies centred just inside every edge, so no collider shows bare.
  points.forEach(([ax, ay], i) => {
    const [bx, by] = points[(i + 1) % points.length];
    const len = Math.hypot(bx - ax, by - ay);
    const ox = (by - ay) / len;   // outward normal (clockwise on screen)
    const oy = -(bx - ax) / len;
    for (let d = 0; d < len; d += spacing * 0.7) {
      const r = rMin + rand() * (rMax - rMin);
      const inset = r - 2;
      trees.push({ x: ax + ((bx - ax) * d) / len - ox * inset, y: ay + ((by - ay) * d) / len - oy * inset, r, tone: Math.floor(rand() * tones) });
    }
  });
  return trees;
}

// --- Solid shapes --------------------------------------------------------------------------------

// Every raised prop's collision shape(s), from its own drawing numbers. `source` is the prop's index.
export function solidShapes(props) {
  const solids = [];
  props.forEach((p, source) => {
    if (!isSolidKind(p.kind)) return;
    const kind = p.kind;
    if (p.w !== undefined) {
      solids.push({ shape: 'box', minX: p.x - p.w / 2, minY: p.y - p.h / 2, maxX: p.x + p.w / 2, maxY: p.y + p.h / 2, kind, source });
    } else if (p.r !== undefined) {
      const radius = p.r * (KINDS[kind].hit ?? 1);
      solids.push({ shape: 'capsule', ax: p.x, ay: p.y, bx: p.x, by: p.y, radius, kind, source });
    } else if (p.width !== undefined) {
      for (let i = 1; i < p.points.length; i += 1) {
        const [ax, ay] = p.points[i - 1];
        const [bx, by] = p.points[i];
        solids.push({ shape: 'capsule', ax, ay, bx, by, radius: p.width / 2, kind, source, piece: i - 1 });
      }
    } else {
      solids.push({ shape: 'poly', points: p.points, kind, source });
    }
  });
  return solids;
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

const BUILDERS = {
  original: buildOriginalScenery,
  switchback: buildSwitchbackScenery,
  'runway-27': buildRunwayScenery,
  'redline-mesa': buildMesaScenery,
  'headland-run': buildHeadlandScenery,
  'nightshift-viaduct': buildNightshiftScenery,
};

// A fresh copy of a circuit's layout (null for a circuit without one). sceneryFor keeps one each.
export function buildScenery(track) {
  if (!track || !BUILDERS[track.id] || track.pad) return null;
  const layout = BUILDERS[track.id](track, {
    seeded, convexHull, roundOutline, fillStand, offsetLine, clearanceOf, insidePolygon,
    isSolidKind, solidShapes, rules: SCENERY_RULES,
  });
  return freezeDeep({ ...layout, id: track.id, solids: solidShapes(layout.props) });
}

// Each circuit's layout, built once per track object. Circuits without one (Dockyard keeps its own,
// dockyard-scenery.js; the practice and gymkhana pads have none) get null.
const cache = new WeakMap();
export function sceneryFor(track) {
  if (!track) return null;
  if (!cache.has(track)) cache.set(track, buildScenery(track));
  return cache.get(track);
}
