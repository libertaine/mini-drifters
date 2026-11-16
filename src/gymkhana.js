// Gymkhana: short driving challenges on a pad of open asphalt (docs/GYMKHANA.md). Pure logic,
// no browser code, so the tests drive exactly what the page drives.
//
// A challenge is a plain object:
//   { id, name, kind: 'time' | 'score', rules, layout, track, createRun(), step(run, game, ax, ay, impact) }
// game.js gives a 'gymkhana' session a fresh run from createRun when it starts or restarts, and
// calls step once per simulation tick after the car has moved from (ax, ay). A run is plain
// data: { phase: 'running' | 'complete' | 'failed', time, stage, reason, cones, result, ... }.
// When the phase leaves 'running' the session is over (game.js), and a completed run's
// result.value is what its record keeps (gymkhana-records.js): seconds for a 'time' challenge,
// points for a 'score' one. `rules` names the challenge's layout and rules: a change to either
// that changes what a result is worth needs a new id, never new numbers under the old one.
// Nothing here touches the car: the physics, the handling modes and the scoring rules are the
// game's own, read and never changed. Cones do not deflect the car; touching one is only noted.
import { TUNING } from './tuning.js';
import { gateCrossing } from './track.js';
import { padTrack } from './practice-pad.js';
import { updateScoring, bankCombo, loseCombo } from './scoring.js';

const DEG = Math.PI / 180;
export const CONE_RADIUS = 0.45;
// The car's footprint for touching a cone: its artwork's size before the renderer's 1.2 draw
// scale, so a cone the picture only just brushes is not counted.
const CAR_HALF_LENGTH = 2.45;
const CAR_HALF_WIDTH = 1.15;

// A gate is a line between two cones, crossed in the direction of `heading`. The same shape as
// track.js's checkpoints, so gateCrossing reads it. Point 1 is the right-hand cone.
function makeGate(cx, cy, heading, half) {
  const tx = Math.cos(heading);
  const ty = Math.sin(heading);
  return Object.freeze({ cx, cy, tx, ty, half, x1: cx - ty * half, y1: cy + tx * half, x2: cx + ty * half, y2: cy - tx * half });
}

// How far to the right of the gate's centre the move from a to b crossed it.
function crossingOffset(gate, ax, ay, bx, by) {
  const total = (bx - ax) * gate.tx + (by - ay) * gate.ty;
  const f = Math.abs(total) < 1e-9 ? 1 : ((gate.cx - ax) * gate.tx + (gate.cy - ay) * gate.ty) / total;
  const px = ax + (bx - ax) * f;
  const py = ay + (by - ay) * f;
  return (px - gate.cx) * -gate.ty + (py - gate.cy) * gate.tx;
}

const gateCones = (gate) => [{ x: gate.x1, y: gate.y1 }, { x: gate.x2, y: gate.y2 }];
const freshCones = (cones) => cones.map((c) => ({ x: c.x, y: c.y, hit: false, dx: 0, dy: 0 }));

// Marks every standing cone the car's footprint now covers. Returns how many fell this step.
function knockCones(cones, car) {
  const cos = Math.cos(car.heading);
  const sin = Math.sin(car.heading);
  let fallen = 0;
  for (const cone of cones) {
    if (cone.hit) continue;
    const dx = cone.x - car.x;
    const dy = cone.y - car.y;
    const along = dx * cos + dy * sin;
    const across = -dx * sin + dy * cos;
    if (Math.abs(along) > CAR_HALF_LENGTH + CONE_RADIUS || Math.abs(across) > CAR_HALF_WIDTH + CONE_RADIUS) continue;
    cone.hit = true;
    // Only for the picture: the cone is drawn knocked a little way along the car's travel.
    const speed = Math.max(car.speed, 0.001);
    cone.dx = car.vx / speed * 1.6;
    cone.dy = car.vy / speed * 1.6;
    fallen += 1;
  }
  return fallen;
}

function challengeTrack(id, name, start, bounds) {
  return Object.freeze({ ...padTrack(), id, name, start: Object.freeze(start), bounds: Object.freeze(bounds), markers: Object.freeze([]), gymkhana: true });
}

