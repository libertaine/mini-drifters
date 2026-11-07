// The driving lesson, on the real car, track and scoring. Nothing here sets a car's
// position or a score to reach a step: every step is reached by pressing keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as T } from '../src/tuning.js';
import { createGame, startRun, restartRun, returnToMenu, togglePause, tick, advance, NO_INPUT } from '../src/game.js';
import { bankCombo } from '../src/scoring.js';
import {
  TUTORIAL_STEPS, TUTORIAL_LIMITS as L,
  createTutorial, updateTutorial, skipStep, isCountersteering, tutorialView, tutorialEnding,
} from '../src/tutorial.js';
import { gripDriver, driftDriver, lessonDriver, noviceDriver } from './support/drivers.mjs';

const DEG = Math.PI / 180;
const stepId = (t) => TUTORIAL_STEPS[t.step].id;

function lesson() {
  const game = createGame();
  startRun(game, { ghost: false });
  return { game, t: createTutorial() };
}

// Runs for some seconds of simulation, updating the lesson at 60 frames a second as the
// browser does. `keys` is an object, or a function of the elapsed time.
function drive({ game, t }, seconds, keys = NO_INPUT, { until } = {}) {
  const ticks = Math.round(seconds / T.simStep);
  for (let i = 0; i < ticks; i += 1) {
    tick(game, { ...NO_INPUT, ...(typeof keys === 'function' ? keys(i * T.simStep, game) : keys) });
    if (i % 2 === 1) {
      updateTutorial(t, game);
      if (until?.(t, game)) return;
    }
  }
}

// Gets to a step honestly, by playing every step before it.
function playUntil(session, id, driver = lessonDriver()) {
  const { game, t } = session;
  let budget = 300 * 120;
  let i = 0;
  while (stepId(t) !== id || t.phase !== 'driving') {
    assert.ok((budget -= 1) > 0, `reached ${id}`);
    tick(game, driver(game, stepId(t)));
    i += 1;
    if (i % 2 === 0) updateTutorial(t, game);
  }
}

// Drives on the road until the car is at this speed and has stopped rocking from whatever
// it was doing before, so that what happens next is down to the keys that follow.
function bringUpTo(session, speed) {
  const driver = gripDriver();
  drive(session, 40, (_, game) => ({ ...driver(game), up: true, down: false }), {
    until: (_, game) => game.car.speed >= speed && Math.abs(game.car.yawRate) < 0.015 && Math.abs(game.car.steer) < 0.02,
  });
}

const pullHandbrake = (from = 0.15, length = 0.3, side = 'right', wheelUntil = 0.8) => (s) => ({
  up: true,
  [side]: s < wheelUntil,
  handbrake: s > from && s < from + length,
});

// --- 1. The whole lesson ---------------------------------------------------------------
test('the lesson starts on the normal grid, on the first step', () => {
  const { game, t } = lesson();
  const fresh = createGame();
  startRun(fresh);
  assert.equal(game.state, 'ready');
  assert.equal(game.car.x, fresh.car.x);
  assert.equal(game.car.y, fresh.car.y);
  assert.equal(game.car.heading, fresh.car.heading);
  assert.equal(stepId(t), 'accelerate');
  assert.equal(t.phase, 'driving');
});

test('a whole lesson goes through every step in order and ends on real banked points', () => {
  const session = lesson();
  const { game, t } = session;
  const driver = lessonDriver();
  const seen = [];
  let event = null;
  for (let i = 0; i < 300 * 120 && t.phase !== 'complete'; i += 1) {
    tick(game, driver(game, stepId(t)));
    if (i % 2 === 1) {
      updateTutorial(t, game);
      if (seen.at(-1) !== stepId(t)) seen.push(stepId(t));
    }
    if (game.scoring.event?.type === 'banked') event = game.scoring.event;
  }
  assert.equal(t.phase, 'complete');
  assert.deepEqual(seen, TUTORIAL_STEPS.map((step) => step.id));
  assert.deepEqual(t.skipped, []);
  assert.ok(t.bankedPoints > 0);
  assert.equal(t.bankedPoints, event.points, 'the amount shown is what scoring banked');
  assert.ok(game.scoring.score >= t.bankedPoints, 'and it is in the real score');
  assert.equal(tutorialEnding(t).qualified, true);
  assert.equal(tutorialEnding(t).title, 'YOU ARE NOW QUALIFIED TO BE DANGEROUS.');
});

