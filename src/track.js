// The circuits: closed centrelines with lookups for surface, progress along the lap,
// and the checkpoint gates. Every lap runs clockwise on screen.

// Original's control points, in metres. The first point sits on the start/finish line.
const CENTERLINE = [
  // Main straight, heading east.
  [-60, -110], [30, -110], [80, -110], [120, -110],
  // Sweeping right-hander.
  [162, -92], [186, -54], [192, -4], [162, 42], [118, 62],
  // Left-right transition.
  [90, 92], [76, 128], [46, 150],
  // Short run to the hairpin.
  [0, 156], [-50, 156],
  // Tight hairpin, 180 degrees to the right.
  [-82, 149], [-96, 128], [-82, 107], [-52, 101],
  // Climb out, kinking left.
  [-18, 92], [8, 66], [8, 30],
  // Back straight, heading west.
  [-20, 6], [-75, 0], [-130, -2],
  // Final long right-hander onto the main straight.
  [-180, -24], [-204, -66], [-186, -100], [-145, -110], [-105, -110],
];

// Switchback: medium corners linked into one another, rather than Original's long
// sweepers and hairpin. The start/finish line is on the west straight, heading north.
const SWITCHBACK = [
  // West straight: the one long run to top speed.
  [-200, 100], [-200, 41], [-200, -18], [-200, -76],
  // Top-left right-hander, then a short straight.
  [-196, -95], [-185, -112], [-169, -122], [-150, -126], [-100, -126],
  // Five switchbacks stepping down to the south-east: right, left, right, left, right.
  [-77, -120], [-61, -102], [-56, -78], [-58, -60],
  [-53, -37], [-36, -20], [-12, -15], [6, -17],
  [30, -11], [48, 6], [53, 31], [52, 49],
  [57, 73], [74, 90], [97, 95], [115, 93],
  [139, 97], [157, 114], [163, 137],
  // Short east straight into the tight right, the one corner that wants the handbrake.
  [163, 189], [163, 242],
  [156, 259], [140, 268], [122, 263], [106, 252],
  // A left flick out of it, then a right-left sweep onto the bottom straight.
  [89, 244], [71, 241], [41, 241],
  [18, 236], [-1, 221], [-10, 210], [-29, 195], [-53, 190],
  [-101, 190], [-150, 190],
  // Bottom-left right-hander onto the west straight.
  [-169, 186], [-185, 175], [-196, 159], [-200, 140],
];

// Dockyard: compact and technical, driven Hook-first. The control points carry one decimal
// place: rounded to whole metres, the spline wobbles through the Hook's wide half.
const DOCKYARD = [
  // Quay straight, heading east. The line is 45 m along it.
  [-41, -78], [5.8, -78], [52.6, -78], [99.4, -78],
  // The Hook: a right-hander that opens at 64 m...
  [117.1, -75.5], [133.3, -68.3], [147, -56.8], [156.9, -42], [162.4, -25.1],
  // ...and tightens to 24 m.
  [163.2, -14.6], [161.4, -4.4], [156.4, 4.7], [147.8, 11.3], [137.3, 13.6],
  // Acceleration zone, heading west.
  [92.3, 13.6], [47.3, 13.6], [2.3, 13.6],
  // Chicane: left...
  [-7.4, 15.2], [-16, 19.8], [-22.7, 27], [-26.7, 35.9],
  // ...then right, and a short link.
  [-32, 55.8], [-36.1, 64.7], [-42.8, 71.8], [-51.4, 76.4], [-61, 78],
  // The Basin: a 180 degree sweeper at 69 to 80 m, back onto the quay.
  [-86, 78], [-108, 74.8], [-128.2, 65.6], [-145, 51], [-157, 32.3], [-163.2, 11.1],
  [-163.2, -11.2], [-156.9, -32.4], [-144.9, -51.1], [-128.1, -65.6], [-107.9, -74.9], [-85.9, -78],
];

