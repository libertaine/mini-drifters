// Switchback: a driving course cut into a wooded hillside. World metres; see scenery.js for the
// shapes and rules. The perimeter wall (track.bounds) is about x -249..212, y -175..316; anything
// built against it is placed from the real bounds. Every reachable solid stays 24 m or more from the
// centreline.
//
//   The hill rises to the north-east. The switchbacks run along its face: retaining walls hold the
//     slope back on the outside of each right-hander, with bare earth, boulders and pines above.
//   The inside of the lap is the wooded valley floor: stands of broadleaf trees around a clearing
//     with a ranger's cabin, and a dry wash that drains south under the bottom straight.
//   Gravel shoulders and a drainage ditch line the road. They are drawn as gravel and drive as the
//     existing off-road surface (grass physics), which already slows the car and throws dust.
//   The perimeter is a guardrail. Warning signs and the tight right's chevrons stand against it or
//     well clear of the road; a scenic overlook sits beyond the east guardrail.

export function buildSwitchbackScenery(track, h) {
  const rand = h.seeded(2207);
  const WALL = track.bounds;
  const props = [];
  const add = (p) => { props.push(p); return p; };
  const solids = () => props.filter((p) => SOLID.has(p.kind));
  // Room to stand a new solid: clear of the road, and either touching or 7 m from every other solid
  // and from the perimeter wall (a seeded scatter simply skips a spot that fails).
  const fits = (p, clearance) => {
    if (h.clearanceOf(track, p) < clearance) return false;
    const reach = (p.r ?? 0) * (HIT[p.kind] ?? 1); // the collider's radius, as scenery.js KINDS
    const wallGap = Math.min(p.x - reach - WALL.minX, WALL.maxX - p.x - reach, p.y - reach - WALL.minY, WALL.maxY - p.y - reach);
    if (wallGap > 0 && wallGap < h.rules.gap) return false;
    return solids().every((q) => {
      const g = gapApprox(p, q);
      return g >= h.rules.gap;
    });
  };

  // --- Ground -------------------------------------------------------------------------------------
  // The dry wash: from the clearing, south under the bottom straight, out through the south guardrail.
  add({ kind: 'wash', points: [[-40, 50], [-58, 74], [-74, 104], [-72, 140], [-80, 172], [-84, 210], [-76, 250], [-88, 290], [-82, 340]], width: 5 });
  add({ kind: 'meadow', points: h.roundOutline(h.convexHull([[-60, 6], [10, 0], [30, 30], [20, 84], [-30, 86], [-66, 50]]), 3) });
  // The overlook, beyond the east guardrail: a gravel lay-by on the brow of the hill.
  add({ kind: 'paved', points: [[218, 46], [244, 40], [252, 100], [222, 104]] });

  // --- The hillside: retaining walls on the outside of the switchbacks ------------------------------
  // Traced 32 m to the left of the centreline (the hill side) from the top straight to the east
  // straight. Kept only beside right-handers and straights, where the hill is on the outside of the
  // turn, and only where the line stays 30.5 m from every part of the lap. On the inside of a
  // left-hander it would curl into a pocket, so it stops there.
  const { points: lap, step } = track;
  const bendAt = (i) => {
    let k = 0;
    for (let d = -15; d <= 15; d += 1) k += lap[(i + d + lap.length) % lap.length].curvature;
    return k / 31;
  };
  const runs = [];
  let run = [];
  for (let at = 300; at <= 770; at += 3) {
    const i = Math.round(at / step) % lap.length;
    const q = lap[i];
    const p = [q.x + q.ty * 32, q.y - q.tx * 32];
    const clear = bendAt(i) > -0.002 && h.clearanceOf(track, { x: p[0], y: p[1], r: 0.8 }) >= 30.5;
    if (clear) run.push(p);
    else { if (run.length) runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  for (const r of runs) {
    // Short stubs read as debris, not walls.
    const length = r.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - r[i][0], p[1] - r[i][1]), 0);
    if (length < 24) continue;
    const points = r.filter((_, i) => i % 2 === 0 || i === r.length - 1);
    // Bare earth above the wall: the cut the road was made in.
    add({ kind: 'earth', points: shift(points, track, -4.5), width: 10 });
    add({ kind: 'retaining', points, width: 1.6 });
  }

  // --- Signs --------------------------------------------------------------------------------------
  add({ kind: 'sign', x: -122, y: -153, w: 3.2, h: 3.2, glyph: 'winding' });
  add({ kind: 'sign', x: 190, y: 196, w: 3.2, h: 3.2, glyph: 'right' });
  add({ kind: 'chevron', x: WALL.maxX - 0.8, y: 256, w: 2.4, h: 56, point: 'west' });
  add({ kind: 'chevron', x: 140, y: WALL.maxY - 0.8, w: 52, h: 2.4, point: 'north' });

  // --- The valley floor: woodland stands around a clearing -----------------------------------------
  const stands = [
    [[-170, -84], [-112, -92], [-94, -88], [-88, -54], [-118, -32], [-170, -32]],
    [[-170, -16], [-112, -18], [-96, 26], [-118, 68], [-170, 70]],
    [[-170, 90], [-102, 86], [-84, 120], [-98, 160], [-150, 162], [-170, 140]],
    [[-56, 96], [0, 86], [28, 104], [20, 150], [-18, 162], [-52, 150]],
    // The south-east woods are two stands either side of a ride: the open line from the end of the
    // switchbacks to the left flick, so a car that cuts across (and voids its lap) isn't walled in.
    [[50, 128], [100, 126], [122, 138], [96, 170], [60, 186]],
    [[137, 182], [137, 212], [114, 216], [121, 200]],
    [[-80, 0], [-56, 8], [-58, 34], [-80, 38]],
  ];
  stands.forEach((pts, i) => {
    const points = h.convexHull(h.roundOutline(h.convexHull(pts)));
    add({ kind: 'stand', points, trees: h.fillStand(points, h.seeded(500 + i), { spacing: 7, rMin: 3.8, rMax: 6.2 }) });
  });
  add({ kind: 'cabin', x: -14, y: 40, w: 11, h: 8 });
  add({ kind: 'bench', x: 8, y: 52, w: 3.2, h: 1.2 });
  add({ kind: 'bench', x: -10, y: 62, w: 3.2, h: 1.2 });

  // An outcrop on the hill, between the switchbacks and the north guardrail.
  add({ kind: 'outcrop', points: h.convexHull([[44, -74], [66, -82], [82, -66], [74, -50], [52, -52]]) });
  add({ kind: 'outcrop', points: h.convexHull([[-34, -150], [-14, -156], [-2, -140], [-14, -128], [-32, -134]]) });

  // --- Boulders and pines on the hill, inside the guardrail -----------------------------------------
  for (let x = WALL.minX + 10; x < WALL.maxX; x += 15) {
    for (let y = WALL.minY + 10; y < WALL.maxY; y += 15) {
      const px = x + (rand() - 0.5) * 11;
      const py = y + (rand() - 0.5) * 11;
      const side = sideOf(track, px, py);
      if (side >= 0) { rand(); rand(); continue; } // the valley side is woodland, done above
      const pine = rand() < 0.62;
      const r = pine ? 3 + rand() * 1.8 : 1.6 + rand() * 1.6;
      const p = pine ? { kind: 'pine', x: px, y: py, r, tone: Math.floor(rand() * 3) } : { kind: 'rock', x: px, y: py, r, seed: Math.floor(rand() * 1e6) };
      if (fits(p, pine ? 34 : 32)) add(p);
    }
  }

  // --- Beyond the guardrail: forest all round, pines up the hill, broadleaf down in the valley -------
  const overlook = props.find((p) => p.kind === 'paved');
  const ring = { minX: WALL.minX - 110, maxX: WALL.maxX + 110, minY: WALL.minY - 110, maxY: WALL.maxY + 110 };
  for (let x = ring.minX; x < ring.maxX; x += 9) {
    for (let y = ring.minY; y < ring.maxY; y += 8.5) {
      const tx = x + (rand() - 0.5) * 8;
      const ty = y + (rand() - 0.5) * 8;
      const hill = (tx - 30) * 0.768 - (ty - 40) * 0.641 > 60;
      const pine = rand() < (hill ? 0.8 : 0.3);
      const r = pine ? 3 + rand() * 2 : 3.8 + rand() * 2.8;
      const beyond = tx < WALL.minX - r - 2 || tx > WALL.maxX + r + 2 || ty < WALL.minY - r - 2 || ty > WALL.maxY + r + 2;
      const inOverlook = h.insidePolygon(overlook.points, tx, ty) || (tx > 212 && tx < 262 && ty > 30 && ty < 114);
      const keep = rand() < 0.88;
      if (beyond && keep && !inOverlook) add({ kind: pine ? 'pine' : 'tree', x: tx, y: ty, r, tone: Math.floor(rand() * 3) });
    }
  }
  for (let i = 0; i < 26; i += 1) {
    const tx = WALL.maxX + 6 + rand() * 90;
    const ty = WALL.minY - 100 + rand() * 250;
    if (!(tx > 212 && tx < 262 && ty > 30 && ty < 114)) add({ kind: 'rock', x: tx, y: ty, r: 1.8 + rand() * 3, seed: Math.floor(rand() * 1e6) });
  }
  add({ kind: 'fence', points: [[250, 44], [256, 98]], width: 0.4 });
  add({ kind: 'bench', x: 244, y: 62, w: 1.2, h: 3.2 });
  add({ kind: 'car', x: 232, y: 82, w: 2.3, h: 4.6, color: '#d6a531' });
  add({ kind: 'sign', x: 230, y: 52, w: 3.2, h: 2.2, glyph: 'view' });

  return {
    props,
    style: 'hillside',
    wall: 'guardrail',
    shoulder: 15,
    // The hill: rises to the north-east across the line of the switchbacks, with a crest in the
    // north-east corner and the valley floor inside the lap. Contours only; the ground is flat.
    elevation: { origin: [30, 40], dir: [0.768, -0.641], grade: 0.1, interval: 2.5,
      bumps: [[150, -110, 9, 80], [-90, 60, -3, 70], [-210, -140, 4, 60], [40, 200, -2.5, 60]],
      waves: [[1.6, 0.021, 0.013, 0.4], [1.1, -0.011, 0.027, 2.1], [0.7, 0.043, -0.019, 4.0]] },
  };
}