test('every step shows the approved words, with a step indicator', () => {
  assert.deepEqual(TUTORIAL_STEPS.map((step) => step.title), [
    'FIRST, MAKE IT MOVE.',
    'NOW TRY THE WHEEL.',
    'THE CAR PREFERS SIDEWAYS.',
    'CATCH IT BEFORE IT CATCHES YOU.',
    'POINTS ARE ONLY YOURS WHEN BANKED.',
  ]);
  const view = tutorialView(createTutorial());
  assert.equal(view.number, 1);
  assert.equal(view.total, 5);
  assert.equal(view.text, 'Hold ↑ to accelerate.');
});

test('people of different speeds can finish it', () => {
  // Slow decisions, late reactions, and pulls from a shade too short to much too long.
  const learners = [
    { decisions: 8, reaction: 0.3 },
    { decisions: 6, reaction: 0.45 },
    { decisions: 4, reaction: 0.7 },
    { decisions: 6, reaction: 0.7, tap: 0.15 },
    { decisions: 6, reaction: 0.45, tap: 0.5 },
    { decisions: 6, reaction: 0.45, entrySpeed: 14 },
  ];
  for (const options of learners) {
    const session = lesson();
    playUntil(session, 'bank', noviceDriver(options));
    const driver = noviceDriver(options);
    drive(session, 200, (_, game) => driver(game, 'bank'), { until: (t) => t.phase === 'complete' });
    assert.equal(session.t.phase, 'complete', JSON.stringify(options));
    assert.ok(session.t.bankedPoints > 0, JSON.stringify(options));
  }
});

// --- 2. Accelerate ---------------------------------------------------------------------
test('accelerate: sitting on the grid, or one quick press, does not pass', () => {
  const session = lesson();
  drive(session, 3);
  assert.equal(stepId(session.t), 'accelerate', 'no input');
  drive(session, 0.1, { up: true });
  drive(session, 3);
  assert.equal(stepId(session.t), 'accelerate', 'a press that barely moves the car');
  assert.ok(session.game.progress < L.movedMetres);
});

test('accelerate: other keys and reversing do not pass', () => {
  const session = lesson();
  drive(session, 2, { left: true, right: false, handbrake: true });
  assert.equal(stepId(session.t), 'accelerate', 'wheel and handbrake on a parked car');
  drive(session, 6, { down: true });
  assert.ok(session.game.car.forwardSpeed < 0, 'really reversing');
  assert.equal(stepId(session.t), 'accelerate', 'reversing');
});

test('accelerate: really driving forward passes', () => {
  const session = lesson();
  drive(session, 5, { up: true }, { until: (t) => t.step > 0 });
  assert.equal(stepId(session.t), 'steer');
  assert.ok(session.game.progress >= L.movedMetres);
});

// --- 3. Steer --------------------------------------------------------------------------
function moving() {
  const session = lesson();
  playUntil(session, 'steer');
  return session;
}

test('steer: turning the wheel at a standstill does not pass', () => {
  const session = lesson();
  playUntil(session, 'steer');
  drive(session, 6, { down: true }, { until: (_, game) => game.car.speed < 0.5 });
  drive(session, 3, (s) => ({ left: s < 1.5, right: s >= 1.5 }));
  assert.equal(stepId(session.t), 'steer');
});

test('steer: a flick of the wheel too brief to turn the car does not count', () => {
  const session = moving();
  drive(session, 0.05, { up: true, right: true });
  drive(session, 0.3, { up: true });
  assert.ok(session.t.turnedRight < L.turnedRadians, `${session.t.turnedRight} radians`);
  assert.equal(session.t.hint, '');
});

