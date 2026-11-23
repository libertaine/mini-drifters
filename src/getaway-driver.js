// Getaway Driver: the second Getaway mission. EXPERIMENTAL (v0.8.0 R0 research), not a shipped
// challenge, and offered only by getaway-driver-entry.js.
//
// Get the Footage's Downtown, without its cameras: drive from the start to the safehouse without
// drawing the police, or, once they are on you, lose them first. It is a gymkhana challenge object
// with the urban layout, so game.js, the city drawing, the police car artwork, the bust ring and the
// guidance arrow all run it as they run Get the Footage. What it adds:
//   - ATTENTION (run.attention, 0..1): raised by speeding, drifting, hitting things and smashing
//     them; several times faster while a police car can see the car. It drains with calm driving,
//     but only while no police car is watching;
//   - patrol cars that drive fixed loops of the streets with their lights off. A patrol car sees
//     ahead of it (a cone, never through a building) and, closer in, all round;
//   - detection: a police car that sees the car while ATTENTION is at DETECT or above gives chase.
//     Unseen recklessness is still reported once ATTENTION fills: the nearest patrol car is sent,
//     lights on, to where the car was;
//   - the chase is Get the Footage's: the same police car on the same street network
//     (getaway-urban.js stepUrbanPursuer) and the same BUST RISK (getaway-pursuer.js captureRate);
//   - escape: no police car can see the car, and every chasing one is LOSE GAP or more away, for LOSE
//     TIME seconds together. The police then search where they last saw it and go back to patrol;
//   - victory: through the safehouse gate unnoticed, or after losing every pursuer. The gate does not
//     open while a police car is chasing (nobody leads the police home).
// Nothing here reads or writes storage, and nothing here is a medal or a record: a run's result has
// no value (game.js reports value null), and the mission is in no records index.
import { TUNING } from './tuning.js';
import { gateCrossing } from './track.js';
import { padTrack } from './practice-pad.js';
import { updateDerived } from './physics.js';
import { updateScoring, bankCombo, loseCombo } from './scoring.js';
import { CAPTURE_MODELS, captureRate, createPursuer } from './getaway-pursuer.js';
import { CITY_LAYOUTS, buildCity, locate, lineOfSight, segmentHitsBox } from './getaway-city.js';
import { URBAN_PURSUER, BREAKABLE, stepUrbanPursuer } from './getaway-urban.js';
import { NAV, planGuide } from './getaway-nav.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// --- The tunable numbers -----------------------------------------------------------------------------
// The research knobs, in one place. Rates are per second on a 0..1 meter; bumps are added at once.
export const DRIVER = Object.freeze({
  // What draws attention.
  speedLimit: 20,          // m/s (45 mph): faster than this is speeding
  speedRate: 0.05,         // for each 10 m/s over the limit
  driftSlip: 15 * DEG,     // a slide past this slip angle (above 8 m/s) is drifting...
  driftFull: 40 * DEG,     // ...and counts in full from this one
  driftRate: 0.08,
  impactMin: 3,            // m/s into something solid before anyone notices
  impactBump: 0.12,        // a hard hit (15 m/s or more); softer ones in proportion
  smashBump: Object.freeze({ fruit: 0.2, barricade: 0.3 }),
  watched: 4,              // everything above counts this many times over while police can see the car
  scrutiny: 0.1,           // a police car this close and watching notices even calm driving...
  scrutinyRange: 30,       // ...within this many metres
  calmAfter: 1.5,          // seconds of calm before attention starts to drain
  decay: 0.05,             // drain, calm and unseen (20 s from full)
  suspectAt: 0.35,         // the HUD's SUSPICIOUS
  detectAt: 0.7,           // seen at this attention or more...
  spotTime: 0.6,           // ...for this long without a break: pursuit
  // Patrol cars.
  patrolSpeed: 11,         // m/s cruising
  patrolGrip: 5,           // m/s^2 through its corners (so about 7 m/s round a city corner)
  patrolAccel: 3,
  patrolBrake: 5,
  lane: 2.5,               // metres right of the centre line
  visionRange: 65,         // metres ahead...
  visionHalf: 50 * DEG,    // ...within this angle either side of its nose
  nearSight: 14,           // metres all round
  // Responding, pursuing, searching.
  respondSpeed: 24,        // m/s top speed while sent to a report
  pursuitPing: 4,          // seconds between dispatch updates of the car's place during a chase
                           // (Get the Footage: 1.5). Infinity: a pursuer knows only what it sees.
  loseGap: 45,             // metres from every pursuer...
  loseTime: 5,             // ...for this long, out of sight of every police car: escaped
  afterEscape: 0.6,        // attention left once they are lost: below DETECT, but not by much
  searchTime: 6,           // seconds spent where the car was lost before going back on patrol
  timeLimit: 150,
});