function end(run, phase, reason, result) {
  run.phase = phase;
  run.reason = reason;
  run.result = result;
  run.stage = phase === 'complete' ? 'Complete' : 'Failed';
}

// Something the HUD says once: a cone has fallen. As with the scoring's own events, the latest is kept beside a serial that counts them.
function note(run, event) {
  run.event = event;
  run.eventSerial += 1;
}

// --- Precision 180 ---------------------------------------------------------------------------
// From a standing start: through the gate, down the box into the turn zone at its far end,
// bring the car round, and back out through the same gate nose first. The clock runs from the
// first pedal press to the gate on the way out.
//
// Two of its numbers were measured, not chosen:
//   - the box is 14 m wide, less than a grip U-turn needs at any speed worth arriving at, so
//     the quick way round is to slide it;
//   - the car has to reach the turn zone, 16 m in. Without that, the quickest run turns early
//     and slowly at the mouth and never uses the box.
function precisionChallenge() {
  const P = Object.freeze({
    start: { x: -50, y: 0, heading: 0 },
    gate: makeGate(-14, 0, 0, 4),
    box: Object.freeze({ minX: 0, maxX: 30, minY: -7, maxY: 7 }),
    zoneFrom: 16,            // the turn zone is the box from here to its far end
    conePenalty: 2,          // seconds added per cone touched
    timeLimit: 30,
    slideSlip: 25 * DEG,     // a turn whose rear tyres slipped this much is called a slide in the feedback
    reverseSpeed: 0.5,       // backing up faster than this, for longer than reverseTime, is "reversed"
    reverseTime: 0.25,
  });
  const { box, gate, zoneFrom } = P;
  const cones = Object.freeze([
    ...gateCones(gate),
    { x: box.minX, y: box.minY }, { x: box.minX, y: box.maxY },
    { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY },
    { x: box.maxX, y: 0 },
  ]);

  function createRun() {
    return {
      phase: 'running', time: 0, stage: 'Through the gate, down to the turn zone', reason: '', result: null,
      event: null, eventSerial: 0,
      cones: freshCones(cones), conesHit: 0,
      gateIn: false, entered: false, reached: false, goingOut: false,
      entrySpeed: 0, depth: 0, peakSlip: 0, peakRearSlip: 0, minSpeed: Infinity,
      reverseTime: 0, reversed: false,
    };
  }

  function result(run, exit) {
    const penalty = run.conesHit * P.conePenalty;
    // To the millisecond, so a saved time is a plain number and not a sum of 120ths.
    const total = Math.round((run.time + penalty) * 1000) / 1000;
    return {
      // Only a completed run has a value: it is what the record keeps.
      value: exit ? total : null,
      time: run.time, penalty, total, cones: run.conesHit,
      entrySpeed: run.entrySpeed, depth: run.depth, peakSlip: run.peakSlip,
      minSpeed: Number.isFinite(run.minSpeed) ? run.minSpeed : 0,
      // Named from the rear tyres, not the body: on full lock at walking pace the body's own angle
      // is large with nothing sliding.
      technique: run.reversed ? 'reversed' : run.peakRearSlip >= P.slideSlip ? 'slide' : 'grip',
      ...exit,
    };
  }

  function step(run, game, ax, ay) {
    if (run.phase !== 'running') return;
    const { car } = game;
    run.time += TUNING.simStep;
    const fallen = knockCones(run.cones, car);
    if (fallen) {
      run.conesHit += fallen;
      note(run, { type: 'cone', count: fallen, penalty: fallen * P.conePenalty });
    }

    const crossed = gateCrossing(gate, ax, ay, car.x, car.y);
    if (crossed === 1 && !run.entered) run.gateIn = true;

    const inBox = car.x > box.minX && car.x < box.maxX && car.y > box.minY && car.y < box.maxY;
    if (inBox && !run.entered && run.gateIn) {
      run.entered = true;
      run.entrySpeed = car.speed;
    }
    if (run.entered) {
      run.depth = Math.max(run.depth, car.x - box.minX);
      if (car.speed > 3) {
        run.peakSlip = Math.max(run.peakSlip, Math.abs(car.slipAngle));
        run.peakRearSlip = Math.max(run.peakRearSlip, Math.abs(car.rearSlip));
      }
      run.minSpeed = Math.min(run.minSpeed, car.speed);
      // Driving backwards in reverse gear. A car sliding tail first through a handbrake turn is not reversing.
      run.reverseTime = car.reversing && car.forwardSpeed < -P.reverseSpeed ? run.reverseTime + TUNING.simStep : 0;
      if (run.reverseTime >= P.reverseTime) run.reversed = true;
      // Out through the mouth (x back under minX) is the way out. Any other edge is not.
      if (!inBox && car.x > box.minX) { end(run, 'failed', 'left the box', result(run, null)); return; }
      if (inBox && car.x >= box.minX + zoneFrom) run.reached = true;
      run.goingOut = run.reached && Math.cos(car.heading) < -0.5 && car.forwardSpeed > 0;
      run.stage = !run.reached ? 'Down to the turn zone' : run.goingOut ? 'Back out through the gate' : 'Turn it round';
    }

    if (crossed === -1 && run.entered) {
      if (!run.reached) { end(run, 'failed', 'turned before the turn zone', result(run, null)); return; }
      // Nose first, and pointing the way it is going: backing out, or sliding out tail first, is not a 180.
      const facing = Math.cos(car.heading) < -0.5 && car.forwardSpeed > 0;
      if (!facing) { end(run, 'failed', 'came out backwards', result(run, null)); return; }
      end(run, 'complete', '', result(run, {
        // Positive is to the driver's right on the way out.
        exitOffset: -crossingOffset(gate, ax, ay, car.x, car.y),
        exitSpeed: car.speed,
        exitAngle: Math.abs(Math.atan2(Math.sin(car.heading - Math.PI), Math.cos(car.heading - Math.PI))),
      }));
      return;
    }
    if (run.time >= P.timeLimit) end(run, 'failed', 'out of time', result(run, null));
  }

  return Object.freeze({
    id: 'precision-180',
    name: 'Precision 180',
    kind: 'time',
    rules: 'precision-180-1',
    layout: 'box',
    brief: 'Through the gate, down the box to the turn zone, bring the car round, and back out through the gate nose first.',
    points: Object.freeze([
      'Fastest time wins. The clock starts when you move, and stops at the gate on the way out.',
      'Each cone you touch adds 2 seconds.',
      'The run fails if you leave the box by its sides or far end, turn before the turn zone, or come out backwards.',
    ]),
    track: challengeTrack('gymkhana-precision-180', 'Precision 180', P.start, { minX: -95, maxX: 75, minY: -50, maxY: 50 }),
    geometry: Object.freeze({ ...P, cones }),
    focus: Object.freeze({ x: box.maxX, y: 0 }),   // where the view leans before the run starts
    createRun,
    step,
  });
}
export const PRECISION_180 = precisionChallenge();