test('steer: one direction only does not pass, and the prompt asks for the other', () => {
  const session = moving();
  drive(session, 0.6, { up: true, right: true });
  assert.equal(stepId(session.t), 'steer');
  assert.ok(session.t.turnedRight >= L.turnedRadians);
  assert.match(session.t.hint, /other way/);
});

test('steer: the car really turning both ways passes', () => {
  const session = moving();
  drive(session, 0.6, { up: true, right: true });
  drive(session, 1.2, { up: true, left: true }, { until: (t) => stepId(t) !== 'steer' });
  assert.equal(stepId(session.t), 'slide');
});

// --- 4. Start a drift ------------------------------------------------------------------
function readyToSlide(speed = 22) {
  const session = lesson();
  playUntil(session, 'slide');
  bringUpTo(session, speed);
  return session;
}

test('slide: the handbrake on a car going straight does not pass', () => {
  const session = readyToSlide();
  drive(session, 0.3, { up: true, handbrake: true });
  drive(session, 1.5, { up: true });
  assert.equal(stepId(session.t), 'slide');
  assert.equal(session.game.scoring.drifting, false);
});

test('slide: a very quick tap only unsettles the car, and the prompt says why at once', () => {
  const session = readyToSlide();
  drive(session, 2, pullHandbrake(0.15, 0.08));
  assert.equal(stepId(session.t), 'slide');
  assert.match(session.t.hint, /a little longer/);
});

test('slide: too slow to count does not pass, and the prompt asks for more speed', () => {
  const session = lesson();
  playUntil(session, 'slide');
  drive(session, 6, { down: true }, { until: (_, game) => game.car.speed < 8 });
  drive(session, 0.5, (s, game) => ({ up: game.car.speed < 8, right: s > 0.1 && s < 0.5, handbrake: s > 0.2 && s < 0.4 }));
  assert.equal(stepId(session.t), 'slide');
  assert.match(session.t.hint, /speed/);
});

test('slide: a miss with no clear cause is left alone the first time, then explained', () => {
  const session = readyToSlide();
  const noWheel = (s) => ({ up: true, handbrake: s < 0.3 });
  drive(session, 1.4, noWheel);
  assert.equal(session.t.misses, 1);
  assert.equal(session.t.hint, '', 'a single miss is left alone');
  bringUpTo(session, 22);
  drive(session, 1.4, noWheel);
  assert.equal(stepId(session.t), 'slide');
  assert.match(session.t.hint, /Turn the wheel/);
});

test('slide: holding the handbrake is corrected rather than presented as the way to do it', () => {
  // A car that has never been steered stays dead straight, so nothing but the hold is on trial.
  const session = lesson();
  skipStep(session.t);
  skipStep(session.t);
  drive(session, 4, { up: true });
  drive(session, 0.7, { up: true, handbrake: true });
  assert.equal(session.t.hint, '', 'a pull of ordinary length is fine');
  drive(session, 0.4, { up: true, handbrake: true });
  assert.match(session.t.hint, /Just a tap/);
  assert.equal(stepId(session.t), 'slide');
});

test('slide: a real slide passes, whichever way it goes', () => {
  for (const side of ['left', 'right']) {
    const session = readyToSlide();
    drive(session, 2, pullHandbrake(0.15, 0.3, side), { until: (t) => stepId(t) !== 'slide' });
    assert.equal(stepId(session.t), 'countersteer', side);
    assert.equal(session.game.scoring.drifting, true);
  }
});

// --- 5. Countersteer -------------------------------------------------------------------
test('the countersteer test uses the signs in physics.js', () => {
  const car = (steer, slipAngle) => ({ steer, slipAngle });
  // Moving to the right of its nose (positive slip): the tail is out to the right, so steer right.
  assert.equal(isCountersteering(car(1, 30 * DEG)), true);
  assert.equal(isCountersteering(car(-1, -30 * DEG)), true);
  assert.equal(isCountersteering(car(-1, 30 * DEG)), false, 'steering further into the slide');
  assert.equal(isCountersteering(car(1, -30 * DEG)), false, 'steering further into the slide');
  assert.equal(isCountersteering(car(0, 30 * DEG)), false, 'hands off');
  assert.equal(isCountersteering(car(L.counterMinInput - 0.01, 30 * DEG)), false, 'only a brush of the wheel');
  assert.equal(isCountersteering(car(1, 0)), false, 'no slide');
});