const HIT = { pine: 0.5, rock: 0.85, tree: 0.55 };
const SOLID = new Set(['tree', 'pine', 'rock', 'retaining', 'stand', 'outcrop', 'cabin', 'bench', 'sign', 'chevron']);

// Which side of the lap a point is on: positive on the right of travel (the valley inside the lap).
function sideOf(track, x, y) {
  let best = Infinity;
  let side = 0;
  for (const p of track.points) {
    const d = (x - p.x) ** 2 + (y - p.y) ** 2;
    if (d < best) { best = d; side = (x - p.x) * -p.ty + (y - p.y) * p.tx; }
  }
  return side;
}

// A polyline pushed `by` metres to the right of travel (negative: left) of its nearest lap point.
function shift(points, track, by) {
  return points.map(([x, y]) => {
    let best = Infinity;
    let n = [0, 0];
    for (const p of track.points) {
      const d = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (d < best) { best = d; n = [-p.ty, p.tx]; }
    }
    return [x + n[0] * by, y + n[1] * by];
  });
}

// Distance between two props' outlines, less their pads, by sampling. A rough guide for the seeded
// scatter; the tests measure the real colliders.
function gapApprox(a, b) {
  const pa = samples(a);
  const pb = samples(b);
  let best = Infinity;
  for (const [x, y, ra] of pa) for (const [u, v, rb] of pb) best = Math.min(best, Math.hypot(x - u, y - v) - ra - rb);
  if (b.points && !b.width && insideConvex(b.points, a.x, a.y)) return -1;
  return best;
}

function samples(p) {
  if (p.r !== undefined) return [[p.x, p.y, p.r]];
  if (p.w !== undefined) {
    const out = [];
    for (let i = 0; i <= 8; i += 1) {
      const fx = p.x - p.w / 2 + (p.w * i) / 8;
      const fy = p.y - p.h / 2 + (p.h * i) / 8;
      out.push([fx, p.y - p.h / 2, 0], [fx, p.y + p.h / 2, 0], [p.x - p.w / 2, fy, 0], [p.x + p.w / 2, fy, 0]);
    }
    return out;
  }
  const pad = p.width ? p.width / 2 : 0;
  const pts = p.points;
  const out = [];
  const closed = !p.width;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i += 1) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 1.5));
    for (let j = 0; j <= k; j += 1) out.push([ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k, pad]);
  }
  return out;
}

function insideConvex(points, x, y) {
  return points.every(([ax, ay], i) => {
    const [bx, by] = points[(i + 1) % points.length];
    return (x - ax) * (by - ay) - (y - ay) * (bx - ax) <= 0;
  });
}