// The police: patrol loops (junctions in driving order, each pair joined by a street, and where on
// the loop each car starts, a fraction of its length), and a parked car (`post`: where it waits and
// which way it looks). The same every run, so a route can be learned. The loops run against the
// ways to the safehouse where they share a street, so a patrol car meets the player head on; one
// following the player's own direction would never see it.
export const DRIVER_PATROLS = Object.freeze({
  downtown: Object.freeze([
    Object.freeze({ id: 'west', name: 'West', nodes: Object.freeze(['A0', 'B0', 'B1', 'A1']), start: 0.3 }),
    Object.freeze({ id: 'central', name: 'Central', nodes: Object.freeze(['B1', 'BA', 'B2', 'C2', 'CA', 'C1']), start: 0.1 }),
    Object.freeze({ id: 'east', name: 'East', nodes: Object.freeze(['D2', 'C2', 'B2', 'BB', 'B3', 'C3', 'D3']), start: 0.35 }),
    // Parked past the safehouse door, watching the last stretch of the way in.
    Object.freeze({ id: 'stakeout', name: 'Stakeout', post: Object.freeze({ x: 326, y: -4.5, heading: Math.PI }) }),
  ]),
});

// Downtown without Get the Footage's cameras; its escape gate is the safehouse.
const LAYOUTS = Object.freeze({
  downtown: Object.freeze({ ...CITY_LAYOUTS.downtown, id: 'downtown-driver', cameras: Object.freeze([]) }),
});
const cities = new Map();
export function driverCityFor(variant = 'downtown') {
  if (!cities.has(variant)) cities.set(variant, buildCity(LAYOUTS[variant]));
  return cities.get(variant);
}

// --- Patrol loops ------------------------------------------------------------------------------------
// The loop as a closed line the patrol car drives: each leg moved `lane` metres to the right, each
// corner rounded, sampled every half metre with its heading and the speed it can take there.
export function buildLoop(city, nodes, D = DRIVER) {
  const pts = nodes.map((id) => {
    const n = city.nodes[id];
    if (!n) throw new Error(`patrol: unknown node ${id}`);
    return [n.x, n.y];
  });
  nodes.forEach((id, i) => {
    if (!city.edgeBetween(id, nodes[(i + 1) % nodes.length])) throw new Error(`patrol: no street ${id}-${nodes[(i + 1) % nodes.length]}`);
  });
  // Corners only: a junction it drives straight through is not a vertex.
  const corners = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[(i - 1 + pts.length) % pts.length];
    const b = pts[i];
    const c = pts[(i + 1) % pts.length];
    const turn = angleTo(Math.atan2(b[1] - a[1], b[0] - a[0]), Math.atan2(c[1] - b[1], c[0] - b[0]));
    if (Math.abs(turn) > 1 * DEG) corners.push(b);
  }
  const n = corners.length;
  const leg = (i) => {
    const a = corners[i];
    const b = corners[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { dx: (b[0] - a[0]) / len, dy: (b[1] - a[1]) / len, len };
  };
  // Each corner of the lane line, with its fillet: in on leg i-1, out on leg i.
  const fillets = corners.map((c, i) => {
    const lin = leg((i - 1 + n) % n);
    const lout = leg(i);
    // Right of travel (y grows down the screen): (-dy, dx).
    const v = [c[0] - lin.dy * D.lane - lout.dy * D.lane, c[1] + lin.dx * D.lane + lout.dx * D.lane];
    const turn = angleTo(Math.atan2(lin.dy, lin.dx), Math.atan2(lout.dy, lout.dx));
    const right = turn > 0;
    const R = Math.min(right ? 9 : 14, 0.45 * Math.min(lin.len, lout.len));
    const t = R * Math.tan(Math.abs(turn) / 2);
    const p1 = [v[0] - lin.dx * t, v[1] - lin.dy * t];
    const p2 = [v[0] + lout.dx * t, v[1] + lout.dy * t];
    const side = right ? 1 : -1;
    const centre = [p1[0] - lin.dy * R * side, p1[1] + lin.dx * R * side];
    return { p1, p2, R, turn, centre, h1: Math.atan2(lin.dy, lin.dx) };
  });
  const samples = [];
  const STEP = 0.5;
  const push = (x, y, h, R) => samples.push({ x, y, h, R });
  for (let i = 0; i < n; i += 1) {
    const f = fillets[i];
    const arc = Math.abs(f.turn) * f.R;
    const side = Math.sign(f.turn);
    for (let d = 0; d < arc; d += STEP) {
      const a = f.h1 + side * (d / f.R);
      // Point on the arc: from the centre, at the angle a - side * 90 degrees.
      const ang = a - side * Math.PI / 2;
      push(f.centre[0] + Math.cos(ang) * f.R, f.centre[1] + Math.sin(ang) * f.R, a, f.R);
    }
    const g = fillets[(i + 1) % n];
    const lx = g.p1[0] - f.p2[0];
    const ly = g.p1[1] - f.p2[1];
    const len = Math.hypot(lx, ly);
    const h = Math.atan2(ly, lx);
    for (let d = 0; d < len; d += STEP) push(f.p2[0] + (lx / len) * d, f.p2[1] + (ly / len) * d, h, Infinity);
  }
  // The speed it can take each sample at, with room to brake for the corners ahead.
  const m = samples.length;
  const v = samples.map((p) => Math.min(D.patrolSpeed, Number.isFinite(p.R) ? Math.sqrt(D.patrolGrip * p.R) : Infinity));
  for (let pass = 0; pass < 2; pass += 1) {
    for (let k = m - 1; k >= 0; k -= 1) v[k] = Math.min(v[k], Math.sqrt(v[(k + 1) % m] ** 2 + 2 * D.patrolBrake * STEP));
  }
  samples.forEach((p, k) => { p.v = v[k]; p.s = k * STEP; });
  return Object.freeze({ samples: Object.freeze(samples), length: m * STEP, step: STEP });
}

