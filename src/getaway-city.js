// Getaway Drift's city layouts (EXPERIMENTAL, v0.7.0 R4B research). Pure data and geometry: no
// browser code, so the tests read exactly what is drawn, driven and collided with.
//
// A layout is a street graph on axis-aligned lines:
//   nodes     intersections and street ends, by name: [x, y] in metres (y grows down the screen)
//   streets   [a, b, width] or [a, b, width, { kind }]: a straight street from node a to node b,
//             horizontal or vertical, `width` metres from building wall to building wall
//   lots      extra paved rectangles (yards) { minX, minY, maxX, maxY }
//   props     solid things standing on the pavement (dumpsters, trucks, containers, barriers)
//   blockades a street closed for good: solid barriers and parked police cars across it
//   breakables the two flimsy kinds the car smashes through: fruit stands and wooden barricades
// Everything paved is drivable. Everything else inside the bounds is solid: the buildings are the
// exact complement of the pavement, so a road that is drawn is a road that can be driven, and
// there is no invisible wall anywhere.
import { TUNING } from './tuning.js';

const freeze = (o) => Object.freeze(o);

// --- The two layouts -------------------------------------------------------------------------------
// Downtown: four streets by four, 85-95 m blocks, hard 90-degree corners. Avenues are 20 m wall to
// wall (16 m of road and 2 m sidewalks), side streets 16 m, alleys 10 m.
// Industrial: wider (26 m) streets, warehouse blocks, a container yard, open intersections.
export const CITY_LAYOUTS = freeze({
  downtown: freeze({
    id: 'downtown',
    name: 'Downtown',
    style: 'downtown',
    sidewalk: 2,
    nodes: freeze({
      S: [-95, 225], E: [335, 0],
      A0: [0, 0], A1: [95, 0], A2: [180, 0], AA: [225, 0], A3: [270, 0],
      B0: [0, 75], B1: [95, 75], BA: [137, 75], B2: [180, 75], BB: [225, 75], B3: [270, 75],
      C0: [0, 150], C1: [95, 150], CA: [137, 150], C2: [180, 150], DE: [215, 150], C3: [270, 150],
      D0: [0, 225], D1: [95, 225], D2: [180, 225], D3: [270, 225],
    }),
    streets: freeze([
      // Avenues, 20 m.
      ['S', 'D0', 20], ['D0', 'D1', 20], ['D1', 'D2', 20], ['D2', 'D3', 20],
      ['B0', 'B1', 20], ['B1', 'BA', 20], ['BA', 'B2', 20], ['B2', 'BB', 20], ['BB', 'B3', 20],
      ['D3', 'C3', 20], ['C3', 'B3', 20], ['B3', 'A3', 20], ['A3', 'E', 20],
      // Side streets, 16 m.
      ['A0', 'A1', 16], ['A1', 'A2', 16], ['A2', 'AA', 16], ['AA', 'A3', 16],
      ['C0', 'C1', 16], ['C1', 'CA', 16], ['CA', 'C2', 16],
      ['D0', 'C0', 16], ['C0', 'B0', 16], ['B0', 'A0', 16],
      ['D1', 'C1', 16], ['C1', 'B1', 16], ['B1', 'A1', 16],
      ['D2', 'C2', 16], ['C2', 'B2', 16], ['B2', 'A2', 16],
      // The dead end: row C stops short of column 2's far side. NO EXIT.
      ['C3', 'DE', 16, { kind: 'deadend' }],
      // Alleys, 10 m: one straight through (a dumpster in it), one closed by a wooden barricade.
      ['CA', 'BA', 10, { kind: 'alley' }],
      ['BB', 'AA', 10, { kind: 'alley' }],
    ]),
    // The dead end finishes in a turning bulb, 26 m across: room to try a handbrake turn.
    lots: freeze([freeze({ minX: 202, minY: 137, maxX: 228, maxY: 163, kind: 'bulb' })]),
    props: freeze([
      { kind: 'dumpster', x: 133, y: 112, w: 2, h: 4 },          // in the through alley, against its west wall
      { kind: 'kiosk', x: 7, y: 66, w: 3, h: 3 },                 // a newsstand on a corner sidewalk
      { kind: 'van', x: 47, y: 157, w: 6, h: 2.6 },               // a delivery van at the curb, row C
      { kind: 'dumpster', x: 229, y: 22, w: 2, h: 3.4 },          // in the barricaded alley, past the barricade
      { kind: 'planter', x: 152, y: 218, w: 3, h: 3 },            // a planter on row D's north sidewalk
    ].map(freeze)),
    blockades: freeze([
      // Column 3 closed between B3 and A3: two police cars nose to nose behind concrete blocks.
      { edge: ['B3', 'A3'], at: 30, kind: 'police' },
    ].map(freeze)),
    breakables: freeze([
      { kind: 'barricade', edge: ['BB', 'AA'], at: 40 },
      { kind: 'fruit', x: 102, y: 174, w: 2.6, h: 3 },            // up the street from the left turn at D1, on the sidewalk
      { kind: 'fruit', x: 187, y: 96, w: 2.6, h: 3 },             // outside of the right turn at B2, on the sidewalk
    ].map(freeze)),
    // Cameras: on street from -> to, a fraction of the way along, filming traffic going from -> to.
    cameras: freeze([
      { from: 'D1', to: 'C1', at: 0.47 },
      { from: 'BA', to: 'B2', at: 0.55 },
      { from: 'B2', to: 'C2', at: 0.5 },
      { from: 'D3', to: 'C3', at: 0.5 },
    ].map(freeze)),
    exit: freeze({ from: 'A3', to: 'E', at: 0.55 }),
    start: freeze({ node: 'S', toward: 'D0', offset: 30 }),
    signs: freeze([
      { text: 'NO EXIT', x: 258, y: 150, toward: 'DE' },
      { text: 'ROAD CLOSED', x: 270, y: 92, toward: 'A3' },
    ].map(freeze)),
    margin: 30,
  }),

  industrial: freeze({
    id: 'industrial',
    name: 'Industrial',
    style: 'industrial',
    sidewalk: 0,
    nodes: freeze({
      S: [-90, 330], X: [0, 400],
      N00: [0, 0], N10: [120, 0], N20: [240, 0], N30: [360, 0],
      L1: [120, 55], L2: [240, 55],
      N01: [0, 110], N11: [120, 110], N21: [240, 110], N31: [360, 110],
      DK: [305, 165], K3: [360, 165],
      N02: [0, 220], N12: [120, 220], N22: [240, 220], N32: [360, 220],
      N03: [0, 330], N13: [120, 330], N23: [240, 330], N33: [360, 330],
    }),
    streets: freeze([
      ['S', 'N03', 26], ['N03', 'N13', 26], ['N13', 'N23', 26], ['N23', 'N33', 26],
      ['N00', 'N10', 26], ['N10', 'N20', 26], ['N20', 'N30', 26],
      ['N01', 'N11', 26], ['N11', 'N21', 26], ['N21', 'N31', 26],
      ['N02', 'N12', 26], ['N12', 'N22', 44, { kind: 'yard' }], ['N22', 'N32', 26],
      ['N00', 'N01', 26], ['N01', 'N02', 26], ['N02', 'N03', 26], ['N03', 'X', 26],
      ['N10', 'L1', 26], ['L1', 'N11', 26], ['N11', 'N12', 26], ['N12', 'N13', 26],
      ['N20', 'L2', 26], ['L2', 'N21', 26], ['N21', 'N22', 26], ['N22', 'N23', 26],
      ['N30', 'N31', 26], ['N31', 'K3', 26], ['K3', 'N32', 26], ['N32', 'N33', 26],
      // A narrow service lane through warehouse block, closed by a wooden barricade.
      ['L2', 'L1', 14, { kind: 'lane' }],
      // A loading dock: a dead-end bay into the block east of the yard.
      ['K3', 'DK', 20, { kind: 'deadend' }],
    ]),
    // The loading bay's far end: a 30 m apron to turn a truck, or a car, round in.
    lots: freeze([freeze({ minX: 290, minY: 150, maxX: 320, maxY: 180, kind: 'bulb' })]),
    props: freeze([
      // The container yard (row 2 between N12 and N22, 44 m wide): stacks along both sides and two
      // staggered islands, so the straight line through it has to weave.
      { kind: 'container', x: 152, y: 208, w: 14, h: 12 },
      { kind: 'container', x: 205, y: 232, w: 14, h: 12 },
      { kind: 'container', x: 178, y: 200, w: 12, h: 2.6, color: 1 },
      // Parked trucks and trailers on the wide streets, at the curb.
      { kind: 'truck', x: 180, y: 320, w: 16, h: 4 },
      { kind: 'truck', x: 60, y: 9, w: 15, h: 4 },
      { kind: 'trailer', x: 300, y: 121, w: 14, h: 3.6 },
      // A chicane of concrete barriers down column 0, between N02 and N03.
      { kind: 'barrier', x: -8, y: 255, w: 10, h: 1.6 },
      { kind: 'barrier', x: 8, y: 290, w: 10, h: 1.6 },
      // Loading-dock clutter: pallets and a forklift-sized crate stack beside the bay.
      { kind: 'crates', x: 318, y: 158, w: 3, h: 3 },
      { kind: 'dumpster', x: 131, y: 160, w: 2, h: 3.4 },
    ].map(freeze)),
    blockades: freeze([
      // Row 1 closed between N11 and N21: two police cars across it behind concrete blocks.
      { edge: ['N21', 'N11'], at: 30, kind: 'police' },
    ].map(freeze)),
    breakables: freeze([
      { kind: 'barricade', edge: ['L2', 'L1'], at: 60 },
      { kind: 'fruit', x: 185, y: 239.5, w: 3, h: 2.4 },         // a dockside stall on the yard's far edge
    ].map(freeze)),
    cameras: freeze([
      { from: 'N03', to: 'N13', at: 0.5 },
      { from: 'N22', to: 'N21', at: 0.5 },
      { from: 'N10', to: 'N00', at: 0.5 },
      { from: 'N01', to: 'N02', at: 0.5 },
    ].map(freeze)),
    exit: freeze({ from: 'N03', to: 'X', at: 0.5 }),
    start: freeze({ node: 'S', toward: 'N03', offset: 30 }),
    signs: freeze([
      { text: 'NO EXIT', x: 360, y: 150, toward: 'DK' },
      { text: 'ROAD CLOSED', x: 226, y: 110, toward: 'N11' },
    ].map(freeze)),
    margin: 34,
  }),
});

