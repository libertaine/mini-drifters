// The session: ties the car, track, laps and scoring together on a fixed
// timestep. Contains no browser code, so the tests can run it directly.
import { TUNING } from './tuning.js';
import { createCar, stepCar, updateDerived } from './physics.js';
import { buildTrack, projectOnTrack, surfaceFromDistance, trackDelta } from './track.js';
import { createLaps, updateLaps } from './laps.js';
import { createScoring, updateScoring, bankCombo } from './scoring.js';
import { createGhost, beginGhostRecording, recordGhostTick } from './ghost.js';

export const NO_INPUT = Object.freeze({ up: false, down: false, left: false, right: false, handbrake: false });

const sharedTrack = buildTrack();

export function createGame(track = sharedTrack) {
  const game = { track, state: 'menu', paused: false, ghostVisible: true };
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

  const at = projectOnTrack(track, game.car.x, game.car.y);
  game.trackS = at.s;
  game.trackInfo = at;
  game.progress = 0;       // unwrapped distance along the circuit
  game.furthest = 0;       // the "new ground" high-water mark
  game.progressRate = 0;   // smoothed along-track speed
  game.lastImpact = 0;
  game.ghost = createGhost(track);
  game.runId = (game.runId ?? 0) + 1;
}

// Start (or restart) a run. The clock waits on the grid for the first pedal press.
// A run that shouldn't leave a ghost behind passes { ghost: false }.
export function startRun(game, { ghost = true } = {}) {
  resetRun(game);
  if (!ghost) game.ghost = null;
  game.state = 'ready';
}

export const restartRun = startRun;

// Abandon the session and go back to the state the game opens in. Nothing runs from here
// until the next startRun: advance() does nothing on the menu.
export function returnToMenu(game) {
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

// One fixed simulation step.
export function tick(game, input = NO_INPUT) {
  const T = TUNING;
  const dt = T.simStep;
  const { car, track } = game;

  game.prev.x = car.x;
  game.prev.y = car.y;
  game.prev.heading = car.heading;

  if (game.state === 'ready' && (input.up || input.down)) {
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
  const newGround = Math.max(0, game.progress - game.furthest);
  if (newGround > 0) game.furthest = game.progress;
  const instantRate = moved / dt;
  game.progressRate += (instantRate - game.progressRate) * Math.min(1, T.progressRateSmoothing * dt);

  // A car heading the wrong way gets a gentle reminder from the HUD.
  const along = car.vx * at.tx + car.vy * at.ty;
  game.wrongWayTime = along < -4 ? game.wrongWayTime + dt : 0;

  game.ticks += 1;
  if (!racing) return;

  game.runTime += dt;
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

  const lapResult = updateLaps(game.laps, track, ax, ay, car.x, car.y, dt);
  if (lapResult) {
    game.lapEvent = lapResult;
    game.lapEventSerial += 1;
  }
  // The ghost gets copies of these numbers and hands nothing back to the simulation.
  if (game.ghost) recordGhostTick(game.ghost, car.x, car.y, car.heading, lapResult);
  if (game.laps.completed >= T.runLaps) finishRun(game);
}

function remarkFor(scoring) {
  if (scoring.score === 0) return 'Very tidy. Now try the space bar.';
  if (scoring.spinouts >= 6) return 'Plenty of angle. Some of it on purpose.';
  if (scoring.score < 2000) return 'A few good slides in there. Link them up next time.';
  if (scoring.score < 8000) return scoring.spinouts > 2
    ? 'Real commitment. Catch the spins and that score climbs fast.'
    : 'Clean and sideways. Hold those combos through the transition.';
  if (scoring.score < 20000) return scoring.spinouts > 2
    ? 'Big scores, big moments. Calm the spins and it gets scary.'
    : 'Now that is proper car control.';
  return 'The tyre company sends its thanks.';
}

function finishRun(game) {
  const { scoring, laps } = game;
  bankCombo(scoring, 'finished');
  game.state = 'finished';
  game.results = {
    score: scoring.score,
    bestLap: laps.bestLap,
    runTime: game.runTime,
    bestCombo: scoring.bestCombo,
    bestMultiplier: scoring.bestMultiplier,
    spinouts: scoring.spinouts,
    remark: remarkFor(scoring),
  };
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