// Runway 27: wide sweeping airfield bends linked by fast chutes around a disused cross-runway.
const RUNWAY_27 = [
  [-60.8, -151.2], [-16.8, -151.2], [27.2, -151.2], [71.2, -151.2], [115.2, -151.2],
  [135.9, -148.3], [155, -139.7], [170.9, -126], [182.3, -108.5], [188.4, -88.5],
  [188.6, -67.6], [183, -47.4], [171.9, -29.7], [146.2, 1], [137, 16],
  [132.8, 33.2], [134, 50.8], [140.4, 67.2], [146.5, 82.8], [147.7, 99.4],
  [144, 115.7], [135.7, 130.2], [123.4, 141.5], [108.4, 148.8], [91.9, 151.2],
  [48.5, 151.2], [5.1, 151.2], [-38.3, 151.2], [-81.7, 151.2], [-125.1, 151.2],
  [-143, 148.7], [-159.5, 141.2], [-173.2, 129.4], [-183.1, 114.3], [-188.4, 97],
  [-188.6, 78.9], [-183.7, 61.5], [-174.2, 46.1], [-152.3, 20], [-144.3, 7.3],
  [-140.2, -7.2], [-140.2, -22.2], [-144.3, -36.6], [-152.3, -49.4], [-161.5, -64.3],
  [-166.3, -81.2], [-166.1, -98.7], [-161, -115.4], [-151.4, -130.1], [-138.1, -141.5],
  [-122.1, -148.8], [-104.8, -151.2],
];

// Redline Mesa: three wide opposing drift hairpins connected by linkable chutes and a canyon-rim return.
const REDLINE_MESA = [
  [-27.7, -119.1], [17.3, -119.1], [62.3, -119.1], [107.3, -119.1], [118.3, -117.3],
  [128.2, -112.1], [136, -104.1], [140.9, -94.1], [142.3, -83], [140.2, -72.1],
  [134.8, -62.4], [126.6, -54.8], [116.4, -50.3], [84.5, -41.7], [52.6, -33.2],
  [42.2, -28.2], [34.3, -20], [29.7, -9.4], [29.2, 2.1], [32.8, 13],
  [40, 22], [50, 27.8], [84.7, 40.5], [119.5, 53.1], [128.7, 58.2],
  [135.9, 65.8], [140.4, 75.3], [141.9, 85.7], [140, 96.1], [135.1, 105.4],
  [127.6, 112.7], [118.3, 117.4], [107.9, 119.1], [74.8, 119.1], [41.8, 119.1],
  [8.8, 119.1], [-24.2, 119.1], [-57.3, 119.1], [-90.3, 119.1], [-106.4, 116.5],
  [-120.9, 109.1], [-132.4, 97.6], [-139.8, 83.1], [-142.3, 67.1], [-142.3, 27.8],
  [-142.3, -11.5], [-139.3, -28], [-130.5, -42.3], [-121.7, -56.6], [-118.7, -73.1],
  [-116.4, -87.3], [-109.9, -100.1], [-99.7, -110.3], [-86.9, -116.8], [-72.7, -119.1],
];

// Headland Run: fast cliff sweeper, deep marina cove, and an opening-radius lighthouse carousel.
const HEADLAND_RUN = [
  [-58.5, -125.5], [-17.2, -125.5], [24, -125.5], [65.3, -125.5], [84.5, -122.5],
  [101.7, -113.7], [115.5, -100], [124.3, -82.7], [127.3, -63.5], [127.3, -29.5],
  [128.9, -19.6], [133.4, -10.7], [140.5, -3.6], [149.4, 0.9], [159.3, 2.5],
  [183.3, 2.5], [193.6, 4.3], [202.6, 9.5], [209.3, 17.5], [212.8, 27.3],
  [212.8, 37.7], [209.3, 47.5], [202.6, 55.5], [193.6, 60.7], [183.3, 62.5],
  [145.6, 62.5], [107.8, 62.5], [70.1, 62.5], [32.4, 62.5], [-5.4, 62.5],
  [-43.1, 62.5], [-80.8, 62.5], [-100.1, 65.4], [-117.5, 74.1], [-131.6, 87.5],
  [-141, 104.6], [-145.8, 113.2], [-153.1, 119.9], [-162, 124], [-171.8, 125.5],
  [-181.4, 124.3], [-190.6, 120.6], [-198.5, 114.8], [-204.9, 107.2], [-209.4, 98.5],
  [-212.1, 89], [-212.8, 79.2], [-211.8, 69.4], [-209.2, 59.9], [-195.9, 23.4],
  [-182.6, -13.1], [-169.4, -49.5], [-156.1, -86], [-147.3, -102], [-134.1, -114.7],
  [-117.7, -122.7], [-99.7, -125.5],
];