test('in the real car, turning right and pulling the handbrake gives negative slip, and catching it means steering left', () => {
  const session = readyToSlide();
  let slip = 0;
  drive(session, 0.8, pullHandbrake(0.15, 0.3), { until: (_, game) => {
    slip = game.car.slipAngle;
    return game.scoring.drifting;
  } });
  assert.ok(slip < 0, `slip ${slip / DEG}`);
  assert.equal(isCountersteering({ steer: 1, slipAngle: slip }), false, 'right is into the corner');
  assert.equal(isCountersteering({ steer: -1, slipAngle: slip }), true, 'left is against the slide');
});

// The handbrake has just been let go, and the tail is on its way out.
function sliding(speed = 22) {
  const session = readyToSlide(speed);
  const entry = pullHandbrake(0.15, 0.3);
  drive(session, 0.46, entry);
  drive(session, 1, (s) => entry(s + 0.46), { until: (t) => stepId(t) !== 'slide' });
  assert.equal(stepId(session.t), 'countersteer');
  return session;
}

test('countersteer: steering into the slide, or leaving the wheel alone, does not pass', () => {
  let session = sliding();
  drive(session, 2, { up: true, right: true });
  assert.equal(stepId(session.t), 'countersteer', 'into the slide');
  session = sliding();
  drive(session, 2, { up: true });
  assert.equal(stepId(session.t), 'countersteer', 'hands off');
});

test('countersteer: steering against the slide passes, with or without much throttle', () => {
  for (const up of [true, false]) {
    const session = sliding();
    drive(session, 1, { up, left: true }, { until: (t) => stepId(t) !== 'countersteer' });
    assert.equal(stepId(session.t), 'bank', `up: ${up}`);
    assert.ok(session.t.counterTime === 0);
  }
});

test('countersteer: a wheel flick shorter than the minimum does not pass', () => {
  const session = sliding();
  drive(session, 0.06, { up: true, left: true });
  drive(session, 2, { up: true });
  assert.equal(stepId(session.t), 'countersteer');
});

test('countersteer: steering that way with no slide does not pass', () => {
  const session = sliding();
  drive(session, 6, { up: true }, { until: (_, game) => !game.scoring.drifting && Math.abs(game.car.slipAngle) < 3 * DEG });
  drive(session, 1, (s) => ({ up: true, left: s < 0.5, right: s >= 0.5 }));
  assert.equal(stepId(session.t), 'countersteer');
});

test('countersteer: a held handbrake spin does not pass, and the prompt says what to change', () => {
  const session = sliding();
  const spins = session.game.scoring.spinouts;
  drive(session, 3, { up: true, right: true, handbrake: true }, { until: (_, game) => game.scoring.spinouts > spins });
  assert.ok(session.game.scoring.spinouts > spins, 'it really spun');
  assert.equal(stepId(session.t), 'countersteer');
  assert.match(session.t.hint, /Spun it/);
});

test('countersteer: repeated misses bring a hint, and no slide brings a reminder', () => {
  const session = sliding();
  const road = gripDriver();
  drive(session, 5, (_, game) => (game.scoring.drifting ? { up: true } : road(game)), { until: (t) => t.misses >= 1 });
  assert.equal(session.t.misses, 1);
  assert.equal(session.t.hint, '', 'one missed slide is left alone');
  drive(session, L.idleSeconds + 0.5, (_, game) => road(game));
  assert.match(session.t.hint, /Start another slide/);
  assert.equal(stepId(session.t), 'countersteer');
});

// --- 6. Bank ---------------------------------------------------------------------------
function holdingPoints() {
  const session = sliding();
  drive(session, 1, { up: true, left: true }, { until: (t) => stepId(t) !== 'countersteer' });
  assert.equal(stepId(session.t), 'bank');
  return session;
}

