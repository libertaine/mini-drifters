// The circuits: closed centrelines with lookups for surface, progress along the lap,
// and the checkpoint gates. Both laps run clockwise on screen.

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

// Both circuits, in the order the title offers them. Ids are stable: tests and the page use them.
export const TRACKS = Object.freeze([
  Object.freeze({ id: 'original', name: 'Original', control: CENTERLINE }),
  Object.freeze({ id: 'switchback', name: 'Switchback', control: SWITCHBACK }),
]);
export const DEFAULT_TRACK_ID = 'original';

// Each circuit is built once, so every session on it shares one track object.
const built = new Map();
export function trackById(id) {
  const entry = TRACKS.find((t) => t.id === id);
  if (!entry) throw new Error(`Unknown track: ${id}`);
  if (!built.has(id)) built.set(id, { ...buildTrack(entry.control), id: entry.id, name: entry.name });
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

export function surfaceFromDistance(track, distance) {
  if (distance <= track.halfWidth) return 'road';
  if (distance <= track.halfWidth + track.curbWidth) return 'curb';
  return 'grass';
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