// Nightshift Viaduct: midnight industrial expressway with a 205-degree cloverleaf on-ramp.
const NIGHTSHIFT_VIADUCT = [
  [-82.6, -100.4], [-39.3, -100.4], [4.1, -100.4], [47.4, -100.4], [90.7, -100.4],
  [134.1, -100.4], [148.8, -98.2], [162.2, -91.8], [173.1, -81.7], [180.5, -68.9],
  [183.9, -54.4], [182.9, -39.6], [177.6, -25.8], [168.4, -14.1], [156.2, -5.6],
  [142, -1.1], [127.2, -0.9], [112.9, -5.1], [77.6, -21.6], [42.3, -38.1],
  [32.1, -41.1], [21.6, -41.2], [11.4, -38.3], [2.5, -32.6], [-4.5, -24.6],
  [-8.9, -15], [-10.4, -4.6], [-10.4, 32.4], [-10.4, 69.4], [-12.7, 81.3],
  [-19.5, 91.4], [-29.5, 98.1], [-41.4, 100.4], [-73.6, 100.4], [-105.7, 100.4],
  [-137.9, 100.4], [-152.1, 98.2], [-165, 91.7], [-175.1, 81.5], [-181.7, 68.7],
  [-183.9, 54.4], [-183.9, 22.1], [-183.9, -10.1], [-183.9, -42.4], [-181.1, -60.4],
  [-172.8, -76.5], [-160, -89.4], [-143.8, -97.6], [-125.9, -100.4],
];

export const TRACK_HALF_WIDTH = 10;
export const CURB_WIDTH = 2;
const SAMPLE_SPACING = 2;      // metres between stored centreline points
const CHECKPOINT_COUNT = 16;   // gates between one finish line and the next
const GATE_INSIDE_MARGIN = 10; // how far past the road edge a gate reaches inside a corner...
const GATE_OUTSIDE_MARGIN = 36;// ...and everywhere else (matches the runoff)
const GATE_BEND_SPAN = 20;     // centreline samples either side used to judge a gate's corner
const GATE_BEND_CURVATURE = 1 / 400;
const RUNOFF = 36;             // grass between the track and the perimeter barrier
const CURB_CURVATURE = 1 / 110;// corners at least this tight get painted curbs