test('bank: points still in the combo do not pass', () => {
  const session = holdingPoints();
  assert.ok(session.game.scoring.combo, 'there is a live combo');
  drive(session, 0.5, { up: true, left: true });
  assert.equal(session.t.phase, 'driving');
});

test('bank: straightening up banks real points, shows them, then finishes', () => {
  const session = holdingPoints();
  const { game, t } = session;
  const road = gripDriver();
  const before = game.scoring.score;
  drive(session, 6, (_, g) => road(g), { until: () => t.phase === 'banked' });
  assert.equal(t.phase, 'banked');
  assert.equal(t.bankedPoints, game.scoring.event.points);
  assert.equal(game.scoring.event.type, 'banked');
  assert.equal(game.scoring.score, before + t.bankedPoints);
  assert.match(tutorialView(t).title, new RegExp(`\\+${t.bankedPoints} BANKED`));
  drive(session, L.bankedSeconds + 0.2, (_, g) => road(g));
  assert.equal(t.phase, 'complete');
  assert.equal(tutorialEnding(t).banked, t.bankedPoints);
});

test('bank: the ending waits if the player is in the middle of another slide', () => {
  const session = holdingPoints();
  const { game, t } = session;
  const road = gripDriver();
  drive(session, 6, (_, g) => road(g), { until: () => t.phase === 'banked' });
  // Into a new slide straight away, held past the moment the ending would have come.
  const drift = driftDriver({ cooldown: 0.2, minCorner: 0 });
  let i = 0;
  while (!(t.phaseTime >= L.bankedSeconds && game.scoring.drifting)) {
    assert.equal(t.phase, 'banked', 'the ending came during a slide or the slide never came');
    assert.ok((i += 1) < 60 * 120, 'it got into another slide');
    // Drives until the moment it would end, then only an unbroken slide can delay it.
    if (t.phaseTime < L.bankedSeconds - 0.8 && !game.scoring.drifting) tick(game, road(game));
    else tick(game, drift(game));
    if (i % 2 === 0) updateTutorial(t, game);
    if (t.phaseTime >= L.bankedSeconds && !game.scoring.drifting) break;
  }
  if (game.scoring.drifting) {
    updateTutorial(t, game);
    assert.equal(t.phase, 'banked', 'still waiting');
  }
});

test('bank: lost points do not pass, and the prompt says how they went', () => {
  const session = holdingPoints();
  const { game, t } = session;
  drive(session, 8, { up: true, right: true, handbrake: true }, { until: () => game.scoring.event?.type === 'lost' });
  assert.equal(game.scoring.event?.type, 'lost', 'the spin really cost the combo');
  assert.equal(t.phase, 'driving');
  assert.equal(stepId(t), 'bank');
  assert.match(t.hint, /^Lost \d+/);
});

test('bank: points banked by the end of a run are not the player straightening up', () => {
  const session = holdingPoints();
  const { game, t } = session;
  bankCombo(game.scoring, 'finished');
  game.ticks += 1;
  updateTutorial(t, game);
  assert.equal(t.phase, 'driving');
});

test('bank: with nothing to bank, the prompt says to slide again', () => {
  const session = lesson();
  const { t } = session;
  for (let i = 0; i < 4; i += 1) skipStep(t);
  assert.equal(stepId(t), 'bank');
  drive(session, L.idleSeconds + 0.5, { up: true });
  assert.equal(t.phase, 'driving');
  assert.match(t.hint, /Nothing to bank yet/);
});

// --- 7. Restart, skip, exit ------------------------------------------------------------
test('restarting goes back to the grid and keeps the step, but no half-done slide', () => {
  const session = sliding();
  const { game, t } = session;
  drive(session, 0.6, { up: true, left: true }, { until: () => t.counterTime > 0 });
  assert.ok(t.counterTime > 0);
  restartRun(game, { ghost: false });
  drive(session, 0.1);
  assert.equal(stepId(t), 'countersteer');
  assert.equal(t.counterTime, 0);
  assert.equal(game.state, 'ready');
  assert.equal(game.scoring.score, 0);
  assert.match(t.hint, /Hold ↑/);
});