// --- Linked Drift and One Drift --------------------------------------------------------------
// A run-up, then three bends that alternate right, left, right, with a gate at each apex and at
// each change of direction. The drift is scored by the game's own rules (scoring.js, TUNING),
// fed with progress along this course in place of progress round a circuit, so each metre of
// the course pays once and going round in circles pays nothing. The run ends at the finish gate.
const COURSE_STEP = 1;
function buildCourse(segments) {
  const points = [];
  let x = 0;
  let y = 0;
  let heading = 0;
  let s = 0;
  let nextS = 0;
  const fine = 0.05;
  for (const seg of segments) {
    const length = seg.straight ?? Math.abs(seg.turn * DEG) * seg.radius;
    const bend = seg.straight ? 0 : Math.sign(seg.turn) / seg.radius; // positive turns right on screen
    for (let d = 0; d < length - 1e-9; d += fine) {
      // One point per metre, so a point's index is its distance along the course.
      if (s >= nextS - 1e-9) {
        points.push({ x, y, tx: Math.cos(heading), ty: Math.sin(heading), s: nextS, bend });
        nextS += COURSE_STEP;
      }
      heading += bend * fine;
      x += Math.cos(heading) * fine;
      y += Math.sin(heading) * fine;
      s += fine;
    }
  }
  // Centre the course on the pad.
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const ox = (Math.min(...xs) + Math.max(...xs)) / 2;
  const oy = (Math.min(...ys) + Math.max(...ys)) / 2;
  for (const p of points) { p.x -= ox; p.y -= oy; Object.freeze(p); }
  return Object.freeze({
    points: Object.freeze(points),
    extent: Object.freeze({ minX: Math.min(...xs) - ox, maxX: Math.max(...xs) - ox, minY: Math.min(...ys) - oy, maxY: Math.max(...ys) - oy }),
  });
}