// --- Geometry ----------------------------------------------------------------------------------------
const rect = (minX, minY, maxX, maxY, extra = {}) => ({ minX, minY, maxX, maxY, ...extra });
export const insideRect = (r, x, y, pad = 0) => x >= r.minX - pad && x <= r.maxX + pad && y >= r.minY - pad && y <= r.maxY + pad;

// The cells of the bounds that no paved rectangle covers, merged into as few boxes as possible.
function complement(bounds, rects) {
  const xs = [...new Set([bounds.minX, bounds.maxX, ...rects.flatMap((r) => [r.minX, r.maxX])])]
    .filter((v) => v >= bounds.minX && v <= bounds.maxX).sort((a, b) => a - b);
  const ys = [...new Set([bounds.minY, bounds.maxY, ...rects.flatMap((r) => [r.minY, r.maxY])])]
    .filter((v) => v >= bounds.minY && v <= bounds.maxY).sort((a, b) => a - b);
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const paved = new Uint8Array(nx * ny);
  for (const r of rects) {
    for (let j = 0; j < ny; j += 1) {
      const cy = (ys[j] + ys[j + 1]) / 2;
      if (cy < r.minY || cy > r.maxY) continue;
      for (let i = 0; i < nx; i += 1) {
        const cx = (xs[i] + xs[i + 1]) / 2;
        if (cx >= r.minX && cx <= r.maxX) paved[j * nx + i] = 1;
      }
    }
  }
  const out = [];
  let open = new Map();   // "i0,i1" -> box growing downward
  for (let j = 0; j < ny; j += 1) {
    const next = new Map();
    let i = 0;
    while (i < nx) {
      if (paved[j * nx + i]) { i += 1; continue; }
      const i0 = i;
      while (i < nx && !paved[j * nx + i]) i += 1;
      const key = `${i0},${i}`;
      const box = open.get(key);
      if (box) { box.maxY = ys[j + 1]; next.set(key, box); open.delete(key); }
      else next.set(key, rect(xs[i0], ys[j], xs[i], ys[j + 1]));
    }
    for (const box of open.values()) out.push(box);
    open = next;
  }
  for (const box of open.values()) out.push(box);
  return out;
}

