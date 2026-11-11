// The session: ties the car, track, laps and scoring together on a fixed
// timestep. Contains no browser code, so the tests can run it directly.
import { TUNING } from './tuning.js';
import { drivingCommands } from './controls.js';
import { createCar, stepCar, updateDerived } from './physics.js';
import { DEFAULT_TRACK_ID, trackById, projectOnTrack, surfaceFromDistance, trackDelta } from './track.js';
import { createLaps, updateLaps } from './laps.js';
import { createScoring, updateScoring, bankCombo, loseCombo, currentMultiplier } from './scoring.js';
import { createGhost, beginGhostRecording, recordGhostTick } from './ghost.js';

export const NO_INPUT = Object.freeze({ up: false, down: false, left: false, right: false, handbrake: false });

export function createGame(track = trackById(DEFAULT_TRACK_ID), { onRunEvent = null } = {}) {
  const game = { onRunEvent, track, state: 'menu', paused: false, ghostVisible: true };
  resetRun(game);
  game.state = 'menu';
  return game;
}

function resetRun(game) {
  const { track } = game;
  game.car = createCar(track.start);
  updateDerived(game.car);
  game.prev = { x: game.car.x, y: game.car.y, heading: game.car.heading };
  game.laps = createLaps();
  game.scoring = createScoring();
  game.runTime = 0;
  game.accumulator = 0;
  game.ticks = 0;
  game.paused = false;
  game.lapEvent = null;
  game.lapEventSerial = 0;
  game.wrongWayTime = 0;
  game.results = null;
  // Points only count from laps that count. Everything scored on a lap is held against
  // that lap, and handed back if the lap is voided at the line. Kept outside the scoring
  // and lap state, which stay exactly as they were.
  game.lapScoreStart = 0;   // the score when this lap began
  game.lapBestCombo = 0;    // the best combo banked on this lap
  game.lapBestMultiplier = 1;
  game.countedBestCombo = 0;
  game.countedBestMultiplier = 1;
  game.forfeited = 0;       // points from voided laps, which the run doesn't keep
  game.lastForfeit = 0;     // what the most recent voided lap cost, for the HUD

  const at = projectOnTrack(track, game.car.x, game.car.y);
  game.trackS = at.s;
  game.trackInfo = at;
  game.progress = 0;       // unwrapped distance along the circuit
  game.furthest = 0;       // the "new ground" high-water mark
  game.startS = at.s;
  game.reached = 0;        // the same mark, placed by the checkpoints rather than counted
  game.credited = 0;       // all the new ground the scoring has been given this run
  game.progressRate = 0;   // smoothed along-track speed
  game.lastImpact = 0;
  game.ghost = createGhost(track);
  game.runId = (game.runId ?? 0) + 1;
}

// Start (or restart) a run. The clock waits on the grid for the first pedal press.
// A run that shouldn't leave a ghost behind passes { ghost: false }, and a run on another
// circuit passes { track }. Lessons explicitly pass { mode: 'tutorial' } for observers.
// Everything about the session is rebuilt either way, so nothing
// from the last circuit's run carries over. Without { track }, the run stays where it was.
export function startRun(game, { ghost = true, track = game.track, mode = 'normal' } = {}) {
  game.track = track;
  resetRun(game);
  if (!ghost) game.ghost = null;
  game.state = 'ready';
  game.onRunEvent?.({ type: 'start', trackId: track.id, runId: game.runId, mode });
}

export const restartRun = startRun;

// Abandon the session and go back to the state the game opens in. Nothing runs from here
// until the next startRun: advance() does nothing on the menu.
export function returnToMenu(game) {
  game.onRunEvent?.({ type: 'abandon' });
  resetRun(game);
  game.state = 'menu';
}

export function togglePause(game) {
  if (game.state === 'ready' || game.state === 'racing') game.paused = !game.paused;
  return game.paused;
}

// Only hides the ghost. It keeps recording, so it can come back at any time.
export function toggleGhost(game) {
  game.ghostVisible = !game.ghostVisible;
  return game.ghostVisible;
}