function loopAt(loop, s) {
  const L = loop.length;
  const u = ((s % L) + L) % L / loop.step;
  const i = Math.floor(u);
  const a = loop.samples[i % loop.samples.length];
  const b = loop.samples[(i + 1) % loop.samples.length];
  const f = u - i;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, h: a.h + angleTo(a.h, b.h) * f, v: Math.min(a.v, b.v) };
}

function nearestOnLoop(loop, x, y) {
  let best = 0;
  let bestD = Infinity;
  loop.samples.forEach((p, k) => {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) { bestD = d; best = k; }
  });
  return best * loop.step;
}

// --- Sight ---------------------------------------------------------------------------------------------
// How far a ray from (x, y) along angle a gets before something tall stops it (at most `range`).
export function rayReach(city, x, y, a, range) {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  let best = range;
  for (const b of city.sightBlockers) {
    let t0 = 0;
    let t1 = best;
    if (Math.abs(dx) < 1e-9) { if (x < b.minX || x > b.maxX) continue; } else {
      let ta = (b.minX - x) / dx;
      let tb = (b.maxX - x) / dx;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
    }
    if (Math.abs(dy) < 1e-9) { if (y < b.minY || y > b.maxY) continue; } else {
      let ta = (b.minY - y) / dy;
      let tb = (b.maxY - y) / dy;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
    }
    if (t0 <= t1 && t0 < best) best = Math.max(0, t0);
  }
  return best;
}

// A patrol car, or one driving back to its loop, looks where it is going; the others look for the car.
const looksAhead = (u) => u.mode === 'patrol' || u.mode === 'return';

// Does this police car see the car? A patrol car looks ahead (its cone) and, close in, all round; one
// that is responding, chasing or searching is looking for the car, all round, as far as a pursuer
// sees (URBAN_PURSUER.sight). Never through a building.
export function unitSees(city, u, car, D = DRIVER) {
  const dx = car.x - u.x;
  const dy = car.y - u.y;
  const d = Math.hypot(dx, dy);
  if (looksAhead(u)) {
    const inCone = d < D.visionRange && Math.abs(angleTo(u.heading, Math.atan2(dy, dx))) < D.visionHalf;
    if (!inCone && d >= D.nearSight) return false;
  } else if (d >= URBAN_PURSUER.sight) return false;
  return lineOfSight(city, u.x, u.y, car.x, car.y);
}

// The outline of what a police car can see, for the drawing: rays fanned over its cone (a patrol car)
// or all round (any other), each stopped by the first building.
export function visionOutline(city, u, D = DRIVER, rays = 28) {
  const all = !looksAhead(u);
  const range = all ? URBAN_PURSUER.sight : D.visionRange;
  const from = all ? -Math.PI : -D.visionHalf;
  const span = all ? 2 * Math.PI : 2 * D.visionHalf;
  const pts = [];
  for (let k = 0; k <= rays; k += 1) {
    const a = u.heading + from + (span * k) / rays;
    const r = rayReach(city, u.x, u.y, a, range);
    pts.push([u.x + Math.cos(a) * r, u.y + Math.sin(a) * r]);
  }
  return pts;
}