// Breaks are cut across a street, wall to wall: a box `depth` deep at `at` metres from `from`.
function acrossEdge(e, at, depth) {
  const cx = e.ax + e.dx * at;
  const cy = e.ay + e.dy * at;
  return e.horizontal
    ? rect(cx - depth / 2, cy - e.half, cx + depth / 2, cy + e.half)
    : rect(cx - e.half, cy - depth / 2, cx + e.half, cy + depth / 2);
}

// Distance from a point to a segment, and the nearest point on it.
function nearestOnSegment(ax, ay, bx, by, x, y) {
  const ex = bx - ax;
  const ey = by - ay;
  const len2 = ex * ex + ey * ey;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / len2)) : 0;
  const qx = ax + ex * t;
  const qy = ay + ey * t;
  return { t, x: qx, y: qy, d: Math.hypot(x - qx, y - qy) };
}

// Does the segment (ax, ay)-(bx, by) pass through the box (grown by `pad`)? The slab test.
export function segmentHitsBox(ax, ay, bx, by, b, pad = 0) {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  for (const [p, d, lo, hi] of [[ax, dx, b.minX - pad, b.maxX + pad], [ay, dy, b.minY - pad, b.maxY + pad]]) {
    if (Math.abs(d) < 1e-12) { if (p < lo || p > hi) return false; continue; }
    let ta = (lo - p) / d;
    let tb = (hi - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

// The props' sizes and whether they stop a line of sight (a person sees over a barrier or a car).
const TALL = new Set(['building', 'warehouse', 'container', 'truck', 'trailer', 'van', 'kiosk', 'crates']);

// Build a layout's whole geometry once: the graph, the pavement, the solids, the cameras.
export function buildCity(layout, T = TUNING) {
  const nodes = {};
  for (const [id, [x, y]] of Object.entries(layout.nodes)) nodes[id] = { id, x, y, edges: [], half: 0 };
  const edges = layout.streets.map(([a, b, width, extra = {}], index) => {
    const A = nodes[a];
    const B = nodes[b];
    if (!A || !B) throw new Error(`street ${a}-${b}: unknown node`);
    if (A.x !== B.x && A.y !== B.y) throw new Error(`street ${a}-${b} is not axis-aligned`);
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    const e = {
      index, id: `${a}-${b}`, a, b, ax: A.x, ay: A.y, bx: B.x, by: B.y,
      dx: (B.x - A.x) / len, dy: (B.y - A.y) / len, len, width, half: width / 2,
      horizontal: A.y === B.y, kind: extra.kind ?? (width >= 20 ? 'avenue' : 'street'),
      sidewalk: extra.kind === 'alley' || extra.kind === 'lane' || extra.kind === 'yard' ? 0 : layout.sidewalk,
      blockAt: null, blockKind: null, barricade: null,
    };
    A.edges.push(index);
    B.edges.push(index);
    A.half = Math.max(A.half, e.half);
    B.half = Math.max(B.half, e.half);
    return e;
  });
  const byNodes = new Map();
  for (const e of edges) { byNodes.set(`${e.a}|${e.b}`, e); byNodes.set(`${e.b}|${e.a}`, e); }
  const edgeBetween = (a, b) => {
    const e = byNodes.get(`${a}|${b}`);
    if (!e) throw new Error(`no street ${a}-${b}`);
    return e;
  };
  // A distance measured from `from` along the street from..to, as the street's own parameter.
  const paramFrom = (e, from, d) => (e.a === from ? d : e.len - d);

  // The pavement: every street's rectangle, every node's square, every lot.
  const streetRect = (e) => (e.horizontal
    ? rect(Math.min(e.ax, e.bx), e.ay - e.half, Math.max(e.ax, e.bx), e.ay + e.half)
    : rect(e.ax - e.half, Math.min(e.ay, e.by), e.ax + e.half, Math.max(e.ay, e.by)));
  const paved = [
    ...edges.map((e) => ({ ...streetRect(e), edge: e.index })),
    ...Object.values(nodes).map((n) => rect(n.x - n.half, n.y - n.half, n.x + n.half, n.y + n.half, { node: n.id })),
    ...layout.lots.map((l) => rect(l.minX, l.minY, l.maxX, l.maxY, { lot: true })),
  ];
  const xs = Object.values(nodes).map((n) => n.x);
  const ys = Object.values(nodes).map((n) => n.y);
  const m = layout.margin;
  const bounds = freeze({ minX: Math.min(...xs) - m, maxX: Math.max(...xs) + m, minY: Math.min(...ys) - m, maxY: Math.max(...ys) + m });
  const buildingKind = layout.style === 'industrial' ? 'warehouse' : 'building';
  const buildings = complement(bounds, paved).map((b, i) => freeze({ ...b, kind: buildingKind, source: `block ${i}`, tall: true }));

  // Solid props on the pavement.
  const props = layout.props.map((p, i) => freeze({
    minX: p.x - p.w / 2, minY: p.y - p.h / 2, maxX: p.x + p.w / 2, maxY: p.y + p.h / 2,
    kind: p.kind, source: `prop ${i}`, color: p.color ?? i, tall: TALL.has(p.kind),
  }));

  // Blockades: a street closed for good, wall to wall, at `at` metres from its first named node.
  const blockades = layout.blockades.map((bl, i) => {
    const e = edgeBetween(bl.edge[0], bl.edge[1]);
    const at = paramFrom(e, bl.edge[0], bl.at);
    e.blockAt = at;
    e.blockKind = 'blockade';
    const box = acrossEdge(e, at, 4);
    return freeze({ ...box, kind: 'blockade', source: `blockade ${i}`, edge: e.index, at, tall: false, horizontal: e.horizontal,
      cx: e.ax + e.dx * at, cy: e.ay + e.dy * at, dx: e.dx, dy: e.dy, half: e.half });
  });

  // The breakables. A barricade closes its street (wall to wall) until it is smashed.
  const breakables = layout.breakables.map((br, i) => {
    let box;
    let edge = null;
    let at = null;
    if (br.edge) {
      const e = edgeBetween(br.edge[0], br.edge[1]);
      at = paramFrom(e, br.edge[0], br.at);
      e.barricade = i;
      e.barricadeAt = at;
      edge = e.index;
      box = acrossEdge(e, at, 1.2);
    } else box = rect(br.x - br.w / 2, br.y - br.h / 2, br.x + br.w / 2, br.y + br.h / 2);
    return freeze({ ...box, kind: br.kind, index: i, edge, at, horizontal: edge === null ? null : edges[edge].horizontal,
      cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2 });
  });

  // The solid colliders the session uses (obstacles.js boxes). Breakables are not among them: the
  // challenge handles those itself, because they break instead of stopping the car.
  const colliders = freeze([...buildings, ...props, ...blockades]);
  const sightBlockers = freeze(colliders.filter((c) => c.tall));

  // A camera or the escape gate: a line across the street, wall to wall, facing from -> to.
  const gateOn = (spec, kind, number) => {
    const e = edgeBetween(spec.from, spec.to);
    const sign = e.a === spec.from ? 1 : -1;
    const at = e.a === spec.from ? spec.at * e.len : (1 - spec.at) * e.len;
    const cx = e.ax + e.dx * at;
    const cy = e.ay + e.dy * at;
    const tx = e.dx * sign;
    const ty = e.dy * sign;
    const half = e.half;
    return freeze({
      kind, number, edge: e.index, at, sign, from: spec.from, to: spec.to,
      cx, cy, tx, ty, half, x1: cx - ty * half, y1: cy + tx * half, x2: cx + ty * half, y2: cy - tx * half,
    });
  };
  const cameras = freeze(layout.cameras.map((c, i) => {
    const gate = gateOn(c, 'camera', i + 1);
    const e = edges[gate.edge];
    // The tripod stands on the sidewalk on the driver's right, a little before the band.
    const side = 1;
    const off = e.half - 1.2;
    const x = gate.cx - gate.tx * 3 - gate.ty * off * side;
    const y = gate.cy - gate.ty * 3 + gate.tx * off * side;
    return freeze({ ...gate, gate, x, y, aim: Math.atan2(gate.cy - y, gate.cx - x) });
  }));
  const exit = gateOn(layout.exit, 'exit', 0);

  // The start: on the first street, `offset` metres in from its end, facing along it.
  const s0 = nodes[layout.start.node];
  const s1 = nodes[layout.start.toward];
  const sl = Math.hypot(s1.x - s0.x, s1.y - s0.y);
  const sdx = (s1.x - s0.x) / sl;
  const sdy = (s1.y - s0.y) / sl;
  const start = freeze({ x: s0.x + sdx * layout.start.offset, y: s0.y + sdy * layout.start.offset, heading: Math.atan2(sdy, sdx) });

  for (const n of Object.values(nodes)) { n.edges = freeze(n.edges); freeze(n); }
  edges.forEach(freeze);
  const city = {
    id: layout.id, name: layout.name, style: layout.style, sidewalk: layout.sidewalk, layout,
    nodes: freeze(nodes), edges: freeze(edges), paved: freeze(paved.map(freeze)), bounds,
    buildings: freeze(buildings), props: freeze(props), blockades: freeze(blockades), breakables: freeze(breakables),
    colliders, sightBlockers, cameras, exit, start, signs: layout.signs, carRadius: T.carRadius,
    edgeBetween: (a, b) => byNodes.get(`${a}|${b}`) ?? null,
  };
  return freeze(city);
}

// --- Questions the challenge, the pursuer and the HUD ask ----------------------------------------------

// Is (x, y) on the pavement?
export function onPavement(city, x, y, pad = 0) {
  return city.paved.some((r) => insideRect(r, x, y, pad));
}

// Where a point is on the street network: the street it is on, how far along, how far off its
// centre line. `prefer` keeps the street the car was on while it is still inside it, so the answer
// does not flicker in the middle of a junction.
export function locate(city, x, y, prefer = -1) {
  const place = (e) => {
    const t = (x - e.ax) * e.dx + (y - e.ay) * e.dy;
    const offset = -(x - e.ax) * e.dy + (y - e.ay) * e.dx;
    const outLength = t < 0 ? -t : t > e.len ? t - e.len : 0;
    const outSide = Math.max(0, Math.abs(offset) - e.half);
    return { edge: e.index, t: Math.max(0, Math.min(e.len, t)), offset, outside: Math.hypot(outLength, outSide) };
  };
  if (prefer >= 0) {
    const p = place(city.edges[prefer]);
    if (p.outside === 0) return p;
  }
  let best = null;
  for (const e of city.edges) {
    const p = place(e);
    if (!best || p.outside < best.outside - 1e-9 || (Math.abs(p.outside - best.outside) <= 1e-9 && Math.abs(p.offset) < Math.abs(best.offset))) best = p;
  }
  return best;
}

// Can one see from a to b? Only tall things (buildings, containers, trucks) block it.
export function lineOfSight(city, ax, ay, bx, by) {
  for (const b of city.sightBlockers) if (segmentHitsBox(ax, ay, bx, by, b, -0.3)) return false;
  return true;
}

// --- Routing ------------------------------------------------------------------------------------------
// Shortest paths on the street graph. A blockade closes its street at the blockade (each side is
// still reachable from its own end, as a dead end). An intact barricade closes its street the same
// way until it is smashed (`broken[i]`); `throughBarricades` treats every barricade as open.

// Which ends of street e a point at parameter t can drive to directly.
function reachableEnds(e, t, broken, throughBarricades) {
  const cuts = [];
  if (e.blockAt !== null) cuts.push(e.blockAt);
  if (e.barricade !== null && !throughBarricades && !broken?.[e.barricade]) cuts.push(e.barricadeAt);
  let toA = true;
  let toB = true;
  for (const c of cuts) { if (t > c) toA = false; else toB = false; }
  return { toA, toB };
}
// Narrow streets (14 m or less: the alleys and the service lane) cost a little more to plan through than their length
// (`narrowCost`, 1.3): the guidance and the police prefer a real street when the two are about the same.
export const polylineLength = (pts) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
const edgeOpen = (e, broken, throughBarricades) => e.blockAt === null
  && (e.barricade === null || throughBarricades || !!broken?.[e.barricade]);

// From a place on the network to another: { length, points: [[x, y], ...] } or null.
// Optional HUD route preference (R4C), absent for police and R4B comparisons.
// Favoured streets cost favourFactor of their length; the initial street cannot
// be traversed again to manufacture a junction-and-back reversal.
export function route(city, from, to, { broken = null, throughBarricades = false, narrowCost = 1.3, exclude = -1, favour = null, favourFactor = 1 } = {}) {
  const ef = city.edges[from.edge];
  const et = city.edges[to.edge];
  const pf = [ef.ax + ef.dx * from.t, ef.ay + ef.dy * from.t];
  const pt = [et.ax + et.dx * to.t, et.ay + et.dy * to.t];
  // The same street, nothing between: straight there.
  if (from.edge === to.edge) {
    const ends = reachableEnds(ef, Math.min(from.t, to.t) + 1e-6, broken, throughBarricades);
    const lo = Math.min(from.t, to.t);
    const hi = Math.max(from.t, to.t);
    const cutBetween = [ef.blockAt, ef.barricade !== null && !throughBarricades && !broken?.[ef.barricade] ? ef.barricadeAt : null]
      .some((c) => c !== null && c > lo && c < hi);
    if (!cutBetween && ends) return { length: hi - lo, points: [pf, pt] };
  }
  const ids = Object.keys(city.nodes);
  const dist = new Map(ids.map((id) => [id, Infinity]));
  const prev = new Map();
  const done = new Set();
  const startEnds = reachableEnds(ef, from.t, broken, throughBarricades);
  if (startEnds.toA) dist.set(ef.a, from.t);
  if (startEnds.toB) dist.set(ef.b, Math.min(dist.get(ef.b), ef.len - from.t));
  for (;;) {
    let u = null;
    let du = Infinity;
    for (const id of ids) if (!done.has(id) && dist.get(id) < du) { du = dist.get(id); u = id; }
    if (u === null) break;
    done.add(u);
    for (const ei of city.nodes[u].edges) {
      const e = city.edges[ei];
      if (ei === exclude || (favour && ei === from.edge) || !edgeOpen(e, broken, throughBarricades)) continue;
      const v = e.a === u ? e.b : e.a;
      const cost = du + e.len * (e.width <= 14 ? narrowCost : 1) * (favour?.has(ei) ? favourFactor : 1);
      if (cost < dist.get(v)) { dist.set(v, cost); prev.set(v, u); }
    }
  }
  const endEnds = reachableEnds(et, to.t, broken, throughBarricades);
  // A destination on the excluded street is only reached at its own end, never along the street.
  if (to.edge === exclude) { endEnds.toA = endEnds.toA && to.t < 1e-6; endEnds.toB = endEnds.toB && to.t > et.len - 1e-6; }
  let bestEnd = null;
  let best = Infinity;
  if (endEnds.toA && dist.get(et.a) + to.t < best) { best = dist.get(et.a) + to.t; bestEnd = et.a; }
  if (endEnds.toB && dist.get(et.b) + et.len - to.t < best) { best = dist.get(et.b) + et.len - to.t; bestEnd = et.b; }
  if (bestEnd === null || !Number.isFinite(best)) return null;
  const chain = [];
  for (let n = bestEnd; n !== undefined; n = prev.get(n)) chain.unshift(n);
  const points = [pf, ...chain.map((id) => [city.nodes[id].x, city.nodes[id].y]), pt];
  return { length: polylineLength(points), cost: best, points, nodes: chain };
}

// A gate (camera or exit) is reached from its own approach side: a point `lead` metres before it
// on its street, then through it.
export function gateApproach(city, gate, lead = 18) {
  const e = city.edges[gate.edge];
  const t = Math.max(0, Math.min(e.len, gate.at - gate.sign * Math.min(lead, gate.sign > 0 ? gate.at : e.len - gate.at)));
  return { edge: gate.edge, t };
}

// The route a driver should take to cross `gate` forwards from where they are. Already on the
// gate's street and short of it: straight on. Otherwise: round to the junction the gate's street
// starts from (not back through the gate's own band, the wrong way: round the block instead,
// when there is a way round), then along the street through it.
export function routeToGate(city, from, gate, options = {}) {
  const e = city.edges[gate.edge];
  const through = [gate.cx + gate.tx * 6, gate.cy + gate.ty * 6];
  if (from.edge === gate.edge && (gate.at - from.t) * gate.sign > 2) {
    const r = route(city, from, { edge: gate.edge, t: gate.at }, options);
    if (r) return { ...r, points: [...r.points.slice(0, -1), through] };
  }
  const entry = { edge: gate.edge, t: gate.sign > 0 ? 0 : e.len };
  const r = route(city, from, entry, { ...options, exclude: from.edge === gate.edge ? -1 : gate.edge })
    ?? route(city, from, entry, options);
  if (!r) return null;
  // Round the block onto the gate's own street from its entry junction.
  const viaOwn = from.edge === gate.edge ? route(city, from, entry, { ...options, exclude: gate.edge }) : null;
  const best = viaOwn ?? r;
  return { length: best.length + Math.abs(gate.at - entry.t) + 6, points: [...best.points, through], nodes: best.nodes, edge: e.index };
}

// A route's corners rounded into arcs a car can drive: at each junction, as wide a circle as the
// corner allows (`factor` x the narrower street's width, but always clearing the inside building
// corner by a car's radius and a margin, and never longer than the legs beside it). Returns the
// points, and for each the radius of the arc it lies on (Infinity on a straight).
export function roundCorners(city, pts, { factor = 1.2, max = Infinity, step = 3 } = {}) {
  const out = [pts[0]];
  const radii = [Infinity];
  const widthNear = (x, y) => city.edges[locate(city, x, y).edge].width;
  let cur = pts[0];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    const turn = Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1));
    const abs = Math.min(Math.abs(turn), 170 * Math.PI / 180);
    if (abs < 0.05) continue;
    const l1 = Math.hypot(b[0] - cur[0], b[1] - cur[1]);
    const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const w = Math.min(widthNear((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), widthNear((b[0] + c[0]) / 2, (b[1] + c[1]) / 2));
    let R = Math.min(factor * w, max, (Math.SQRT2 * (w / 2) - 2.7) / (Math.SQRT2 - 1));
    const room = 0.48 * Math.min(l1, l2);
    if (R * Math.tan(abs / 2) > room) R = room / Math.tan(abs / 2);
    const tan = R * Math.tan(abs / 2);
    const sx = b[0] - Math.cos(h1) * tan;
    const sy = b[1] - Math.sin(h1) * tan;
    out.push([sx, sy]);
    radii.push(R);
    const n = Math.max(2, Math.ceil((abs * R) / step));
    const k = Math.sign(turn);
    const cx = sx + Math.cos(h1 + k * Math.PI / 2) * R;
    const cy = sy + Math.sin(h1 + k * Math.PI / 2) * R;
    for (let j = 1; j <= n; j += 1) {
      const ang = h1 - k * Math.PI / 2 + k * abs * (j / n);
      out.push([cx + Math.cos(ang) * R, cy + Math.sin(ang) * R]);
      radii.push(j === n ? Infinity : R);
    }
    cur = out[out.length - 1];
  }
  out.push(pts[pts.length - 1]);
  radii.push(Infinity);
  return { points: out, radii };
}

// --- Checks the tests run -------------------------------------------------------------------------------
// Is the middle of every open street clear of solid props by at least `clearance`? (The buildings
// are the complement of the pavement, so they can't be in a street.)
export function streetClearance(city) {
  let worst = Infinity;
  let where = null;
  for (const e of city.edges) {
    for (const p of [...city.props, ...city.blockades]) {
      if (p.kind === 'blockade' && p.edge === e.index) continue;
      // Sample the centre line.
      for (let d = 0; d <= e.len; d += 1) {
        const x = e.ax + e.dx * d;
        const y = e.ay + e.dy * d;
        const cx = Math.max(p.minX, Math.min(p.maxX, x));
        const cy = Math.max(p.minY, Math.min(p.maxY, y));
        const gap = Math.hypot(x - cx, y - cy);
        if (gap < worst) { worst = gap; where = { street: e.id, prop: p.source, kind: p.kind, x, y }; }
      }
    }
  }
  return { worst, where };
}

export { nearestOnSegment };