function resolveBarrier(game) {
  const { car, track } = game;
  const T = TUNING;
  const { minX, maxX, minY, maxY } = track.bounds;
  const r = T.carRadius;
  let impact = 0;
  const hit = (axis, normal, limit) => {
    const speedIn = -(axis === 'x' ? car.vx : car.vy) * normal;
    if (speedIn <= 0) return;
    impact = Math.max(impact, speedIn);
    if (axis === 'x') {
      car.x = limit;
      car.vx = normal * speedIn * T.barrierRestitution;
      car.vy *= T.barrierScrub;
    } else {
      car.y = limit;
      car.vy = normal * speedIn * T.barrierRestitution;
      car.vx *= T.barrierScrub;
    }
    car.yawRate *= 0.6;
  };
  if (car.x - r < minX) hit('x', 1, minX + r);
  if (car.x + r > maxX) hit('x', -1, maxX - r);
  if (car.y - r < minY) hit('y', 1, minY + r);
  if (car.y + r > maxY) hit('y', -1, maxY - r);
  return impact;
}

// The counted progress above can drift from where the car really is, because a jump across
// the infield is left out of it. After a cut back across the infield it runs ahead of the
// car, and would pay for road the car has already driven. The checkpoints can't drift:
// between the last gate the car crossed and the next one, its place on the circuit is known.
// So counted new ground is only paid out where the checkpoints agree the car is, close to
// the furthest place it has really been, and never more in total than it has really gone.
const SECTOR_TOLERANCE = 12; // clean driving strays under a metre past its sector, wild driving about 7 m
const REACHED_SLACK = 4;     // the nearest centreline point hops a metre or two inside a hairpin

function checkedNewGround(game, s, counted) {
  const { track, laps } = game;
  const sector = track.length / (track.gates.length + 1);
  const centre = (laps.next + 0.5) * sector;
  const offset = trackDelta(track, centre, s);
  if (Math.abs(offset) > sector / 2 + SECTOR_TOLERANCE) return 0;
  const placed = (laps.completed + laps.voided) * track.length + centre + offset - game.startS;
  const nearFront = placed >= game.reached - REACHED_SLACK;
  if (placed > game.reached) game.reached = placed;
  if (!nearFront || counted <= 0) return 0;
  const paid = Math.min(counted, game.reached + REACHED_SLACK - game.credited);
  if (paid <= 0) return 0;
  game.credited += paid;
  return paid;
}

// One fixed simulation step.
export function tick(game, input = NO_INPUT) {
  const T = TUNING;
  const dt = T.simStep;
  const { car, track } = game;

  game.prev.x = car.x;
  game.prev.y = car.y;
  game.prev.heading = car.heading;

  const commands = drivingCommands(input);
  if (game.state === 'ready' && (commands.accelerator > 0 || commands.brake > 0)) {
    game.state = 'racing';
    if (game.ghost) beginGhostRecording(game.ghost, car.x, car.y, car.heading);
  }
  const racing = game.state === 'racing';

  const ax = car.x;
  const ay = car.y;
  stepCar(car, input, surfaceFromDistance(track, game.trackInfo.distance), dt, T);
  const impact = resolveBarrier(game);
  if (impact > 0) updateDerived(car);
  game.lastImpact = impact;

  // Along-track progress. Jumps (the nearest centreline point hopping to another
  // part of the circuit while crossing the infield) are not treated as driving.
  const at = projectOnTrack(track, car.x, car.y);
  game.trackInfo = at;
  const ds = trackDelta(track, game.trackS, at.s);
  game.trackS = at.s;
  const plausible = Math.abs(ds) <= car.speed * dt * 2 + 0.5;
  const moved = plausible ? ds : 0;
  game.progress += moved;
  const counted = Math.max(0, game.progress - game.furthest);
  if (counted > 0) game.furthest = game.progress;
  const newGround = checkedNewGround(game, at.s, counted);
  const instantRate = moved / dt;
  game.progressRate += (instantRate - game.progressRate) * Math.min(1, T.progressRateSmoothing * dt);

  // A car heading the wrong way gets a gentle reminder from the HUD.
  const along = car.vx * at.tx + car.vy * at.ty;
  game.wrongWayTime = along < -4 ? game.wrongWayTime + dt : 0;

  game.ticks += 1;
  if (!racing) return;

  game.runTime += dt;
  const scoreBefore = game.scoring.score;
  updateScoring(game.scoring, {
    speed: car.speed,
    forwardSpeed: car.forwardSpeed,
    slipAngle: car.slipAngle,
    surface: car.surface,
    progressRate: game.progressRate,
    newGround,
    handbrake: car.handbrake,
    impact,
  }, dt, T);
  noteLapScoring(game, game.scoring.score - scoreBefore);

  const lapResult = updateLaps(game.laps, track, ax, ay, car.x, car.y, dt);
  if (lapResult) {
    settleLap(game, lapResult);
    game.lapEvent = lapResult;
    game.lapEventSerial += 1;
    game.onRunEvent?.({ type: 'lap', trackId: track.id, runId: game.runId, valid: lapResult === 'lap', time: game.laps.lastLap });
  }
  // The ghost gets copies of these numbers and hands nothing back to the simulation.
  if (game.ghost) recordGhostTick(game.ghost, car.x, car.y, car.heading, lapResult);
  if (game.laps.completed >= T.runLaps) finishRun(game);
}