const LINKED_SEGMENTS = Object.freeze([
  { straight: 45 },
  { turn: 90, radius: 38 },
  { turn: -150, radius: 34 },
  { turn: 120, radius: 34 },
  { straight: 50 },                 // the last 30 m are run-off past the finish
]);
const LINKED_RUNOFF = 30;
const LINKED_LENGTHS = LINKED_SEGMENTS.map((seg) => seg.straight ?? Math.abs(seg.turn * DEG) * seg.radius);
const LINKED_STARTS = LINKED_LENGTHS.map((_, i) => LINKED_LENGTHS.slice(0, i).reduce((a, b) => a + b, 0));
const LINKED_FINISH_S = Math.round(LINKED_STARTS[4] + LINKED_LENGTHS[4] - LINKED_RUNOFF);
const LINKED_WALL = 45; // open asphalt between the course and the wall
const linkedCourse = buildCourse(LINKED_SEGMENTS);

// The nearest course point to the car, searched only near where it last was, so the car can
// never be placed on a part of the course that merely passes close by.
export function projectOnCourse(course, x, y, hint) {
  const { points } = course;
  const from = Math.max(0, hint - 12);
  const to = Math.min(points.length - 1, hint + 30);
  let best = from;
  let bestD = Infinity;
  for (let i = from; i <= to; i += 1) {
    const d = (points[i].x - x) ** 2 + (points[i].y - y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  const p = points[best];
  const along = (x - p.x) * p.tx + (y - p.y) * p.ty;
  return { index: best, s: p.s + Math.max(-COURSE_STEP, Math.min(COURSE_STEP, along)), offset: (x - p.x) * -p.ty + (y - p.y) * p.tx };
}

// The one layout both drift challenges are driven on. A gate is 16 m wide in a 20 m course:
// at 13 m, the first width tried, most scripted drifters clipped a cone.
const LINKED = (() => {
  const L = {
    course: linkedCourse,
    corridor: 10,             // metres either side of the course line that count as on the course
    gateHalf: 8,
    gateMissMargin: 10,       // a gate is missed once the car is this far past it along the course
    timeLimit: 60,
    finishS: LINKED_FINISH_S,
  };
  const courseGate = (s, label) => {
    const p = linkedCourse.points[Math.round(s / COURSE_STEP)];
    return Object.freeze({ ...makeGate(p.x, p.y, Math.atan2(p.ty, p.tx), L.gateHalf), s: p.s, label });
  };
  // An apex gate in the middle of each bend, a transition gate where the bends meet, and the finish.
  const gates = Object.freeze([
    courseGate(LINKED_STARTS[1] + LINKED_LENGTHS[1] / 2, '1'),
    courseGate(LINKED_STARTS[2], '2'),
    courseGate(LINKED_STARTS[2] + LINKED_LENGTHS[2] / 2, '3'),
    courseGate(LINKED_STARTS[3], '4'),
    courseGate(LINKED_STARTS[3] + LINKED_LENGTHS[3] / 2, '5'),
    courseGate(LINKED_FINISH_S, 'finish'),
  ]);
  const first = linkedCourse.points[0];
  const { extent } = linkedCourse;
  return Object.freeze({
    geometry: Object.freeze({ ...L, gates, cones: Object.freeze(gates.flatMap(gateCones)), segments: LINKED_SEGMENTS }),
    track: challengeTrack('gymkhana-linked-drift', 'Linked Drift',
      { x: first.x, y: first.y, heading: Math.atan2(first.ty, first.tx) },
      { minX: extent.minX - LINKED_WALL, maxX: extent.maxX + LINKED_WALL, minY: extent.minY - LINKED_WALL, maxY: extent.maxY + LINKED_WALL }),
    focus: Object.freeze({ x: linkedCourse.points[72].x, y: linkedCourse.points[72].y }),
  });
})();

// Linked Drift is the game's combo rules from the start to the finish gate, banking and
// relinking freely. One Drift is a single combo on the same course: the run is over when the
// first one banks, with what it banked, and has failed if that combo is lost.
function linkedChallenge({ oneDrift }) {
  const L = LINKED.geometry;
  const { gates } = L;

  function createRun() {
    return {
      phase: 'running', time: 0, stage: 'Gate 1', reason: '', result: null,
      event: null, eventSerial: 0,
      cones: freshCones(L.cones), conesHit: 0,
      index: 0, s: 0, furthest: 0, progressRate: 0, offCourse: false,
      nextGate: 0, gates: gates.map(() => null),   // per gate: null, or { drifting, slip, speed }
      hadCombo: false,
    };
  }

  function result(run, scoring, ended) {
    return {
      // A failed run shows what it banked, but has no value for the records.
      value: ended === 'failed' ? null : scoring.score,
      score: scoring.score, bestCombo: scoring.bestCombo, bestMultiplier: scoring.bestMultiplier, spinouts: scoring.spinouts,
      gatesDrifted: run.gates.filter((g) => g?.drifting).length, gatesPassed: run.gates.filter(Boolean).length, gates: gates.length,
      cones: run.conesHit, time: run.time, distance: run.furthest, ended,
    };
  }

  function step(run, game, ax, ay, impact) {
    if (run.phase !== 'running') return;
    const T = TUNING;
    const dt = T.simStep;
    const { car, scoring } = game;
    run.time += dt;

    // Progress along the course, as game.js counts progress round a circuit.
    const at = projectOnCourse(L.course, car.x, car.y, run.index);
    const ds = at.s - run.s;
    const moved = Math.abs(ds) <= car.speed * dt * 2 + 0.5 ? ds : 0;
    run.index = at.index;
    run.s = at.s;
    const newGround = Math.max(0, at.s - run.furthest);
    if (newGround > 0) run.furthest = at.s;
    run.progressRate += (moved / dt - run.progressRate) * Math.min(1, T.progressRateSmoothing * dt);
    run.offCourse = Math.abs(at.offset) > L.corridor;

    const comboBefore = scoring.combo;
    const fallen = knockCones(run.cones, car);
    if (fallen) {
      run.conesHit += fallen;
      note(run, { type: 'cone', count: fallen });
      if (scoring.combo) loseCombo(scoring, 'hit a cone');
    }

    updateScoring(scoring, {
      speed: car.speed,
      forwardSpeed: car.forwardSpeed,
      slipAngle: car.slipAngle,
      // Off the painted course counts as off the road, to the scoring only. The asphalt grips the same.
      surface: run.offCourse ? 'grass' : 'road',
      progressRate: run.progressRate,
      newGround,
      handbrake: car.handbrake,
      impact,
    }, dt, T);

    // A loss still fails One Drift when the same step crosses the finish. Banking is
    // identified by the first combo exhausting its grace, even when its rounded pay is zero
    // and the scoring deliberately emits no HUD announcement. Scoring itself is unchanged.
    const firstBanked = comboBefore && comboBefore.grace <= 0;
    if (oneDrift && comboBefore && scoring.combo !== comboBefore && !firstBanked) {
      end(run, 'failed', `drift lost: ${fallen ? 'hit a cone' : scoring.event?.reason ?? 'it faded out'}`, result(run, scoring, 'failed'));
      return;
    }

    const gate = gates[run.nextGate];
    if (gateCrossing(gate, ax, ay, car.x, car.y) === 1) {
      run.gates[run.nextGate] = { drifting: scoring.drifting, slip: Math.abs(car.slipAngle), speed: car.speed };
      run.nextGate += 1;
      if (gate.label === 'finish') {
        bankCombo(scoring, 'finished');
        end(run, 'complete', '', result(run, scoring, 'finish'));
        return;
      }
      const next = gates[run.nextGate];
      run.stage = next.label === 'finish' ? 'Finish' : `Gate ${next.label}`;
    } else if (at.s > gate.s + L.gateMissMargin) {
      if (scoring.combo) loseCombo(scoring, 'missed a gate');
      end(run, 'failed', gate.label === 'finish' ? 'missed the finish' : `missed gate ${gate.label}`, result(run, scoring, 'failed'));
      return;
    }

    if (oneDrift) {
      if (scoring.combo) run.hadCombo = true;
      else if (run.hadCombo) {
        if (firstBanked) end(run, 'complete', `drift banked after ${Math.round(run.furthest)} m`, result(run, scoring, 'banked'));
        else end(run, 'failed', `drift lost: ${fallen ? 'hit a cone' : scoring.event?.reason ?? 'it faded out'}`, result(run, scoring, 'failed'));
        return;
      }
    }
    if (run.time >= L.timeLimit) {
      if (scoring.combo) loseCombo(scoring, 'out of time');
      end(run, 'failed', 'out of time', result(run, scoring, 'failed'));
    }
  }

  return Object.freeze({
    id: oneDrift ? 'one-drift' : 'linked-drift',
    name: oneDrift ? 'One Drift' : 'Linked Drift',
    kind: 'score',
    rules: oneDrift ? 'one-drift-1' : 'linked-drift-1',
    layout: 'course',
    brief: oneDrift
      ? 'The Linked Drift course in a single drift: start one combo, and carry it as far as you can.'
      : 'Take every gate in order, and drift the three bends between them.',
    points: Object.freeze(oneDrift ? [
      'Highest score wins. The run ends when your first combo banks, and keeps what it banked.',
      'The run fails if that combo is lost to a spin, a cone or the edge of the course.',
      'Missing a gate fails the run.',
    ] : [
      'Highest score wins. Drifts score as they do on a circuit: link them to build the multiplier.',
      'A spin, a cone or leaving the course loses the unbanked points.',
      'Missing a gate fails the run. The finish gate banks the combo you are carrying.',
    ]),
    track: LINKED.track,
    geometry: L,
    focus: LINKED.focus,
    createRun,
    step,
  });
}
export const LINKED_DRIFT = linkedChallenge({ oneDrift: false });
export const ONE_DRIFT = linkedChallenge({ oneDrift: true });

// --- Slalom Sprint ---------------------------------------------------------------------------
// From a standing start: weave through a line of cones, left of the first and then alternating,
// and cross the finish gate. The clock runs from the first pedal press to the gate. Seven cones
// 22 m apart, the practice pad's own slalom spacing, a 36 m run-up and 30 m to the finish, with
// the course centred on the pad.
//
// A cone is passed at the moment the car's centre draws level with it. At that moment the
// centre must be on the cone's required side and inside the lane: there is no other way past,
// so no cone can be skipped, taken twice or left in doubt. A car driven straight over a cone
// is on neither side of it and fails.
function slalomChallenge() {
  const S = Object.freeze({
    count: 7,
    spacing: 22,
    runUp: 36,               // from the start to the first cone
    runOut: 30,              // from the last cone to the finish gate
    lane: 12,                // the painted lane reaches this far either side of the cones
    finishHalf: 4,
    firstSide: -1,           // -1: the first cone is passed on its left. The sides then alternate.
    conePenalty: 2,          // seconds added per cone touched
    timeLimit: 40,
  });
  const length = S.runUp + (S.count - 1) * S.spacing + S.runOut;
  const startX = -length / 2;
  const slalom = Object.freeze(Array.from({ length: S.count }, (_, i) => Object.freeze({
    x: startX + S.runUp + i * S.spacing, y: 0, side: i % 2 === 0 ? S.firstSide : -S.firstSide, number: i + 1,
  })));
  const finish = makeGate(startX + length, 0, 0, S.finishHalf);
  const cones = Object.freeze([...slalom.map((c) => ({ x: c.x, y: c.y })), ...gateCones(finish)]);
  const start = { x: startX, y: 0, heading: 0 };
  const sideName = (side) => (side < 0 ? 'Left' : 'Right');
  const stageFor = (index) => (index < S.count ? `${sideName(slalom[index].side)} of cone ${index + 1}` : 'The finish gate');

  function createRun() {
    return {
      phase: 'running', time: 0, stage: stageFor(0), reason: '', result: null,
      event: null, eventSerial: 0,
      cones: freshCones(cones), conesHit: 0,
      next: 0,               // the next cone to pass; S.count once every cone is behind the car
      failedAt: -1,          // the cone the run failed at, for the picture
      enteredAt: 0, leftAt: 0, topSpeed: 0, peakSlip: 0,
    };
  }

  function result(run, finished) {
    const penalty = run.conesHit * S.conePenalty;
    // To the millisecond, so a saved time is a plain number and not a sum of 120ths.
    const total = Math.round((run.time + penalty) * 1000) / 1000;
    const through = run.leftAt > run.enteredAt ? run.leftAt - run.enteredAt : 0;
    return {
      // Only a completed run has a value: it is what the record keeps.
      value: finished ? total : null,
      time: run.time, penalty, total, cones: run.conesHit,
      passed: run.next, count: S.count,
      topSpeed: run.topSpeed, peakSlip: run.peakSlip,
      // Average speed from the first cone to the last, once both are behind the car.
      weaveSpeed: through > 0 ? ((S.count - 1) * S.spacing) / through : 0,
    };
  }

  function step(run, game, ax, ay) {
    if (run.phase !== 'running') return;
    const { car } = game;
    run.time += TUNING.simStep;
    const fallen = knockCones(run.cones, car);
    if (fallen) {
      run.conesHit += fallen;
      note(run, { type: 'cone', count: fallen, penalty: fallen * S.conePenalty });
    }
    run.topSpeed = Math.max(run.topSpeed, car.speed);
    if (run.next > 0 && run.next < S.count && car.speed > 3) run.peakSlip = Math.max(run.peakSlip, Math.abs(car.slipAngle));

    if (run.next < S.count) {
      const cone = slalom[run.next];
      if (ax < cone.x && car.x >= cone.x) {
        // Level with the cone on this step. `off` is how far to its required side the centre is.
        const y = ay + ((car.y - ay) * (cone.x - ax)) / (car.x - ax);
        const off = (y - cone.y) * cone.side;
        if (off <= 0 || off > S.lane) {
          run.failedAt = run.next;
          end(run, 'failed', off > S.lane ? `left the lane at cone ${cone.number}` : `wrong side of cone ${cone.number}`, result(run, false));
          return;
        }
        if (run.next === 0) run.enteredAt = run.time;
        run.next += 1;
        if (run.next === S.count) run.leftAt = run.time;
        run.stage = stageFor(run.next);
      }
    } else if (gateCrossing(finish, ax, ay, car.x, car.y) === 1) {
      end(run, 'complete', '', result(run, true));
      return;
    } else if (ax < finish.cx && car.x >= finish.cx) {
      end(run, 'failed', 'missed the finish', result(run, false));
      return;
    }
    if (run.time >= S.timeLimit) end(run, 'failed', 'out of time', result(run, false));
  }

  return Object.freeze({
    id: 'slalom-sprint',
    name: 'Slalom Sprint',
    kind: 'time',
    rules: 'slalom-sprint-1',
    layout: 'slalom',
    brief: 'Weave through the seven cones, left of the first and then alternating, and cross the finish gate.',
    points: Object.freeze([
      'Fastest time wins. The clock starts when you move, and stops at the finish gate.',
      'Each cone you touch adds 2 seconds.',
      'The run fails if you pass a cone on the wrong side, leave the painted lane, or miss the finish gate.',
    ]),
    track: challengeTrack('gymkhana-slalom-sprint', 'Slalom Sprint', start,
      { minX: startX - 45, maxX: startX + length + 70, minY: -50, maxY: 50 }),
    geometry: Object.freeze({ ...S, length, start, slalom, finish, cones }),
    focus: Object.freeze({ x: slalom[3].x, y: 0 }),   // where the view leans before the run starts
    createRun,
    step,
  });
}
export const SLALOM_SPRINT = slalomChallenge();

export const GYMKHANA_CHALLENGES = Object.freeze([PRECISION_180, LINKED_DRIFT, ONE_DRIFT, SLALOM_SPRINT]);
export const GYMKHANA_CHALLENGE_IDS = Object.freeze(GYMKHANA_CHALLENGES.map((c) => c.id));

export function challengeById(id) {
  return GYMKHANA_CHALLENGES.find((c) => c.id === id) ?? null;
}