// --- Police cars -----------------------------------------------------------------------------------------
// Every police car carries the full pursuer state from the start, so a patrol car can give chase at
// once, from where it is, at the speed it is doing.
function createUnit(spec, loop, index) {
  const at = loop ? loopAt(loop, spec.start * loop.length) : { x: spec.post.x, y: spec.post.y, h: spec.post.heading, v: 0 };
  const base = createPursuer({ x: at.x, y: at.y, heading: at.h }, { ...URBAN_PURSUER, startGap: 0 });
  return {
    ...base,
    path: null, pathNodes: null, pathIdx: 0, replanIn: 0, edge: -1,
    known: null, knownAt: -Infinity, fresh: false, sees: false,
    goal: 'car', interceptUntil: -Infinity, interceptCooldown: 0, intercepts: 0,
    contactAge: Infinity, wallHits: 0, pinned: 0, unsticks: 0, smashes: 0, backOff: 0,
    id: spec.id, name: spec.name, index, loop, post: spec.post ?? null, s: loop ? spec.start * loop.length : 0, speed: at.v,
    mode: 'patrol', lights: false, watching: false, spotting: 0, modeAt: 0, seenAt: -Infinity, report: null, rejoin: null,
    chases: 0,
  };
}

function setMode(u, mode, time) {
  u.mode = mode;
  u.modeAt = time;
  u.lights = mode === 'respond' || mode === 'pursue';
  u.path = null;
  u.replanIn = 0;
  u.reverseTime = 0;
  u.backOff = 0;
}

function stepPatrol(u, D, dt) {
  u.prevX = u.x;
  u.prevY = u.y;
  u.prevHeading = u.heading;
  if (u.post) {
    // Parked: back to its spot at a crawl if it is not quite on it, then facing its way.
    const dx = u.post.x - u.x;
    const dy = u.post.y - u.y;
    const d = Math.hypot(dx, dy);
    const move = Math.min(d, 4 * dt);
    if (d > 1e-6) { u.x += (dx / d) * move; u.y += (dy / d) * move; }
    u.speed = d > 0.3 ? 4 : 0;
    u.heading += clamp(angleTo(u.heading, d > 0.5 ? Math.atan2(dy, dx) : u.post.heading), -2 * dt, 2 * dt);
    u.state = 'parked';
    return;
  }
  const ahead = loopAt(u.loop, u.s);
  u.speed = u.speed < ahead.v ? Math.min(ahead.v, u.speed + D.patrolAccel * dt) : ahead.v;
  u.s = (u.s + u.speed * dt) % u.loop.length;
  const at = loopAt(u.loop, u.s);
  u.x = at.x;
  u.y = at.y;
  // Back on its loop after a chase it may face another way: it swings round, quickly but not at once.
  const err = angleTo(u.heading, at.h);
  u.heading += clamp(err, -3 * dt, 3 * dt);
  u.state = 'patrolling';
  u.distance += u.speed * dt;
}

// --- The challenge --------------------------------------------------------------------------------------------
function note(run, event) {
  run.event = event;
  run.eventSerial += 1;
}