function catmullRom(p0, p1, p2, p3, t) {
  // Centripetal parameterisation avoids overshoot where control points are unevenly spaced.
  const dist = (a, b) => Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5, 1e-4);
  const t1 = dist(p0, p1);
  const t2 = t1 + dist(p1, p2);
  const t3 = t2 + dist(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => [
    a[0] + (b[0] - a[0]) * (u - ta) / (tb - ta),
    a[1] + (b[1] - a[1]) * (u - ta) / (tb - ta),
  ];
  const a1 = lerp(p0, p1, 0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, 0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

function sampleClosedCurve(control) {
  const fine = [];
  const n = control.length;
  for (let i = 0; i < n; i += 1) {
    const [p0, p1, p2, p3] = [control[(i + n - 1) % n], control[i], control[(i + 1) % n], control[(i + 2) % n]];
    for (let j = 0; j < 30; j += 1) fine.push(catmullRom(p0, p1, p2, p3, j / 30));
  }
  return fine;
}

function resample(fine, spacing) {
  let total = 0;
  const lengths = fine.map((p, i) => {
    const q = fine[(i + 1) % fine.length];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    total += d;
    return d;
  });
  const count = Math.round(total / spacing);
  const step = total / count;
  const out = [];
  let i = 0;
  let walked = 0;
  for (let k = 0; k < count; k += 1) {
    const want = k * step;
    while (walked + lengths[i] < want) {
      walked += lengths[i];
      i += 1;
    }
    const f = (want - walked) / lengths[i];
    const p = fine[i];
    const q = fine[(i + 1) % fine.length];
    out.push({ x: p[0] + (q[0] - p[0]) * f, y: p[1] + (q[1] - p[1]) * f, s: want });
  }
  return { points: out, length: total, step };
}

function angleDelta(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

export function buildTrack(control = CENTERLINE) {
  const { points, length, step } = resample(sampleClosedCurve(control), SAMPLE_SPACING);
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[(i + n - 2) % n];
    const b = points[(i + 2) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    points[i].tx = dx / d;
    points[i].ty = dy / d;
  }
  for (let i = 0; i < n; i += 1) {
    // Signed curvature over a short span; positive turns right on screen.
    const a = points[(i + n - 3) % n];
    const b = points[(i + 3) % n];
    points[i].curvature = angleDelta(Math.atan2(a.ty, a.tx), Math.atan2(b.ty, b.tx)) / (6 * step);
  }

  // Gates are lopsided on purpose: tight on the inside of a corner, where cutting
  // across the grass saves distance, and generous on the outside, where running
  // wide costs time already and should not also void the lap.
  const makeGate = (s) => {
    const i = Math.round(s / step) % n;
    const p = points[i];
    let bend = 0;
    for (let d = -GATE_BEND_SPAN; d <= GATE_BEND_SPAN; d += 1) bend += points[(i + d + n) % n].curvature;
    const road = TRACK_HALF_WIDTH + CURB_WIDTH;
    const curved = Math.abs(bend / (2 * GATE_BEND_SPAN + 1)) > GATE_BEND_CURVATURE;
    const right = road + (curved && bend > 0 ? GATE_INSIDE_MARGIN : GATE_OUTSIDE_MARGIN);
    const left = road + (curved && bend < 0 ? GATE_INSIDE_MARGIN : GATE_OUTSIDE_MARGIN);
    // The right-hand normal in screen coordinates is (-ty, tx).
    return {
      s: p.s,
      x1: p.x - p.ty * right,
      y1: p.y + p.tx * right,
      x2: p.x + p.ty * left,
      y2: p.y - p.tx * left,
      tx: p.tx,
      ty: p.ty,
    };
  };

  const finish = makeGate(0);
  const gates = [];
  for (let k = 1; k <= CHECKPOINT_COUNT; k += 1) {
    gates.push(makeGate((length * k) / (CHECKPOINT_COUNT + 1)));
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const edge = TRACK_HALF_WIDTH + CURB_WIDTH + RUNOFF;
  const bounds = {
    minX: Math.min(...xs) - edge,
    maxX: Math.max(...xs) + edge,
    minY: Math.min(...ys) - edge,
    maxY: Math.max(...ys) + edge,
  };

  const start = points[3]; // just past the line, so the first lap starts rolling across nothing
  return {
    points,
    length,
    step,
    halfWidth: TRACK_HALF_WIDTH,
    curbWidth: CURB_WIDTH,
    curbCurvature: CURB_CURVATURE,
    finish,
    gates,
    bounds,
    start: { x: start.x, y: start.y, heading: Math.atan2(start.ty, start.tx) },
  };
}

// Every circuit, in the order the title offers them. Ids are stable: tests, the page and the
// saved records (records.js) use them.
export const TRACKS = Object.freeze([
  Object.freeze({ id: 'original', name: 'Original', control: CENTERLINE }),
  Object.freeze({ id: 'switchback', name: 'Switchback', control: SWITCHBACK }),
  Object.freeze({ id: 'dockyard', name: 'Dockyard', control: DOCKYARD }),
  Object.freeze({ id: 'runway-27', name: 'Runway 27', control: RUNWAY_27 }),
  Object.freeze({ id: 'redline-mesa', name: 'Redline Mesa', control: REDLINE_MESA }),
  Object.freeze({ id: 'headland-run', name: 'Headland Run', control: HEADLAND_RUN }),
  Object.freeze({ id: 'nightshift-viaduct', name: 'Nightshift Viaduct', control: NIGHTSHIFT_VIADUCT }),
]);
export const DEFAULT_TRACK_ID = 'original';

// What lies beyond each circuit's curbs, physically. It decides only how the car drives there
// (physics.js); whether the car is on the course is a separate question (isOnCourse below), so a
// paved apron is never part of the circuit. A circuit that names no apron has grass.
const APRONS = Object.freeze({ dockyard: 'concrete' });

// Each circuit is built once, so every session on it shares one track object.
const built = new Map();
export function trackById(id) {
  const entry = TRACKS.find((t) => t.id === id);
  if (!entry) throw new Error(`Unknown track: ${id}`);
  if (!built.has(id)) built.set(id, { ...buildTrack(entry.control), id: entry.id, name: entry.name, apron: APRONS[id] ?? 'grass' });
  return built.get(id);
}

// Nearest point on the centreline. `offset` is signed, positive to the right of travel.
export function projectOnTrack(track, x, y) {
  const { points } = track;
  const n = points.length;
  let best = Infinity;
  let bestI = 0;
  let bestT = 0;
  let px = points[n - 1].x;
  let py = points[n - 1].y;
  for (let i = 0; i < n; i += 1) {
    const q = points[i];
    const ex = q.x - px;
    const ey = q.y - py;
    const len2 = ex * ex + ey * ey;
    let t = ((x - px) * ex + (y - py) * ey) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (px + ex * t);
    const dy = y - (py + ey * t);
    const d2 = dx * dx + dy * dy;
    if (d2 < best) {
      best = d2;
      bestI = i;
      bestT = t;
    }
    px = q.x;
    py = q.y;
  }
  const q = points[bestI];
  const p = points[(bestI + n - 1) % n];
  const distance = Math.sqrt(best);
  const sq = bestI === 0 ? track.length : q.s;
  const s = (p.s + (sq - p.s) * bestT) % track.length;
  const side = (x - q.x) * -q.ty + (y - q.y) * q.tx;
  return { s, distance, offset: side >= 0 ? distance : -distance, tx: q.tx, ty: q.ty, curvature: q.curvature };
}

// The physical surface: road, curb, then the circuit's apron (grass unless the track says otherwise).
export function surfaceFromDistance(track, distance) {
  if (distance <= track.halfWidth) return 'road';
  if (distance <= track.halfWidth + track.curbWidth) return 'curb';
  return track.apron ?? 'grass';
}

// The competition rule, kept apart from the physical surface: the course is the road and its curbs,
// whatever the ground beyond them is made of. Scoring reads this, never the surface.
export function isOnCourse(track, distance) {
  return distance <= track.halfWidth + track.curbWidth;
}

export function surfaceAt(track, x, y) {
  return surfaceFromDistance(track, projectOnTrack(track, x, y).distance);
}

// True if the motion from (ax, ay) to (bx, by) crosses the gate in its forward
// direction; returns -1 if it crosses backward and 0 if it does not cross.
export function gateCrossing(gate, ax, ay, bx, by) {
  const gx = gate.x2 - gate.x1;
  const gy = gate.y2 - gate.y1;
  const mx = bx - ax;
  const my = by - ay;
  const denom = mx * gy - my * gx;
  if (Math.abs(denom) < 1e-9) return 0;
  const t = ((gate.x1 - ax) * gy - (gate.y1 - ay) * gx) / denom;
  const u = ((gate.x1 - ax) * my - (gate.y1 - ay) * mx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return 0;
  return mx * gate.tx + my * gate.ty >= 0 ? 1 : -1;
}

// Wrapped difference between two lap positions, in the range (-length/2, length/2].
export function trackDelta(track, from, to) {
  let d = to - from;
  if (d > track.length / 2) d -= track.length;
  if (d < -track.length / 2) d += track.length;
  return d;
}