// Called after every scoring step: `banked` is what a combo banked on this step, if any. A
// step banks at most one combo, so it is that combo's points exactly.
function noteLapScoring(game, banked) {
  if (banked > game.lapBestCombo) game.lapBestCombo = banked;
  const { combo } = game.scoring;
  if (combo && currentMultiplier(combo) > game.lapBestMultiplier) game.lapBestMultiplier = currentMultiplier(combo);
}

// At the line, a counted lap keeps what it scored. A voided lap gives back the points it
// banked, and a combo still running is lost with it, so missing a checkpoint can never
// be worth anything. A combo running across a counted line carries on into the next lap,
// as it always has, and belongs to the lap it is banked on.
function settleLap(game, result) {
  const { scoring } = game;
  if (result === 'void') {
    const { combo } = scoring;
    const unbanked = combo ? Math.round(combo.points * currentMultiplier(combo)) : 0;
    if (combo) loseCombo(scoring, 'lap not counted');
    const banked = scoring.score - game.lapScoreStart;
    game.forfeited += banked;
    game.lastForfeit = banked + unbanked;
  } else {
    game.countedBestCombo = Math.max(game.countedBestCombo, game.lapBestCombo);
    game.countedBestMultiplier = Math.max(game.countedBestMultiplier, game.lapBestMultiplier);
  }
  game.lapScoreStart = scoring.score;
  game.lapBestCombo = 0;
  game.lapBestMultiplier = 1;
}

// The score the run keeps: everything banked, less the voided laps. During a lap it
// includes what this lap has banked so far, which a void at the line would take back.
export function countedScore(game) {
  return game.scoring.score - game.forfeited;
}

function remarkFor(score, spinouts) {
  if (score === 0) return 'Very tidy. Now try the space bar.';
  if (spinouts >= 6) return 'Plenty of angle. Some of it on purpose.';
  if (score < 2000) return 'A few good slides in there. Link them up next time.';
  if (score < 8000) return spinouts > 2
    ? 'Real commitment. Catch the spins and that score climbs fast.'
    : 'Clean and sideways. Hold those combos through the transition.';
  if (score < 20000) return spinouts > 2
    ? 'Big scores, big moments. Calm the spins and it gets scary.'
    : 'Now that is proper car control.';
  return 'The tyre company sends its thanks.';
}

function finishRun(game) {
  const { scoring, laps } = game;
  // The run finishes on a counted lap, so a combo banked at the line counts too.
  const before = scoring.score;
  bankCombo(scoring, 'finished');
  const bestCombo = Math.max(game.countedBestCombo, scoring.score - before);
  game.state = 'finished';
  const score = countedScore(game);
  game.results = {
    score,
    bestLap: laps.bestLap,
    runTime: game.runTime,
    bestCombo,
    bestMultiplier: game.countedBestMultiplier,
    spinouts: scoring.spinouts,
    voidedLaps: laps.voided,
    forfeited: game.forfeited,
    remark: remarkFor(score, scoring.spinouts),
  };
  game.onRunEvent?.({ type: 'finish', trackId: game.track.id, runId: game.runId, completed: laps.completed, score: game.results.score, bestCombo: game.results.bestCombo });
}

// Consume real frame time in fixed steps. Rendering speed never changes the
// result: only how many steps run per frame.
export function advance(game, frameDt, input = NO_INPUT) {
  if (game.state === 'menu' || game.state === 'finished' || game.paused) return 0;
  const T = TUNING;
  game.accumulator += Math.min(frameDt, T.maxFrameTime);
  let steps = 0;
  // The small tolerance stops rounding from pushing a whole step into the next frame.
  while (game.accumulator >= T.simStep - 1e-9 && game.state !== 'finished') {
    tick(game, input);
    game.accumulator -= T.simStep;
    steps += 1;
  }
  return steps;
}