// `driver` overrides single DRIVER numbers (the research harness's knobs); `patrols` the number of
// patrol cars (the first n of DRIVER_PATROLS); `capture` a CAPTURE_MODELS key.
// `phase` (research harness only) shifts every patrol car's start along its loop by that many metres.
export function createDriverChallenge({ variant = 'downtown', driver = {}, patrols = 4, capture = 'proximity', pursuit = 'network', phase = 0 } = {}) {
  const D = Object.freeze({ ...DRIVER, ...driver });
  const city = driverCityFor(variant);
  const C = CAPTURE_MODELS[capture];
  const P = Object.freeze({ ...URBAN_PURSUER, ping: D.pursuitPing });
  const PR = Object.freeze({ ...URBAN_PURSUER, vMax: D.respondSpeed, ping: Infinity });
  const PS = Object.freeze({ ...URBAN_PURSUER, vMax: D.respondSpeed, ping: Infinity });
  const specs = DRIVER_PATROLS[variant].slice(0, patrols);
  const loops = specs.map((spec) => (spec.nodes ? buildLoop(city, spec.nodes, D) : null));
  const { exit: safehouse, start, bounds } = city;
  const track = Object.freeze({ ...padTrack(), id: `gymkhana-getaway-driver-${variant}`, name: `Getaway Driver (${city.name})`,
    start, bounds, markers: Object.freeze([]), gymkhana: true, colliders: city.colliders });
  const r = TUNING.carRadius;
  const rules = `getaway-driver-r0-${variant}-${patrols}-${C.id}-${pursuit}`;

  function createRun() {
    return {
      phase: 'running', time: 0, stage: 'The safehouse', reason: '', result: null,
      event: null, eventSerial: 0, cones: [], conesHit: 0,
      // What the shared Getaway drawing and guidance read: no cameras, and the safehouse is the gate.
      cameras: [], nextCamera: 0, missed: [], missedShots: 0, exitOpen: true, lockedTries: 0,
      broken: city.breakables.map(() => null), smashes: 0, smashBonus: 0, smashLog: [],
      guide: null, guideIn: 0, shortcut: null, objectiveAt: 0, trail: [{ x: start.x, y: start.y }],
      edge: -1, t: 0, progressRate: 0, cover: city.edges.map((e) => new Uint8Array(Math.ceil(e.len) + 2)), ground: 0,
      // Attention.
      attention: 0, peakAttention: 0, calm: 0, seen: false, seenBy: [], heat: { speeding: false, drifting: false, hit: false, smash: false, scrutiny: false },
      suspicious: false, reported: false, reports: 0, lastImpactAt: -Infinity, wallHits: 0,
      speedingTime: 0, driftingTime: 0, seenTime: 0, topSpeed: 0,
      // Police.
      police: loops.map((loop, i) => createUnit(loop ? { ...specs[i], start: specs[i].start + (Array.isArray(phase) ? phase[i] ?? 0 : phase) / loop.length } : specs[i], loop, i)),
      pursuer: null, pursuing: false, detections: 0, escapes: 0, pursuitTime: 0, pursuitStart: 0, longestPursuit: 0,
      lose: 0, meter: 0, peakMeter: 0, minGap: Infinity, gap: Infinity, sees: false, level: 'clear', closeCalls: 0, wasClose: false,
    };
  }

  function result(run, scoring, ended) {
    const arrived = ended === 'arrived';
    const outcome = !arrived ? ended : run.detections ? 'lost them' : run.peakAttention < D.suspectAt ? 'ghost' : 'low profile';
    return {
      value: null, ended, outcome,
      time: run.time, distance: run.ground, peakAttention: run.peakAttention, reports: run.reports,
      detections: run.detections, escapes: run.escapes, pursuitTime: run.pursuitTime, longestPursuit: run.longestPursuit,
      minGap: Number.isFinite(run.minGap) ? run.minGap : null, peakMeter: run.peakMeter, closeCalls: run.closeCalls,
      speedingTime: run.speedingTime, driftingTime: run.driftingTime, seenTime: run.seenTime, topSpeed: run.topSpeed,
      smashes: run.smashes, wallHits: run.wallHits, lockedTries: run.lockedTries,
      score: scoring.score, bestCombo: scoring.bestCombo, bestMultiplier: scoring.bestMultiplier, spinouts: scoring.spinouts,
    };
  }

  function end(run, phase, reason, res) {
    run.phase = phase;
    run.reason = reason;
    run.result = res;
    run.stage = phase === 'complete' ? 'Safe' : 'Failed';
    run.pursuing = false;
  }

  function startPursuit(run, u, car, joined) {
    setMode(u, 'pursue', run.time);
    u.known = { x: car.x, y: car.y, vx: car.vx, vy: car.vy };
    u.knownAt = run.time;
    u.chases += 1;
    if (!run.pursuing) {
      run.pursuing = true;
      run.detections += 1;
      run.pursuitStart = run.time;
      run.lose = 0;
      run.reported = false;
      note(run, { type: 'spotted', by: u.name, detections: run.detections });
    } else if (joined) note(run, { type: 'joined', by: u.name });
    run.attention = 1;
  }

  function smash(run, scoring, i, by, speed) {
    const br = city.breakables[i];
    if (run.broken[i]) return;
    run.broken[i] = { by, time: run.time, speed, bonus: 0 };
    if (by === 'car') {
      run.smashes += 1;
      run.smashLog.push({ index: i, kind: br.kind, bonus: 0, time: run.time, x: br.cx, y: br.cy });
    }
    note(run, { type: 'smash', kind: br.kind, by, bonus: 0, total: 0, combo: !!scoring.combo });
  }

  function step(run, game, ax, ay, impact) {
    if (run.phase !== 'running') return;
    const T = TUNING;
    const dt = T.simStep;
    const { car, scoring } = game;
    run.time += dt;
    run.topSpeed = Math.max(run.topSpeed, car.speed);

    // Smashes by the car: through, slower, and noticed.
    let bump = 0;
    run.heat.smash = false;
    for (const br of city.breakables) {
      if (run.broken[br.index] || !segmentHitsBox(ax, ay, car.x, car.y, br, r)) continue;
      const before = car.speed;
      smash(run, scoring, br.index, 'car', before);
      car.vx *= BREAKABLE[br.kind].keep;
      car.vy *= BREAKABLE[br.kind].keep;
      updateDerived(car);
      bump += D.smashBump[br.kind];
      run.heat.smash = true;
    }
    run.heat.hit = false;
    if (impact > D.impactMin && run.time - run.lastImpactAt > 0.5) {
      run.wallHits += 1;
      bump += D.impactBump * clamp(impact / 15, 0, 1);
      run.heat.hit = true;
    }
    if (impact > D.impactMin) run.lastImpactAt = run.time;

    // New ground for the drift scoring, as Get the Footage pays it: each metre of street once.
    const at = locate(city, car.x, car.y, run.edge);
    const cover = run.cover[at.edge];
    let moved = 0;
    let newGround = 0;
    const mark = (lo, hi) => {
      for (let i = Math.max(0, Math.floor(lo)); i <= Math.min(cover.length - 1, Math.floor(hi)); i += 1) {
        if (!cover[i]) { cover[i] = 1; newGround += 1; }
      }
    };
    if (at.edge === run.edge) {
      const ds = at.t - run.t;
      moved = Math.abs(ds) <= car.speed * dt * 2 + 0.5 ? ds : 0;
      mark(Math.min(run.t, at.t), Math.max(run.t, at.t));
    } else mark(at.t, at.t);
    run.edge = at.edge;
    run.t = at.t;
    run.ground += newGround;
    run.progressRate += (Math.abs(moved) / dt - run.progressRate) * Math.min(1, T.progressRateSmoothing * dt);
    updateScoring(scoring, {
      speed: car.speed, forwardSpeed: car.forwardSpeed, slipAngle: car.slipAngle, surface: 'road', offCourse: false,
      progressRate: run.progressRate, newGround, handbrake: car.handbrake, impact,
    }, dt, T);
    const lastCrumb = run.trail[run.trail.length - 1];
    if (Math.hypot(car.x - lastCrumb.x, car.y - lastCrumb.y) >= URBAN_PURSUER.crumbSpacing) run.trail.push({ x: car.x, y: car.y });

    // The police cars move.
    const env = { city, colliders: city.colliders, trail: run.trail, mode: pursuit, broken: run.broken, time: run.time, bounds };
    for (const u of run.police) {
      if (u.mode === 'patrol') stepPatrol(u, D, dt);
      else if (u.mode === 'pursue') stepUrbanPursuer(u, car, env, dt, P);
      else if (u.mode === 'search') stepUrbanPursuer(u, car, env, dt, PS);
      else {
        // Responding to a report, or driving back to its loop: it heads for a place, not the car.
        const place = u.mode === 'respond' ? u.report : u.rejoin;
        stepUrbanPursuer(u, { x: place.x, y: place.y, vx: 0, vy: 0, speed: 0 }, env, dt, PR);
      }
      if (u.mode !== 'patrol') {
        for (const br of city.breakables) {
          if (run.broken[br.index] || !segmentHitsBox(u.prevX, u.prevY, u.x, u.y, br, r)) continue;
          smash(run, scoring, br.index, 'police', Math.abs(u.speed));
          u.speed *= BREAKABLE[br.kind].keep;
          u.smashes += 1;
        }
      }
    }

    // Who can see the car.
    run.seenBy = [];
    let scrutiny = false;
    for (const u of run.police) {
      u.watching = unitSees(city, u, car, D);
      if (!u.watching) continue;
      u.seenAt = run.time;
      run.seenBy.push(u.index);
      if (Math.hypot(car.x - u.x, car.y - u.y) < D.scrutinyRange) scrutiny = true;
    }
    run.seen = run.seenBy.length > 0;
    if (run.seen) run.seenTime += dt;

    // Attention.
    const over = Math.max(0, car.speed - D.speedLimit);
    const slip = Math.abs(car.slipAngle);
    const drift = car.speed > 8 ? clamp((slip - D.driftSlip) / (D.driftFull - D.driftSlip), 0, 1) : 0;
    run.heat.speeding = over > 0;
    run.heat.drifting = drift > 0;
    run.heat.scrutiny = scrutiny;
    if (over > 0) run.speedingTime += dt;
    if (drift > 0) run.driftingTime += dt;
    const factor = run.seen ? D.watched : 1;
    const rate = (D.speedRate * over / 10 + D.driftRate * drift) * factor + (scrutiny ? D.scrutiny : 0);
    const reckless = over > 0 || drift > 0 || bump > 0;
    run.calm = reckless ? 0 : run.calm + dt;
    let attention = run.attention + rate * dt + bump * factor;
    if (!run.seen && run.calm >= D.calmAfter) attention -= D.decay * dt;
    run.attention = clamp(attention, 0, 1);
    for (const u of run.police) u.spotting = u.watching && run.attention >= D.detectAt ? u.spotting + dt : 0;
    // Spotted: in sight, attention high, and for long enough (never without sight, even at spotTime 0).
    const spotted = (u) => u.watching && run.attention >= D.detectAt && u.spotting >= D.spotTime;

    // Detection: a police car sees the car while attention is high. Unseen, a full meter is reported.
    if (!run.pursuing) {
      const spotter = run.police.filter((u) => u.mode !== 'pursue' && spotted(u))
        .sort((a, b) => Math.hypot(car.x - a.x, car.y - a.y) - Math.hypot(car.x - b.x, car.y - b.y))[0];
      if (spotter) startPursuit(run, spotter, car, false);
      else if (run.attention >= 1 && !run.reported) {
        run.reported = true;
        run.reports += 1;
        const free = run.police.filter((u) => u.mode === 'patrol' || u.mode === 'return');
        const unit = free.sort((a, b) => Math.hypot(car.x - a.x, car.y - a.y) - Math.hypot(car.x - b.x, car.y - b.y))[0];
        if (unit) {
          setMode(unit, 'respond', run.time);
          unit.report = { x: car.x, y: car.y };
          unit.known = { x: car.x, y: car.y, vx: 0, vy: 0 };
          unit.knownAt = run.time;
        }
        note(run, { type: 'reported', by: unit?.name ?? null });
      }
    } else {
      // Another police car that sees the car mid-chase joins in.
      for (const u of run.police) if (u.mode !== 'pursue' && spotted(u)) startPursuit(run, u, car, true);
    }
    if (!run.suspicious && run.attention >= D.suspectAt && !run.pursuing) { run.suspicious = true; note(run, { type: 'suspicious' }); }
    if (run.suspicious && run.attention < D.suspectAt * 0.6) run.suspicious = false;
    // Calmed down: a report is stale, and whoever was sent goes back to patrol.
    if (run.reported && run.attention < D.suspectAt) {
      run.reported = false;
      for (const u of run.police) if (u.mode === 'respond') backToPatrol(u, run.time);
    }
    for (const u of run.police) {
      if (u.mode === 'search' && run.time - u.modeAt >= D.searchTime) backToPatrol(u, run.time);
      if (u.mode === 'respond' && Math.hypot(u.x - u.report.x, u.y - u.report.y) < 12 && run.time - u.modeAt > 1) {
        // At the reported place and nothing there: it looks around, then goes back.
        setMode(u, 'search', run.time);
      }
      if (u.mode === 'return' && Math.hypot(u.x - u.rejoin.x, u.y - u.rejoin.y) < 8) {
        u.s = u.rejoin.s;
        u.speed = u.loop ? Math.min(Math.abs(u.speed), loopAt(u.loop, u.s).v) : 0;
        setMode(u, 'patrol', run.time);
      }
    }

    // The chase: BUST RISK from the chasing cars, and the escape.
    const chasers = run.police.filter((u) => u.mode === 'pursue');
    let gap = Infinity;
    let effective = Infinity;
    let relSpeed = 0;
    for (const u of chasers) {
      const g = Math.hypot(car.x - u.x, car.y - u.y);
      gap = Math.min(gap, g);
      const sees = g >= C.radius || lineOfSight(city, u.x, u.y, car.x, car.y);
      if (sees && g < effective) {
        effective = g;
        relSpeed = Math.hypot(car.vx - Math.cos(u.heading) * u.speed, car.vy - Math.sin(u.heading) * u.speed);
      }
    }
    run.gap = gap;
    run.sees = Number.isFinite(effective);
    if (run.pursuing) {
      run.pursuitTime += dt;
      run.attention = 1;
      run.minGap = Math.min(run.minGap, gap);
      if (!run.seen && gap >= D.loseGap) run.lose = Math.min(1, run.lose + dt / D.loseTime);
      else if (run.seen) run.lose = Math.max(0, run.lose - (2 * dt) / D.loseTime);
      if (run.lose >= 1) {
        run.pursuing = false;
        run.escapes += 1;
        run.longestPursuit = Math.max(run.longestPursuit, run.time - run.pursuitStart);
        run.lose = 0;
        run.attention = D.afterEscape;
        run.calm = 0;
        for (const u of chasers) setMode(u, 'search', run.time);
        note(run, { type: 'lost', escapes: run.escapes });
      }
    }
    if (run.meter >= 0.25) run.wasClose = true;
    else if (run.wasClose && run.meter === 0) { run.wasClose = false; run.closeCalls += 1; }
    run.meter = clamp(run.meter + captureRate(C, run.pursuing ? effective : Infinity, relSpeed) * dt, 0, 1);
    run.peakMeter = Math.max(run.peakMeter, run.meter);
    run.peakAttention = Math.max(run.peakAttention, run.attention);
    run.level = run.meter >= 0.6 ? 'critical' : run.meter > 0 || (run.pursuing && gap < 25) ? 'close' : 'clear';
    if (run.meter >= 1) {
      run.level = 'busted';
      run.longestPursuit = Math.max(run.longestPursuit, run.time - run.pursuitStart);
      if (scoring.combo) loseCombo(scoring, 'busted');
      note(run, { type: 'busted' });
      end(run, 'failed', 'busted', result(run, scoring, 'busted'));
      return;
    }
    // The police car the HUD, the ring and the edge marker follow: the nearest chasing one, else the
    // nearest sent to a report, else the nearest.
    const near = (list) => list.slice().sort((a, b) => Math.hypot(car.x - a.x, car.y - a.y) - Math.hypot(car.x - b.x, car.y - b.y))[0];
    run.pursuer = near(chasers) ?? near(run.police.filter((u) => u.lights)) ?? near(run.police) ?? null;
    run.exitOpen = !run.pursuing;
    run.stage = run.pursuing ? 'Lose the police' : 'The safehouse';

    // The safehouse.
    if (gateCrossing(safehouse, ax, ay, car.x, car.y) === 1) {
      if (!run.pursuing) {
        bankCombo(scoring, 'escaped');
        note(run, { type: 'arrived' });
        end(run, 'complete', '', result(run, scoring, 'arrived'));
        return;
      }
      if (!(run.time - (run.lastLocked ?? -1) < 0.05)) {
        run.lockedTries += 1;
        note(run, { type: 'locked' });
      }
      run.lastLocked = run.time;
    }

    // The way to the safehouse, for the arrow, its turn call and the minimap.
    run.guideIn -= dt;
    if (run.guideIn <= 0) {
      run.guideIn = NAV.refresh;
      run.guide = planGuide(city, at, safehouse, { broken: run.broken, car, previous: run.guide, next: null });
    }

    if (run.time >= D.timeLimit) {
      if (scoring.combo) loseCombo(scoring, 'out of time');
      end(run, 'failed', 'out of time', result(run, scoring, 'out of time'));
    }
  }

  // Back to its loop, rejoining a little past the nearest point, so it carries on forward.
  function backToPatrol(u, time) {
    setMode(u, 'return', time);
    if (u.post) u.rejoin = { x: u.post.x, y: u.post.y, s: 0 };
    else {
      const s = (nearestOnLoop(u.loop, u.x, u.y) + 12) % u.loop.length;
      const q = loopAt(u.loop, s);
      u.rejoin = { x: q.x, y: q.y, s };
    }
    const p = u.rejoin;
    u.known = { x: p.x, y: p.y, vx: 0, vy: 0 };
    u.knownAt = time;
  }

  const name = `Getaway Driver (${city.name})`;
  return Object.freeze({
    id: `getaway-driver-${variant}`,
    name,
    shortName: city.name,
    kind: 'score',
    mission: 'driver',
    rules,
    layout: 'urban',
    variant,
    pursuit,
    tier: 'standard',
    timeLimit: D.timeLimit,
    captureModel: C,
    pursuerTuning: Object.freeze({ ...P, delay: 0 }),
    driverTuning: D,
    medalTargets: null,
    showmanship: false,
    smashBonus: null,
    tagline: 'KEEP YOUR HEAD DOWN.',
    brief: 'Get the car to the safehouse, top right of town. Drive like nobody\'s watching and nobody will be. Draw the police and you will have to lose them before the safehouse opens.',
    points: Object.freeze([
      'ATTENTION rises when you speed (over 45 mph), drift, hit things or smash them, and four times as fast when a police car can see you.',
      'Drive calmly out of sight of the police and ATTENTION drains. Fill it unseen and you are reported: a patrol car is sent to look.',
      'A police car that keeps you in sight at 70% ATTENTION or more gives chase, with BUST RISK as in Get the Footage. One is parked past the safehouse, watching the way in.',
      'To lose them: out of every police car\'s sight, and 45 m or more from every pursuer, for 5 seconds. The safehouse stays shut while they chase.',
      'Research build: no medals, no records. Every run is the same city and the same patrols.',
    ]),
    track,
    geometry: Object.freeze({ city, cameras: city.cameras, exit: safehouse, start, bounds, loops }),
    focus: Object.freeze({ x: start.x + Math.cos(start.heading) * 60, y: start.y + Math.sin(start.heading) * 60 }),
    createRun,
    step,
  });
}

export const GETAWAY_DRIVER = Object.freeze({
  id: 'getaway-driver',
  title: 'Getaway Driver',
  description: 'Lie low. Reach the safehouse. If they spot you, lose them first. (Research build)',
  environments: Object.freeze([createDriverChallenge()]),
});