test('an event from before a restart is not taken for one after it', () => {
  const session = holdingPoints();
  const { game, t } = session;
  bankCombo(game.scoring);
  restartRun(game, { ghost: false });
  drive(session, 0.5);
  assert.equal(t.phase, 'driving');
  assert.equal(t.bankedPoints, 0);
});

test('three laps carry the lesson on, and points the finish line banks do not count', () => {
  const session = lesson();
  const { game, t } = session;
  playUntil(session, 'slide');
  // Three real laps, too gently to slide, with the lesson still waiting for one.
  const road = gripDriver();
  let i = 0;
  while (game.state !== 'finished') {
    assert.ok((i += 1) < 900 * 120, 'three laps ended the run');
    const keys = road(game);
    tick(game, { ...keys, up: keys.up && game.car.speed < 12 });
    if (i % 2 === 0) updateTutorial(t, game);
  }
  assert.equal(game.laps.completed, T.runLaps);
  game.ticks += 1; // the frame after: the browser's loop always has one more to show
  updateTutorial(t, game);
  assert.equal(t.phase, 'driving');
  assert.equal(stepId(t), 'slide');
  assert.match(t.hint, /Three laps/);
  restartRun(game, { ghost: false });
  drive(session, 0.1);
  assert.equal(game.state, 'ready');
  assert.equal(stepId(t), 'slide');
});

test('a skip moves on one step, and the ending says steps were skipped', () => {
  const t = createTutorial();
  skipStep(t);
  assert.equal(stepId(t), 'steer');
  assert.deepEqual(t.skipped, ['accelerate']);
  while (t.phase === 'driving') skipStep(t);
  assert.equal(t.phase, 'complete');
  assert.equal(t.skipped.length, 5);
  const ending = tutorialEnding(t);
  assert.equal(ending.qualified, false);
  assert.doesNotMatch(ending.title, /QUALIFIED/);
  assert.match(ending.text, /5 steps/);
  assert.equal(ending.banked, 0);
});

test('a skip does nothing once the lesson is over', () => {
  const t = createTutorial();
  while (t.phase === 'driving') skipStep(t);
  const { skipped } = t;
  const count = skipped.length;
  skipStep(t);
  assert.equal(t.skipped.length, count);
});

test('starting over is a clean slate', () => {
  const session = holdingPoints();
  const again = createTutorial();
  assert.notEqual(session.t, again);
  assert.equal(again.step, 0);
  assert.equal(again.bankedPoints, 0);
  assert.deepEqual(again.skipped, []);
});

test('pausing stops the lesson along with the car', () => {
  const session = sliding();
  const { game, t } = session;
  drive(session, 0.6, { up: true, left: true }, { until: () => t.counterTime > 0 });
  const held = t.counterTime;
  assert.ok(held > 0 && held < L.counterSeconds);
  togglePause(game);
  const ticks = game.ticks;
  for (let i = 0; i < 300; i += 1) {
    advance(game, 1 / 60, { ...NO_INPUT, up: true, left: true });
    updateTutorial(t, game);
  }
  assert.equal(game.ticks, ticks);
  assert.equal(t.counterTime, held);
  assert.equal(stepId(t), 'countersteer');
});

test('the lesson stops watching once the game is back on the menu', () => {
  const session = sliding();
  const { game, t } = session;
  const before = JSON.stringify(t);
  returnToMenu(game);
  for (let i = 0; i < 60; i += 1) {
    advance(game, 1 / 60, { ...NO_INPUT, up: true });
    updateTutorial(t, game);
  }
  assert.equal(JSON.stringify(t), before);
});

// --- 8. It leaves the game alone -------------------------------------------------------
const physicsOf = (game) => JSON.stringify({ car: game.car, scoring: game.scoring, laps: game.laps, progress: game.progress, ticks: game.ticks, state: game.state });

test('watching changes nothing: a run with the lesson matches a run without it, tick for tick', () => {
  const plain = createGame();
  const watched = createGame();
  startRun(plain);
  startRun(watched);
  const t = createTutorial();
  const a = driftDriver();
  const b = driftDriver();
  for (let i = 0; i < 90 * 120 && plain.state !== 'finished'; i += 1) {
    tick(plain, a(plain));
    tick(watched, b(watched));
    updateTutorial(t, watched);
    if (i % 600 === 0) assert.equal(physicsOf(watched), physicsOf(plain), `tick ${i}`);
  }
  assert.ok(plain.scoring.score > 0, 'and there was real scoring to compare');
  assert.equal(physicsOf(watched), physicsOf(plain));
  assert.equal(watched.scoring.score, plain.scoring.score);
});

test('the lesson writes nothing to the game: it can watch a frozen one', () => {
  const session = sliding();
  const { game, t } = session;
  // A step has happened that the lesson hasn't seen, so it really has something to look at.
  tick(game, { ...NO_INPUT, up: true, left: true });
  const before = physicsOf(game);
  const seen = t.seenTicks;
  for (const part of [game, game.car, game.scoring, game.laps]) Object.freeze(part);
  updateTutorial(t, game); // modules are strict, so any write to the frozen game throws here
  assert.ok(t.seenTicks > seen, 'it did look');
  assert.equal(physicsOf(game), before);
});

test('a lesson run records no ghost, and the next normal run has its usual one', () => {
  const game = createGame();
  startRun(game, { ghost: false });
  assert.equal(game.ghost, null);
  const driver = gripDriver();
  while (game.laps.completed < 1) tick(game, driver(game));
  assert.equal(game.ghost, null);
  restartRun(game, { ghost: false });
  assert.equal(game.ghost, null, 'still none after a restart in the lesson');
  startRun(game);
  assert.ok(game.ghost);
  assert.equal(game.ghost.replay, null, 'with nothing carried over');
  assert.equal(game.laps.completed, 0);
});

test('a normal run after a lesson is the same as a first run', () => {
  const session = holdingPoints();
  const { game } = session;
  assert.ok(game.ticks > 0);
  startRun(game);
  const fresh = createGame();
  startRun(fresh);
  for (const part of ['car', 'scoring', 'laps']) assert.deepEqual(game[part], fresh[part], part);
  assert.equal(game.state, 'ready');
  assert.equal(game.runTime, 0);
  assert.equal(game.progress, 0);
  assert.equal(game.furthest, 0);
  const a = driftDriver();
  const b = driftDriver();
  // driftDriver reads game.ticks, so both runs need the same clock from here.
  fresh.ticks = game.ticks;
  for (let i = 0; i < 60 * 120; i += 1) {
    tick(game, a(game));
    tick(fresh, b(fresh));
  }
  assert.equal(physicsOf(game), physicsOf(fresh));
});

test('returning to the menu leaves nothing running or recorded', () => {
  const game = createGame();
  startRun(game);
  const driver = driftDriver();
  while (game.laps.completed < 1) tick(game, driver(game));
  assert.ok(game.scoring.score > 0);
  const { runId } = game;
  game.paused = true;
  returnToMenu(game);
  assert.equal(game.state, 'menu');
  assert.equal(game.paused, false);
  assert.equal(game.scoring.score, 0);
  assert.equal(game.laps.completed, 0);
  assert.equal(game.results, null);
  assert.equal(game.ghost.replay, null);
  assert.equal(game.ghost.recording ?? null, null);
  assert.equal(game.runId, runId + 1);
  const { ticks } = game;
  assert.equal(advance(game, 1, { ...NO_INPUT, up: true }), 0, 'no physics runs');
  assert.equal(game.ticks, ticks);
  assert.equal(game.car.speed, 0);
});

test('startRun with no options is unchanged', () => {
  const game = createGame();
  startRun(game);
  assert.ok(game.ghost);
  assert.equal(game.state, 'ready');
});
